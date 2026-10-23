import { randomBytes } from "node:crypto";
import { str, type DisplayOption, type QuizInput } from "./grade.ts";
import { formatResultText, type Outcome, type QuizResult } from "./result.ts";

export type PageView = Pick<QuizInput, "question" | "details" | "multiSelect"> & { options: DisplayOption[] };
export interface Submission { answers: string[]; note?: unknown }
export type TabStatus = "open" | "answered" | "done" | "cancelled";
export interface Feedback { rating?: number; feedback?: string }
export type TabInput =
  | { kind: "quiz"; title: string; introHtml?: string; view: PageView; grade: (s: Submission | undefined) => QuizResult }
  | { kind: "show"; title: string; bodyHtml: string; image?: string };
export interface PublicTab {
  id: number;
  kind: "quiz" | "show";
  title: string;
  status: TabStatus;
  introHtml?: string;
  view?: PageView;
  bodyHtml?: string;
  image?: string;
  result?: { outcome: Outcome; correct: string[]; answers: string[]; note?: string; text: string };
  rating?: number;
  feedback?: string;
}
export interface TabOutcome { result?: QuizResult; rating?: number; feedback?: string; cancelled: boolean }
export type SessionEvent = { type: "tab" | "update"; tab: PublicTab };
export interface Session { token: string; listeners: Set<(e: SessionEvent) => void> }
export interface Reply { status: number; body: unknown }

interface Tab {
  id: number;
  input: TabInput;
  status: TabStatus;
  result?: QuizResult;
  picked?: string[];
  note?: string;
  rating?: number;
  feedback?: string;
  resolve: (o: TabOutcome) => void;
}

const tabsOf = new WeakMap<Session, Tab[]>();
const tabs = (s: Session) => tabsOf.get(s) ?? [];

export function createSession(): Session {
  const s: Session = { token: randomBytes(16).toString("hex"), listeners: new Set() };
  tabsOf.set(s, []);
  return s;
}

const correctValues = (r: QuizResult) => r.options.filter((o) => r.correctIndices.includes(o.index)).map((o) => o.value);

function publicTab(t: Tab): PublicTab {
  const { kind, title } = t.input;
  const base: PublicTab = { id: t.id, kind, title, status: t.status, rating: t.rating, feedback: t.feedback };
  if (t.input.kind === "quiz") {
    base.introHtml = t.input.introHtml;
    base.view = t.input.view;
    if (t.result && t.result.outcome !== "cancelled") {
      base.result = { outcome: t.result.outcome, correct: correctValues(t.result), answers: t.picked ?? [], note: t.note, text: formatResultText(t.result) };
    }
  } else {
    base.bodyHtml = t.input.bodyHtml;
    base.image = t.input.image;
  }
  return base;
}

function emit(s: Session, type: SessionEvent["type"], t: Tab) {
  const tab = publicTab(t);
  for (const l of s.listeners) l({ type, tab });
}

export function openTab(s: Session, input: TabInput): { id: number; done: Promise<TabOutcome> } {
  const list = tabs(s);
  const id = list.length + 1;
  const done = new Promise<TabOutcome>((resolve) => {
    const tab: Tab = { id, input, status: "open", resolve };
    list.push(tab);
    emit(s, "tab", tab);
  });
  return { id, done };
}

export const snapshot = (s: Session): PublicTab[] => tabs(s).map(publicTab);

function settle(s: Session, t: Tab, status: "done" | "cancelled") {
  t.status = status;
  t.resolve({ result: t.result, rating: t.rating, feedback: t.feedback, cancelled: status === "cancelled" });
  emit(s, "update", t);
}

export function answerTab(s: Session, id: number, sub: Submission | { cancel: true }): Reply {
  const t = tabs(s).find((x) => x.id === id);
  if (!t) return { status: 404, body: { error: "no such tab" } };
  if (t.input.kind !== "quiz" || t.status !== "open") return { status: 409, body: { error: "tab is not open for an answer" } };
  if ("cancel" in sub) {
    t.result = t.input.grade(undefined);
    settle(s, t, "cancelled");
    return { status: 200, body: { cancelled: true } };
  }
  t.result = t.input.grade(sub);
  t.picked = sub.answers;
  t.note = str(sub.note);
  t.status = "answered";
  emit(s, "update", t);
  return { status: 200, body: publicTab(t).result };
}

const validRating = (r: unknown): r is number => Number.isInteger(r) && (r as number) >= 1 && (r as number) <= 5;

export function finishTab(s: Session, id: number, fb: Feedback | { cancel: true }): Reply {
  const t = tabs(s).find((x) => x.id === id);
  if (!t) return { status: 404, body: { error: "no such tab" } };
  const expected = t.input.kind === "quiz" ? "answered" : "open";
  if (t.status !== expected) return { status: 409, body: { error: "tab is not ready to finish" } };
  if ("cancel" in fb) {
    settle(s, t, "cancelled");
    return { status: 200, body: { cancelled: true } };
  }
  if (!validRating(fb.rating)) return { status: 400, body: { error: "rating must be an integer from 1 to 5" } };
  t.rating = fb.rating;
  t.feedback = typeof fb.feedback === "string" && fb.feedback.trim() ? fb.feedback.trim() : undefined;
  settle(s, t, "done");
  return { status: 200, body: { ok: true } };
}

export function cancelAll(s: Session): void {
  for (const t of tabs(s)) {
    if (t.status === "open" && t.input.kind === "quiz") t.result = t.input.grade(undefined);
    if (t.status === "open" || t.status === "answered") settle(s, t, "cancelled");
  }
}
