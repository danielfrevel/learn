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
  rating?: number;
  feedback?: string;
}

export interface ShowResult {
  kind: "show";
  title: string;
  body: string;
  image?: string;
  rating?: number;
  feedback?: string;
  cancelled: boolean;
}

export const SHOW_MARKER = "learn-show";

export function formatFeedback(r: { rating?: number; feedback?: string }): string[] {
  return [...(r.rating !== undefined ? [`Verständnis: ${r.rating}/5`] : []), ...(r.feedback ? [`Hilft mir: ${r.feedback}`] : [])];
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
  return [...head, `Erklärung: ${r.explanation}`, ...(r.note ? [`Notiz: ${r.note}`] : []), ...formatFeedback(r)].join("\n");
}

export function formatShowText(r: ShowResult): string {
  const lines = formatFeedback(r);
  if (lines.length) return lines.join("\n");
  return r.cancelled ? "Abgebrochen, keine Rückmeldung." : "Gelesen, keine Rückmeldung.";
}

const encode = (marker: string, r: unknown) => `<!--${marker} ${JSON.stringify(r)}-->`;
export const encodeResult = (r: QuizResult) => encode(RESULT_MARKER, r);
export const encodeShow = (r: ShowResult) => encode(SHOW_MARKER, r);

const markerRe = (marker: string) => new RegExp(`<!--${marker} (\\{[\\s\\S]*?\\})-->`);
const isResult = (v: unknown): v is QuizResult =>
  typeof v === "object" && v !== null && "outcome" in v && "options" in v && "correctIndices" in v;
const isShow = (v: unknown): v is ShowResult =>
  typeof v === "object" && v !== null && (v as ShowResult).kind === "show" && typeof (v as ShowResult).body === "string";

function decode<T>(marker: string, text: string, guard: (v: unknown) => v is T): T | undefined {
  const m = text.match(markerRe(marker));
  if (!m) return undefined;
  try {
    const parsed: unknown = JSON.parse(m[1]);
    return guard(parsed) ? parsed : undefined;
  } catch {
    return undefined;
  }
}

export const decodeResult = (text: string) => decode(RESULT_MARKER, text, isResult);
export const decodeShow = (text: string) => decode(SHOW_MARKER, text, isShow);
