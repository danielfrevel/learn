import { test } from "node:test";
import assert from "node:assert/strict";
import { execFile, execFileSync } from "node:child_process";
import { copyFileSync, mkdtempSync, readFileSync, appendFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const CLI = fileURLToPath(new URL("../../src/mdlog/cli.ts", import.meta.url));
const FIXTURE = fileURLToPath(new URL("../fixtures/transcript.jsonl", import.meta.url));

function run(args: string[], stdin: string, env: Record<string, string>) {
  return execFileSync(process.execPath, [CLI, ...args], { input: stdin, env: { ...process.env, ...env }, encoding: "utf8" });
}

function setup(sessionId: string, seed?: string) {
  const dir = mkdtempSync(join(tmpdir(), "learn-cli-"));
  const transcript = join(dir, `${sessionId}.jsonl`);
  if (seed) copyFileSync(seed, transcript);
  else appendFileSync(transcript, "");
  const log = join(dir, "lesson.md");
  const env = { XDG_STATE_HOME: join(dir, "state"), LEARN_TRANSCRIPT: transcript };
  run(["link", log, "--session", sessionId], "", env);
  return { dir, transcript, log, env };
}

async function syncWhileAppending(payload: object, env: Record<string, string>, transcript: string, line: object) {
  const child = execFile(process.execPath, [CLI, "sync"], { env: { ...process.env, ...env } });
  const exited = new Promise((r) => child.on("exit", r));
  child.stdin!.end(JSON.stringify(payload));
  await new Promise((r) => setTimeout(r, 400));
  appendFileSync(transcript, JSON.stringify(line) + "\n");
  await exited;
}

const quizInput = { question: "Q?", options: [{ label: "a" }, { label: "b" }], correctAnswer: "a", explanation: "secret", shuffle: false };
const QUIZ = "mcp__plugin_learn_quiz__quiz";

test("link backfills, sync is idempotent and appends only new entries", () => {
  const { dir, transcript, log, env } = setup("s1", FIXTURE);
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
  const { transcript, log, env } = setup("s2");
  const payload = { session_id: "s2", transcript_path: transcript, hook_event_name: "PreToolUse", tool_name: QUIZ, tool_use_id: "toolu_9", tool_input: quizInput };
  run(["sync"], JSON.stringify(payload), env);
  const text = readFileSync(log, "utf8");
  assert.ok(text.includes("> [!question] Quiz\n> Q?"));
  assert.ok(!text.includes("secret"));
  appendFileSync(transcript, JSON.stringify({ type: "assistant", message: { role: "assistant", content: [{ type: "tool_use", id: "toolu_9", name: QUIZ, input: quizInput }] } }) + "\n");
  run(["sync"], JSON.stringify({ session_id: "s2", transcript_path: transcript, hook_event_name: "Stop" }), env);
  assert.equal(readFileSync(log, "utf8").split("> [!question] Quiz").length, 2);
});

test("PreToolUse waits for a lagging transcript and keeps the assistant text before the question", async () => {
  const { transcript, log, env } = setup("s3");
  const payload = { session_id: "s3", transcript_path: transcript, hook_event_name: "PreToolUse", tool_name: QUIZ, tool_use_id: "toolu_7", tool_input: quizInput };
  const line = { type: "assistant", message: { role: "assistant", content: [{ type: "text", text: "Vorher" }, { type: "tool_use", id: "toolu_7", name: QUIZ, input: quizInput }] } };
  await syncWhileAppending(payload, env, transcript, line);
  const text = readFileSync(log, "utf8");
  assert.ok(text.includes("Vorher"), text);
  assert.ok(text.indexOf("Vorher") < text.indexOf("> [!question] Quiz"), text);
  assert.equal(text.split("> [!question] Quiz").length, 2);
});

test("Stop waits until the last assistant message reached the transcript", async () => {
  const { transcript, log, env } = setup("s4");
  const payload = { session_id: "s4", transcript_path: transcript, hook_event_name: "Stop", last_assistant_message: "Fertig." };
  const line = { type: "assistant", message: { role: "assistant", content: [{ type: "text", text: "Fertig." }] } };
  await syncWhileAppending(payload, env, transcript, line);
  assert.equal(readFileSync(log, "utf8").trim(), "Fertig.");
});

test("sync without a linked log exits 0 and writes nothing", () => {
  const dir = mkdtempSync(join(tmpdir(), "learn-cli-"));
  const out = run(["sync"], JSON.stringify({ session_id: "nope", transcript_path: join(dir, "x.jsonl") }), { XDG_STATE_HOME: join(dir, "state") });
  assert.equal(out, "");
});
