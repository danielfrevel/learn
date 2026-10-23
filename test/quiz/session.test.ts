import { test } from "node:test";
import assert from "node:assert/strict";
import { displayOrder } from "../../src/quiz/grade.ts";
import type { QuizResult } from "../../src/quiz/result.ts";
import { answerTab, cancelAll, createSession, finishTab, openTab, snapshot, type PageView, type SessionEvent, type Submission } from "../../src/quiz/session.ts";

const view: PageView = { question: "q", multiSelect: false, options: displayOrder({ question: "q", options: [{ label: "A", value: "a" }, { label: "B", value: "b" }], shuffle: false }) };
const grade = (s: Submission | undefined): QuizResult => ({ outcome: s ? (s.answers[0] === "a" ? "correct" : "wrong") : "cancelled", question: "q", mode: "single-select", options: [], answers: [], correctIndices: [1], explanation: "geheim" });

test("quiz tab: answer then finish resolves with result and rating", async () => {
  const s = createSession();
  const events: SessionEvent[] = [];
  s.listeners.add((e) => events.push(e));
  const { id, done } = openTab(s, { kind: "quiz", title: "q", view, grade });
  assert.equal(snapshot(s)[0].status, "open");
  assert.ok(!JSON.stringify(snapshot(s)).includes("geheim"));
  assert.ok(!JSON.stringify(events).includes("geheim"));
  assert.equal(finishTab(s, id, { rating: 3 }).status, 409);
  const a = answerTab(s, id, { answers: ["a"] });
  assert.equal(a.status, 200);
  assert.equal((a.body as any).outcome, "correct");
  assert.equal(finishTab(s, id, { rating: 7 }).status, 400);
  assert.equal(finishTab(s, id, { rating: 4, feedback: "mehr" }).status, 200);
  assert.deepEqual(await done, { result: { ...grade({ answers: ["a"] }) }, rating: 4, feedback: "mehr", cancelled: false });
  assert.deepEqual(events.map((e) => [e.type, e.tab.status]), [["tab", "open"], ["update", "answered"], ["update", "done"]]);
});

test("show tab: finish resolves with rating only", async () => {
  const s = createSession();
  const { id, done } = openTab(s, { kind: "show", title: "t", bodyHtml: "<p>x</p>" });
  assert.equal(answerTab(s, id, { answers: [] }).status, 409);
  finishTab(s, id, { rating: 5 });
  const out = await done;
  assert.equal(out.rating, 5);
  assert.equal(out.result, undefined);
  assert.equal(out.cancelled, false);
});

test("cancel after answer keeps the result, cancel before answer yields cancelled outcome", async () => {
  const s = createSession();
  const a = openTab(s, { kind: "quiz", title: "q", view, grade });
  answerTab(s, a.id, { answers: ["b"] });
  finishTab(s, a.id, { cancel: true });
  assert.equal((await a.done).result?.outcome, "wrong");
  assert.equal((await a.done).cancelled, true);
  const b = openTab(s, { kind: "quiz", title: "q", view, grade });
  answerTab(s, b.id, { cancel: true });
  assert.equal((await b.done).result?.outcome, "cancelled");
});

test("cancelAll ends every open tab, second finish is 409, unknown id is 404", async () => {
  const s = createSession();
  const a = openTab(s, { kind: "show", title: "t", bodyHtml: "" });
  cancelAll(s);
  assert.equal((await a.done).cancelled, true);
  assert.equal(finishTab(s, a.id, { rating: 1 }).status, 409);
  assert.equal(finishTab(s, 99, { rating: 1 }).status, 404);
});

test("public result carries the picked values and note, never for a cancelled answer", () => {
  const s = createSession();
  const a = openTab(s, { kind: "quiz", title: "q", view, grade });
  answerTab(s, a.id, { answers: ["b"], note: " geraten " });
  const pub = snapshot(s)[0].result!;
  assert.deepEqual(pub.answers, ["b"]);
  assert.equal(pub.note, "geraten");
  const b = openTab(s, { kind: "quiz", title: "q", view, grade });
  answerTab(s, b.id, { cancel: true });
  assert.equal(snapshot(s)[1].status, "cancelled");
  assert.equal(snapshot(s)[1].result, undefined);
});
