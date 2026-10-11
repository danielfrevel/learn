import { optionTitle } from "./grade.ts";

export const RESULT_MARKER = "learn-quiz";

export type Outcome = "correct" | "wrong" | "dontKnow" | "cancelled";
export interface ResultOption { index: number; label: string; value: string }

export interface QuizResult {
  outcome: Outcome;
  question: string;
  details?: string;
  mode: "single-select" | "multi-select";
  options: ResultOption[];
  answers: ResultOption[];
  correctIndices: number[];
  note?: string;
  explanation: string;
}

export const toResultOption = ({ index, label, value }: ResultOption): ResultOption => ({ index, label, value });

export function formatResultText(r: QuizResult): string {
  if (r.outcome === "cancelled") return "Quiz abgebrochen, keine Antwort. Weiter ohne Bewertung.";
  const correct = r.options.filter((o) => r.correctIndices.includes(o.index)).map(optionTitle).join(", ");
  const chosen = r.answers.map(optionTitle).join(", ");
  const head = {
    correct: [`✓ Richtig: ${chosen}`],
    wrong: [`✗ Falsch: ${chosen}`, `Richtig wäre: ${correct}`],
    dontKnow: ["Weiß nicht.", `Richtig wäre: ${correct}`],
  }[r.outcome];
  return [...head, `Erklärung: ${r.explanation}`, ...(r.note ? [`Notiz: ${r.note}`] : [])].join("\n");
}

export function encodeResult(r: QuizResult): string {
  return `<!--${RESULT_MARKER} ${JSON.stringify(r)}-->`;
}

const MARKER_RE = new RegExp(`<!--${RESULT_MARKER} (\\{[\\s\\S]*?\\})-->`);
const isResult = (v: unknown): v is QuizResult =>
  typeof v === "object" && v !== null && "outcome" in v && "options" in v && "correctIndices" in v;

export function decodeResult(text: string): QuizResult | undefined {
  const m = text.match(MARKER_RE);
  if (!m) return undefined;
  try {
    const parsed: unknown = JSON.parse(m[1]);
    return isResult(parsed) ? parsed : undefined;
  } catch {
    return undefined;
  }
}
