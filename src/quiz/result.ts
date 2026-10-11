export const RESULT_MARKER = "learn-quiz";

export interface QuizResult {
  status: "answered" | "cancelled";
  question: string;
  details?: string;
  mode: "single-select" | "multi-select";
  options: { index: number; label: string; value: string }[];
  answers: { index: number; label: string; value: string }[];
  correctIndices: number[];
  correct?: boolean;
  dontKnow?: boolean;
  note?: string;
  explanation: string;
}

const numbered = (o: { index: number; label: string }) => `${o.index}. ${o.label}`;

export function formatResultText(r: QuizResult): string {
  if (r.status === "cancelled") return "Quiz abgebrochen, keine Antwort. Weiter ohne Bewertung.";
  const correct = r.options.filter((o) => r.correctIndices.includes(o.index)).map(numbered).join(", ");
  const lines: string[] = [];
  if (r.dontKnow) lines.push("Weiß nicht.", `Richtig wäre: ${correct}`);
  else if (r.correct) lines.push(`✓ Richtig: ${r.answers.map(numbered).join(", ")}`);
  else lines.push(`✗ Falsch: ${r.answers.map(numbered).join(", ")}`, `Richtig wäre: ${correct}`);
  lines.push(`Erklärung: ${r.explanation}`);
  if (r.note) lines.push(`Notiz: ${r.note}`);
  return lines.join("\n");
}

export function encodeResult(r: QuizResult): string {
  return `<!--${RESULT_MARKER} ${JSON.stringify(r)}-->`;
}

const isResult = (v: unknown): v is QuizResult =>
  typeof v === "object" && v !== null && "status" in v && "options" in v && "correctIndices" in v;

export function decodeResult(text: string): QuizResult | undefined {
  const m = text.match(new RegExp(`<!--${RESULT_MARKER} (\\{[\\s\\S]*?\\})-->`));
  try {
    const parsed: unknown = JSON.parse(m ? m[1] : text);
    return isResult(parsed) ? parsed : undefined;
  } catch {
    return undefined;
  }
}
