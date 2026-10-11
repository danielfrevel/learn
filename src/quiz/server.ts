import { createInterface } from "node:readline";
import {
  DONT_KNOW_LABEL, DONT_KNOW_VALUE, displayOrder, grade, validateInput,
  type DisplayOption, type QuizInput,
} from "./grade.ts";
import { plainMath } from "./plainmath.ts";
import { encodeResult, formatResultText, type QuizResult } from "./result.ts";

const TOOL = {
  name: "quiz",
  description: [
    "Pose ONE graded multiple-choice question. The learner answers in a dialog; the server grades and returns ✓/✗, the correct answer and the explanation.",
    "Options only, no free text. Give each option a stable `value` and reference the correct one(s) by value in `correctAnswer`.",
    "An 'Ich weiß es nicht' option is always added; it is neither right nor wrong.",
    "Options are shuffled by default; set `shuffle: false` when order carries meaning (ordered numbers, 'all of the above').",
    "Write math as LaTeX ($...$); the log renders it. Keep options parallel: same length, same grain, no justification in any option.",
  ].join(" "),
  inputSchema: {
    type: "object",
    properties: {
      question: { type: "string", description: "The single quiz question." },
      details: { type: "string", description: "Optional context shown under the question." },
      options: {
        type: "array",
        minItems: 2,
        items: {
          type: "object",
          properties: {
            label: { type: "string", description: "Display label." },
            value: { type: "string", description: "Stable id, defaults to label." },
            description: { type: "string", description: "Optional detail shown next to the label." },
          },
          required: ["label"],
        },
      },
      multiSelect: { type: "boolean", description: "True when the learner must select the exact set of correct options." },
      correctAnswer: {
        oneOf: [{ type: "string" }, { type: "array", items: { type: "string" } }],
        description: "Option value(s) that are correct. String for single-select, array for multi-select.",
      },
      explanation: { type: "string", description: "Revealed after answering, right or wrong." },
      shuffle: { type: "boolean", description: "Default true." },
    },
    required: ["question", "options", "correctAnswer", "explanation"],
  },
};

const write = (msg: unknown) => process.stdout.write(JSON.stringify(msg) + "\n");
let nextId = 1;
const pending = new Map<number, (msg: any) => void>();

function request(method: string, params: unknown): Promise<any> {
  const id = nextId++;
  write({ jsonrpc: "2.0", id, method, params });
  return new Promise((resolve) => pending.set(id, resolve));
}

const numbered = (o: DisplayOption) => (o.value === DONT_KNOW_VALUE ? DONT_KNOW_LABEL : `${o.index}. ${o.label}`);
const HINT = "→ öffnet die Liste, ↑/↓ wählen, Enter bestätigt.";

function elicitationSchema(quiz: QuizInput, display: DisplayOption[]) {
  const answer = quiz.multiSelect
    ? {
        type: "array",
        title: "Antwort (mehrere möglich)",
        description: HINT,
        items: { type: "string", enum: display.map(numbered) },
      }
    : {
        type: "string",
        title: "Antwort",
        description: HINT,
        oneOf: display.map((o) => ({ const: o.value, title: numbered(o) })),
      };
  return {
    type: "object",
    properties: {
      answer,
      note: { type: "string", title: "Notiz (optional)", description: "Freitext, z. B. Begründung oder Unsicherheit." },
    },
    required: ["answer"],
  };
}

function selectedValues(display: DisplayOption[], raw: unknown): string[] {
  const picks = Array.isArray(raw) ? raw : [raw];
  const byTitle = new Map(display.map((o) => [numbered(o), o.value]));
  return picks
    .filter((p): p is string => typeof p === "string")
    .map((p) => byTitle.get(p) ?? p);
}

async function runQuiz(args: unknown) {
  const v = validateInput(args);
  if (!v.ok) return { isError: true, content: [{ type: "text", text: `quiz: ${v.error}` }] };
  const quiz = v.quiz;
  const display = displayOrder(quiz);
  const message = [plainMath(quiz.question), quiz.details ? plainMath(quiz.details) : ""].filter(Boolean).join("\n\n");
  const res = await request("elicitation/create", { mode: "form", message, requestedSchema: elicitationSchema(quiz, display) });
  const action = res?.result?.action;
  const content = res?.result?.content ?? {};
  const options = display.filter((o) => o.value !== DONT_KNOW_VALUE).map(({ index, label, value }) => ({ index, label, value }));
  const correctIndices = display.filter((o) => quiz.correctAnswer.includes(o.value)).map((o) => o.index);
  const base: Omit<QuizResult, "answers"> = {
    status: action === "accept" ? "answered" : "cancelled",
    question: quiz.question,
    details: quiz.details,
    mode: quiz.multiSelect ? "multi-select" : "single-select",
    options,
    correctIndices,
    explanation: quiz.explanation,
  };
  let result: QuizResult;
  if (action !== "accept") {
    result = { ...base, answers: [] };
  } else {
    const g = grade(display, selectedValues(display, content.answer), quiz);
    const note = typeof content.note === "string" && content.note.trim() ? content.note.trim() : undefined;
    result = {
      ...base,
      answers: g.answers.map(({ index, label, value }) => ({ index, label, value })),
      correct: g.correct,
      dontKnow: g.dontKnow || undefined,
      note,
    };
  }
  return {
    content: [{ type: "text", text: formatResultText(result) }, { type: "text", text: encodeResult(result) }],
    structuredContent: result,
  };
}

async function handle(msg: any) {
  if (msg.id !== undefined && msg.method === undefined) {
    pending.get(msg.id)?.(msg);
    pending.delete(msg.id);
    return;
  }
  const { id, method, params } = msg;
  switch (method) {
    case "initialize":
      return write({
        jsonrpc: "2.0", id,
        result: {
          protocolVersion: params?.protocolVersion ?? "2025-06-18",
          capabilities: { tools: {} },
          serverInfo: { name: "learn-quiz", version: "0.1.0" },
        },
      });
    case "notifications/initialized":
      return;
    case "ping":
      return write({ jsonrpc: "2.0", id, result: {} });
    case "tools/list":
      return write({ jsonrpc: "2.0", id, result: { tools: [TOOL] } });
    case "tools/call":
      if (params?.name !== "quiz") return write({ jsonrpc: "2.0", id, error: { code: -32602, message: `unknown tool ${params?.name}` } });
      return write({ jsonrpc: "2.0", id, result: await runQuiz(params.arguments) });
    default:
      if (id !== undefined) write({ jsonrpc: "2.0", id, error: { code: -32601, message: `method not found: ${method}` } });
  }
}

createInterface({ input: process.stdin }).on("line", (line) => {
  if (!line.trim()) return;
  try {
    void handle(JSON.parse(line));
  } catch (err) {
    process.stderr.write(`learn-quiz: ${String(err)}\n`);
  }
});
