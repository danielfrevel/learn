import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { deleteState, readState, stateDir, writeState } from "../../src/mdlog/state.ts";

test("state round-trips under XDG_STATE_HOME", () => {
  process.env.XDG_STATE_HOME = mkdtempSync(join(tmpdir(), "learn-state-"));
  assert.ok(stateDir().startsWith(process.env.XDG_STATE_HOME));
  assert.equal(readState("s1"), undefined);
  const s = { logFile: "/v/l.md", transcript: "/t.jsonl", cursor: 12, rendered: ["toolu_1"] };
  writeState("s1", s);
  assert.deepEqual(readState("s1"), s);
  deleteState("s1");
  assert.equal(readState("s1"), undefined);
});
