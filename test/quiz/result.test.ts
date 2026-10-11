import { test } from "node:test";
import assert from "node:assert/strict";
import { decodeResult, encodeResult, formatResultText, type QuizResult } from "../../src/quiz/result.ts";

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

test("decodeResult accepts a bare JSON result as Claude Code stores structured output", () => {
  assert.deepEqual(decodeResult(JSON.stringify(base)), base);
  assert.equal(decodeResult('{"foo":1}'), undefined);
});

test("encode and decode round-trip inside other text", () => {
  const text = "✗ Falsch\n" + encodeResult(base) + "\n";
  assert.deepEqual(decodeResult(text), base);
  assert.equal(decodeResult("nothing here"), undefined);
});
