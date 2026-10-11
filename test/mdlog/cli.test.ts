import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { copyFileSync, mkdtempSync, readFileSync, appendFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const CLI = fileURLToPath(new URL("../../src/mdlog/cli.ts", import.meta.url));
const FIXTURE = fileURLToPath(new URL("../fixtures/transcript.jsonl", import.meta.url));

function run(args: string[], stdin: string, env: Record<string, string>) {
  return execFileSync(process.execPath, [CLI, ...args], { input: stdin, env: { ...process.env, ...env }, encoding: "utf8" });
}

test("link backfills, sync is idempotent and appends only new entries", () => {
  const dir = mkdtempSync(join(tmpdir(), "learn-cli-"));
  const transcript = join(dir, "s1.jsonl");
  copyFileSync(FIXTURE, transcript);
  const log = join(dir, "lesson.md");
  const env = { XDG_STATE_HOME: join(dir, "state"), LEARN_TRANSCRIPT: transcript };

  run(["link", log, "--session", "s1"], "", env);
  const first = readFileSync(log, "utf8");
  assert.ok(first.startsWith("> [!user]\n> Erklär mir Grenzwerte"));
  assert.ok(first.includes("> [!question] Quiz"));
  assert.ok(first.trimEnd().endsWith("Gut, dann Klausur."));

  run(["sync"], JSON.stringify({ session_id: "s1", transcript_path: transcript, hook_event_name: "Stop" }), env);
  assert.equal(readFileSync(log, "utf8"), first);

  appendFileSync(transcript, '{"type":"assistant","message":{"role":"assistant","content":[{"type":"text","text":"Nachtrag"}]}}\n');
  run(["sync"], JSON.stringify({ session_id: "s1", transcript_path: transcript, hook_event_name: "Stop" }), env);
  assert.ok(readFileSync(log, "utf8").trimEnd().endsWith("Nachtrag"));

  run(["unlink"], JSON.stringify({ session_id: "s1" }), env);
  assert.ok(!existsSync(join(dir, "state", "learn", "mdlog", "s1.json")));
});

test("PreToolUse renders the question from tool_input before the transcript has it", () => {
  const dir = mkdtempSync(join(tmpdir(), "learn-cli-"));
  const transcript = join(dir, "s2.jsonl");
  appendFileSync(transcript, "");
  const log = join(dir, "lesson.md");
  const env = { XDG_STATE_HOME: join(dir, "state"), LEARN_TRANSCRIPT: transcript };
  run(["link", log, "--session", "s2"], "", env);
  const payload = {
    session_id: "s2", transcript_path: transcript, hook_event_name: "PreToolUse",
    tool_name: "mcp__plugin_learn_quiz__quiz", tool_use_id: "toolu_9",
    tool_input: { question: "Q?", options: [{ label: "a" }, { label: "b" }], correctAnswer: "a", explanation: "secret", shuffle: false },
  };
  run(["sync"], JSON.stringify(payload), env);
  const text = readFileSync(log, "utf8");
  assert.ok(text.includes("> [!question] Quiz\n> Q?"));
  assert.ok(!text.includes("secret"));
  appendFileSync(transcript, JSON.stringify({ type: "assistant", message: { role: "assistant", content: [{ type: "tool_use", id: "toolu_9", name: "mcp__plugin_learn_quiz__quiz", input: payload.tool_input }] } }) + "\n");
  run(["sync"], JSON.stringify({ session_id: "s2", transcript_path: transcript, hook_event_name: "Stop" }), env);
  assert.equal(readFileSync(log, "utf8").split("> [!question] Quiz").length, 2);
});

test("sync without a linked log exits 0 and writes nothing", () => {
  const dir = mkdtempSync(join(tmpdir(), "learn-cli-"));
  const out = run(["sync"], JSON.stringify({ session_id: "nope", transcript_path: join(dir, "x.jsonl") }), { XDG_STATE_HOME: join(dir, "state") });
  assert.equal(out, "");
});
