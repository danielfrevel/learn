import { test } from "node:test";
import assert from "node:assert/strict";
import { validateShow } from "../../src/quiz/show.ts";

test("validateShow accepts title, body, image", () => {
  const v = validateShow({ title: "Grenzwert", body: "Text", image: "viz-grenzwert-1.png" });
  assert.deepEqual(v, { ok: true, show: { title: "Grenzwert", body: "Text", image: "viz-grenzwert-1.png" } });
});

test("validateShow rejects missing body, path separators and other extensions", () => {
  assert.equal(validateShow({ title: "t" }).ok, false);
  assert.match((validateShow({ title: "t", body: "b", image: "../x.png" }) as any).error, /image/);
  assert.match((validateShow({ title: "t", body: "b", image: "x.jpg" }) as any).error, /image/);
  assert.equal((validateShow({ title: "", body: "b" }) as any).error, "`title` is required.");
});
