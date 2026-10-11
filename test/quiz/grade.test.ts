import { test } from "node:test";
import assert from "node:assert/strict";
import {
  DONT_KNOW_VALUE, displayOrder, grade, normalizeOptions, validateInput,
} from "../../src/quiz/grade.ts";

const opts = [
  { label: "0" }, { label: "1", value: "one" }, { label: "unendlich", description: "divergiert" },
];

test("normalizeOptions trims, defaults value to label, drops duplicates and empties", () => {
  const out = normalizeOptions([{ label: " 0 " }, { label: "0" }, { label: "  " }, { label: "x", value: " y " }]);
  assert.deepEqual(out, [{ label: "0", value: "0" }, { label: "x", value: "y" }]);
});

test("validateInput rejects fewer than two options", () => {
  const v = validateInput({ question: "q", options: [{ label: "a" }], correctAnswer: "a", explanation: "e" });
  assert.equal(v.ok, false);
});

test("validateInput rejects a correctAnswer that is not an option value", () => {
  const v = validateInput({ question: "q", options: opts, correctAnswer: "nope", explanation: "e" });
  assert.equal(v.ok, false);
  if (!v.ok) assert.match(v.error, /nope/);
});

test("validateInput normalizes a valid single-select input", () => {
  const v = validateInput({ question: "q", options: opts, correctAnswer: "one", explanation: "e" });
  assert.equal(v.ok, true);
  if (v.ok) {
    assert.deepEqual(v.quiz.correctAnswer, ["one"]);
    assert.equal(v.quiz.multiSelect, false);
    assert.equal(v.quiz.shuffle, true);
  }
});

test("validateInput rejects several correct values without multiSelect", () => {
  const v = validateInput({ question: "q", options: opts, correctAnswer: ["one", "0"], explanation: "e" });
  assert.equal(v.ok, false);
});

test("validateInput requires an array correctAnswer for multiSelect", () => {
  const v = validateInput({ question: "q", options: opts, correctAnswer: "one", explanation: "e", multiSelect: true });
  assert.equal(v.ok, false);
});

test("displayOrder is deterministic, appends dontKnow last with index 0", () => {
  const quiz = { question: "q", options: normalizeOptions(opts), shuffle: true };
  const a = displayOrder(quiz);
  const b = displayOrder(quiz);
  assert.deepEqual(a, b);
  assert.equal(a.length, 4);
  assert.equal(a[3].value, DONT_KNOW_VALUE);
  assert.equal(a[3].index, 0);
  assert.deepEqual(a.slice(0, 3).map((o) => o.index), [1, 2, 3]);
});

test("displayOrder keeps given order when shuffle is false", () => {
  const d = displayOrder({ question: "q", options: normalizeOptions(opts), shuffle: false });
  assert.deepEqual(d.slice(0, 3).map((o) => o.value), ["0", "one", "unendlich"]);
});

test("displayOrder changes order for some inputs", () => {
  const many = normalizeOptions(Array.from({ length: 8 }, (_, i) => ({ label: `o${i}` })));
  const orders = new Set(["a", "b", "c", "d"].map((q) => displayOrder({ question: q, options: many, shuffle: true }).map((o) => o.value).join(",")));
  assert.ok(orders.size > 1);
});

test("grade single-select right and wrong", () => {
  const d = displayOrder({ question: "q", options: normalizeOptions(opts), shuffle: false });
  const right = grade(d, ["one"], { correctAnswer: ["one"] });
  assert.equal(right.correct, true);
  assert.equal(right.dontKnow, false);
  assert.deepEqual(right.answers.map((o) => o.value), ["one"]);
  const wrong = grade(d, ["0"], { correctAnswer: ["one"] });
  assert.equal(wrong.correct, false);
});

test("grade multi-select needs the exact set", () => {
  const d = displayOrder({ question: "q", options: normalizeOptions(opts), shuffle: false });
  assert.equal(grade(d, ["0", "one"], { correctAnswer: ["one", "0"] }).correct, true);
  assert.equal(grade(d, ["0"], { correctAnswer: ["one", "0"] }).correct, false);
  assert.equal(grade(d, ["0", "one", "unendlich"], { correctAnswer: ["one", "0"] }).correct, false);
});

test("grade dontKnow wins over any selection", () => {
  const d = displayOrder({ question: "q", options: normalizeOptions(opts), shuffle: false });
  const r = grade(d, ["one", DONT_KNOW_VALUE], { correctAnswer: ["one"] });
  assert.equal(r.dontKnow, true);
  assert.equal(r.correct, undefined);
  assert.deepEqual(r.answers, []);
});
