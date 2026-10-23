export const DONT_KNOW_VALUE = "__dont_know__";
export const DONT_KNOW_LABEL = "Ich weiß es nicht";

export interface QuizOption { label: string; value: string; description?: string }
export interface DisplayOption extends QuizOption { index: number }
export interface QuizInput {
  intro?: string;
  question: string;
  details?: string;
  options: QuizOption[];
  multiSelect: boolean;
  correctAnswer: string[];
  explanation: string;
  shuffle: boolean;
}
export type Validation = { ok: true; quiz: QuizInput } | { ok: false; error: string };
export interface GradeResult {
  dontKnow: boolean;
  correct?: boolean;
  answers: DisplayOption[];
}

export const str = (v: unknown): string | undefined => (typeof v === "string" && v.trim() ? v.trim() : undefined);

export const optionTitle = (o: { index: number; label: string }) => (o.index === 0 ? DONT_KNOW_LABEL : `${o.index}. ${o.label}`);

export function normalizeOptions(raw: unknown): QuizOption[] {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>();
  const out: QuizOption[] = [];
  for (const item of raw) {
    const label = str(item?.label);
    if (!label) continue;
    const value = str(item?.value) ?? label;
    if (seen.has(value)) continue;
    seen.add(value);
    const description = str(item?.description);
    out.push(description ? { label, value, description } : { label, value });
  }
  return out;
}

export function validateInput(raw: unknown): Validation {
  const r = (raw ?? {}) as Record<string, unknown>;
  const question = str(r.question);
  if (!question) return { ok: false, error: "`question` is required." };
  const explanation = str(r.explanation);
  if (!explanation) return { ok: false, error: "`explanation` is required." };
  const options = normalizeOptions(r.options);
  if (options.length < 2) return { ok: false, error: "At least two distinct options are required." };
  const multiSelect = r.multiSelect === true;
  const rawCorrect = r.correctAnswer;
  if (multiSelect && !Array.isArray(rawCorrect)) return { ok: false, error: "`correctAnswer` must be an array when `multiSelect` is true." };
  const correctAnswer = [...new Set((Array.isArray(rawCorrect) ? rawCorrect : [rawCorrect]).flatMap((v) => str(v) ?? []))];
  if (correctAnswer.length === 0) return { ok: false, error: "`correctAnswer` is required." };
  if (!multiSelect && correctAnswer.length > 1) return { ok: false, error: "Single-select needs exactly one `correctAnswer`; set `multiSelect: true` for several." };
  const values = new Set(options.map((o) => o.value));
  const unknown = correctAnswer.filter((v) => !values.has(v));
  if (unknown.length > 0) return { ok: false, error: `\`correctAnswer\` references unknown option value(s): ${unknown.join(", ")}. Use the \`value\` of an option.` };
  return {
    ok: true,
    quiz: {
      intro: str(r.intro),
      question,
      details: str(r.details),
      options,
      multiSelect,
      correctAnswer,
      explanation,
      shuffle: r.shuffle !== false,
    },
  };
}

function fnv1a(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h;
}

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Server and log hook run in separate processes and must show the same order,
// so the shuffle is a pure function of the question and option values.
export function displayOrder(quiz: Pick<QuizInput, "question" | "options" | "shuffle">): DisplayOption[] {
  const ordered = [...quiz.options];
  if (quiz.shuffle) {
    const rand = mulberry32(fnv1a(JSON.stringify([quiz.question, quiz.options.map((o) => o.value)])));
    for (let i = ordered.length - 1; i > 0; i--) {
      const j = Math.floor(rand() * (i + 1));
      [ordered[i], ordered[j]] = [ordered[j], ordered[i]];
    }
  }
  const display = ordered.map((o, i) => ({ ...o, index: i + 1 }));
  display.push({ label: DONT_KNOW_LABEL, value: DONT_KNOW_VALUE, index: 0 });
  return display;
}

export function grade(display: DisplayOption[], selected: string[], quiz: Pick<QuizInput, "correctAnswer">): GradeResult {
  if (selected.includes(DONT_KNOW_VALUE)) return { dontKnow: true, answers: [] };
  const byValue = new Map(display.map((o) => [o.value, o]));
  const answers = selected.flatMap((v) => byValue.get(v) ?? []);
  const chosen = new Set(answers.map((o) => o.value));
  const correct = chosen.size === quiz.correctAnswer.length && quiz.correctAnswer.every((v) => chosen.has(v));
  return { dontKnow: false, correct, answers };
}
