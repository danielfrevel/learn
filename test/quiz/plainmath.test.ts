import { test } from "node:test";
import assert from "node:assert/strict";
import { plainMath } from "../../src/quiz/plainmath.ts";

test("strips dollar fences", () => {
  assert.equal(plainMath("Sei $x$ reell."), "Sei x reell.");
  assert.equal(plainMath("$$\nf(x)\n$$"), "f(x)");
});

test("rewrites common commands", () => {
  assert.equal(plainMath("$\\lim_{n\\to\\infty} \\frac{1}{n}$"), "lim_{n→∞} (1)/(n)");
  assert.equal(plainMath("$a \\le b \\ne c \\ge d$"), "a ≤ b ≠ c ≥ d");
  assert.equal(plainMath("$\\sqrt{2} \\cdot \\alpha$"), "sqrt(2) · α");
  assert.equal(plainMath("$x^{2}$ und $x_{i}$"), "x^{2} und x_{i}");
});

test("keeps unknown commands by name", () => {
  assert.equal(plainMath("$\\mathbb{R}$"), "mathbb{R}");
});

test("leaves text without math untouched", () => {
  assert.equal(plainMath("Warum?"), "Warum?");
});
