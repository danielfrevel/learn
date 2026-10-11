import { displayOrder, normalizeOptions, DONT_KNOW_VALUE } from "../quiz/grade.ts";
import { decodeResult, formatResultText } from "../quiz/result.ts";
import type { Event } from "./transcript.ts";

export const QUIZ_TOOL = /^mcp__.*quiz__quiz$/;
export const ASK_TOOL = "AskUserQuestion";

export function isQuestionTool(name: string): boolean {
  return QUIZ_TOOL.test(name) || name === ASK_TOOL;
}

const quote = (lines: string[]) => lines.map((l) => (l ? `> ${l}` : ">")).join("\n");
const callout = (type: string, title: string, body: string[]) => quote([`[!${type}] ${title}`, ...body]);

function stripNoise(text: string): string {
  return text
    .replace(/<command-message>[\s\S]*?<\/command-message>/g, "")
    .replace(/<command-name>[\s\S]*?<\/command-name>/g, "")
    .replace(/<command-args>[\s\S]*?<\/command-args>/g, "")
    .replace(/<system-reminder[^>]*>[\s\S]*?<\/system-reminder>/g, "")
    .replace(/<local-command-[a-z]+>[\s\S]*?<\/local-command-[a-z]+>/g, "")
    .trim();
}

function userBlock(text: string): string | undefined {
  const clean = stripNoise(text);
  return clean ? quote(["[!user]", ...clean.split("\n")]) : undefined;
}

function quizQuestion(input: any): string {
  const options = displayOrder({ question: String(input?.question ?? ""), options: normalizeOptions(input?.options), shuffle: input?.shuffle !== false });
  const body = [String(input?.question ?? "")];
  if (typeof input?.details === "string" && input.details.trim()) body.push(input.details.trim());
  body.push("");
  for (const o of options) body.push(`${o.index}. ${o.label}${o.description && o.value !== DONT_KNOW_VALUE ? `: ${o.description}` : ""}`);
  return callout("question", "Quiz", body.flatMap((l) => l.split("\n")));
}

function askQuestion(input: any): string {
  const body: string[] = [];
  for (const q of input?.questions ?? []) {
    body.push(`**${q.question}**`);
    (q.options ?? []).forEach((o: any, i: number) => body.push(`${i + 1}. ${o.label}${o.description ? `: ${o.description}` : ""}`));
  }
  return callout("question", "Frage", body);
}

export function questionBlock(name: string, input: unknown): string | undefined {
  if (QUIZ_TOOL.test(name)) return quizQuestion(input);
  if (name === ASK_TOOL) return askQuestion(input);
  return undefined;
}

function quizResult(text: string): string | undefined {
  const r = decodeResult(text);
  if (!r) return undefined;
  const lines = formatResultText(r).split("\n");
  const type = r.status === "cancelled" ? "warning" : r.dontKnow ? "info" : r.correct ? "success" : "failure";
  return callout(type, lines[0], lines.slice(1));
}

function askResult(toolUseResult: any, text: string): string {
  const answers = toolUseResult?.answers;
  const body = answers && typeof answers === "object"
    ? Object.entries(answers).map(([q, a]) => `${q} → ${Array.isArray(a) ? a.join(", ") : String(a)}`)
    : [stripNoise(text)];
  return callout("info", "Antwort", body);
}

export function renderEvents(events: Event[], rendered: Set<string>): string[] {
  const toolNames = new Map<string, string>();
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
        toolNames.set(e.id, e.name);
        if (!isQuestionTool(e.name) || rendered.has(e.id)) break;
        const b = questionBlock(e.name, e.input);
        if (b) {
          blocks.push(b);
          rendered.add(e.id);
        }
        break;
      }
      case "tool_result": {
        const name = toolNames.get(e.toolUseId);
        if (name === ASK_TOOL || (e.toolUseResult as any)?.answers) blocks.push(askResult(e.toolUseResult, e.text));
        else {
          const b = quizResult(e.text);
          if (b) blocks.push(b);
        }
        break;
      }
    }
  }
  return blocks;
}
