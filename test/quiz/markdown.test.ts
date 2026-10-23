import { test } from "node:test";
import assert from "node:assert/strict";
import { renderMarkdown } from "../../src/quiz/markdown.ts";

test("renders markdown to html", () => {
  assert.equal(renderMarkdown("Ein **Satz**.").trim(), "<p>Ein <strong>Satz</strong>.</p>");
});

test("keeps inline and display math untouched", () => {
  const html = renderMarkdown("Sei $a_1 * a_2$ und\n\n$$\\sum_{i=1}^n x_i$$\n\nfertig.");
  assert.ok(html.includes("$a_1 * a_2$"), html);
  assert.ok(html.includes("$$\\sum_{i=1}^n x_i$$"), html);
  assert.ok(!html.includes("<em>"), html);
});

test("escapes html in math and raw html blocks", () => {
  assert.ok(renderMarkdown("$a < b$").includes("$a &lt; b$"));
  const html = renderMarkdown("<script>alert(1)</script>\n\nText");
  assert.ok(!html.includes("<script>"), html);
  assert.ok(html.includes("&lt;script&gt;"), html);
});

test("dollar inside code stays code", () => {
  assert.ok(renderMarkdown("`$x$`").includes("<code>$x$</code>"));
});
