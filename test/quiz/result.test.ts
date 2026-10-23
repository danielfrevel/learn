import { test } from "node:test";
import assert from "node:assert/strict";
import { decodeResult, decodeShow, encodeResult, encodeShow, formatResultText, formatShowText, type QuizResult, type ShowResult } from "../../src/quiz/result.ts";

const base: QuizResult = {
  outcome: "wrong", question: "q", mode: "single-select",
  options: [{ index: 1, label: "A", value: "a" }, { index: 2, label: "B", value: "b" }],
  answers: [{ index: 2, label: "B", value: "b" }], correctIndices: [1], explanation: "weil",
};

test("formats wrong answer", () => {
  assert.equal(formatResultText(base), "✗ Falsch: 2. B\nRichtig wäre: 1. A\nErklärung: weil");
});

test("formats right answer with note", () => {
  const r: QuizResult = { ...base, outcome: "correct", answers: [{ index: 1, label: "A", value: "a" }], note: "hm" };
  assert.equal(formatResultText(r), "✓ Richtig: 1. A\nErklärung: weil\nNotiz: hm");
});

test("formats dont know", () => {
  const r: QuizResult = { ...base, outcome: "dontKnow", answers: [] };
  assert.equal(formatResultText(r), "Weiß nicht.\nRichtig wäre: 1. A\nErklärung: weil");
});

test("formats cancelled", () => {
  const r: QuizResult = { ...base, outcome: "cancelled", answers: [] };
  assert.equal(formatResultText(r), "Quiz abgebrochen, keine Antwort. Weiter ohne Bewertung.");
});

test("encode and decode round-trip inside other text", () => {
  const text = "✗ Falsch\n" + encodeResult(base) + "\n";
  assert.deepEqual(decodeResult(text), base);
  assert.equal(decodeResult("nothing here"), undefined);
});

const options = base.options;

test("formatResultText appends rating and feedback", () => {
  const r: QuizResult = { ...base, outcome: "correct", answers: [options[0]], rating: 4, feedback: "mehr Beispiele" };
  assert.equal(formatResultText(r), "✓ Richtig: 1. A\nErklärung: weil\nVerständnis: 4/5\nHilft mir: mehr Beispiele");
});

test("formatResultText without rating has no feedback lines", () => {
  assert.equal(formatResultText({ ...base, outcome: "correct", answers: [options[0]] }), "✓ Richtig: 1. A\nErklärung: weil");
});

test("show result round-trips and formats", () => {
  const r: ShowResult = { kind: "show", title: "Grenzwert", body: "Sei $\\epsilon > 0$.", rating: 5, cancelled: false };
  assert.equal(formatShowText(r), "Verständnis: 5/5");
  assert.deepEqual(decodeShow("x\n" + encodeShow(r)), r);
  assert.equal(formatShowText({ kind: "show", title: "t", body: "b", cancelled: false }), "Gelesen, keine Rückmeldung.");
  assert.equal(formatShowText({ kind: "show", title: "t", body: "b", cancelled: true }), "Abgebrochen, keine Rückmeldung.");
  assert.equal(decodeShow(encodeResult(base)), undefined);
});
