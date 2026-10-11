import { displayOrder, normalizeOptions, optionTitle, str, validateInput } from "../quiz/grade.ts";
import { decodeResult, formatResultText, type Outcome } from "../quiz/result.ts";
import type { Event } from "./transcript.ts";

export const QUIZ_TOOL = /^mcp__.*quiz__quiz$/;
export const ASK_TOOL = "AskUserQuestion";

const quote = (lines: string[]) => lines.flatMap((l) => l.split("\n")).map((l) => (l ? `> ${l}` : ">")).join("\n");
const callout = (type: string, title: string, body: string[]) => quote([`[!${type}] ${title}`, ...body]);
const optionLine = (title: string, description?: string) => (description ? `${title}: ${description}` : title);

function stripNoise(text: string): string {
  return text
    .replace(/<command-[a-z]+>[\s\S]*?<\/command-[a-z]+>/g, "")
    .replace(/<system-reminder[^>]*>[\s\S]*?<\/system-reminder>/g, "")
    .replace(/<local-command-[a-z]+>[\s\S]*?<\/local-command-[a-z]+>/g, "")
    .trim();
}

function userBlock(text: string): string | undefined {
  const clean = stripNoise(text);
  return clean ? quote(["[!user]", clean]) : undefined;
}

function quizQuestion(input: any): string {
  const v = validateInput(input);
  const quiz = v.ok
    ? v.quiz
    : { question: str(input?.question) ?? "", details: str(input?.details), options: normalizeOptions(input?.options), shuffle: input?.shuffle !== false };
  const body = [quiz.question, ...(quiz.details ? [quiz.details] : []), ""];
  for (const o of displayOrder(quiz)) body.push(optionLine(optionTitle(o), o.description));
  return callout("question", "Quiz", body);
}

function askQuestion(input: any): string {
  const body: string[] = [];
  for (const q of input?.questions ?? []) {
    body.push(`**${q.question}**`);
    (q.options ?? []).forEach((o: any, i: number) => body.push(optionLine(`${i + 1}. ${o.label}`, o.description)));
  }
  return callout("question", "Frage", body);
}

export function questionBlock(name: string, input: unknown): string | undefined {
  if (QUIZ_TOOL.test(name)) return quizQuestion(input);
  if (name === ASK_TOOL) return askQuestion(input);
  return undefined;
}

const CALLOUT: Record<Outcome, string> = { correct: "success", wrong: "failure", dontKnow: "info", cancelled: "warning" };

function resultBlock(e: Extract<Event, { kind: "tool_result" }>): string | undefined {
  const answers = (e.toolUseResult as any)?.answers;
  if (answers && typeof answers === "object") {
    const body = Object.entries(answers).map(([q, a]) => `${q} → ${Array.isArray(a) ? a.join(", ") : String(a)}`);
    return callout("info", "Antwort", body);
  }
  const r = decodeResult(e.text);
  if (!r) return undefined;
  const [head, ...rest] = formatResultText(r).split("\n");
  return callout(CALLOUT[r.outcome], head, rest);
}

export function renderEvents(events: Event[], rendered: Set<string>): string[] {
  const blocks: string[] = [];
  for (const e of events) {
    switch (e.kind) {
      case "user_text": {
        const b = userBlock(e.text);
        if (b) blocks.push(b);
        break;
      }
      case "assistant_text":
        blocks.push(e.text.trim());
        break;
      case "tool_use": {
        if (rendered.has(e.id)) break;
        const b = questionBlock(e.name, e.input);
        if (b) {
          blocks.push(b);
          rendered.add(e.id);
        }
        break;
      }
      case "tool_result": {
        const b = resultBlock(e);
        if (b) blocks.push(b);
        break;
      }
    }
  }
  return blocks;
}
