import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { isQuestionTool, questionBlock, renderEvents } from "./render.ts";
import { deleteState, readState, writeState, type LogState } from "./state.ts";
import { parseTranscript, transcriptPathFor } from "./transcript.ts";

interface HookPayload {
  session_id?: string;
  transcript_path?: string;
  cwd?: string;
  hook_event_name?: string;
  tool_name?: string;
  tool_use_id?: string;
  tool_input?: unknown;
}

function readPayload(): HookPayload {
  if (process.stdin.isTTY) return {};
  try {
    const raw = readFileSync(0, "utf8").trim();
    return raw ? (JSON.parse(raw) as HookPayload) : {};
  } catch {
    return {};
  }
}

function flag(args: string[], name: string): string | undefined {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
}

function append(state: LogState, blocks: string[]): void {
  if (blocks.length === 0) return;
  mkdirSync(dirname(state.logFile), { recursive: true });
  const existing = existsSync(state.logFile) ? readFileSync(state.logFile, "utf8") : "";
  const prefix = existing.length === 0 || existing.endsWith("\n\n") ? "" : existing.endsWith("\n") ? "\n" : "\n\n";
  appendFileSync(state.logFile, prefix + blocks.join("\n\n") + "\n");
}

const WAIT_STEP_MS = 100;
const WAIT_MAX_MS = 1500;

// Claude Code writes the transcript a moment after the PreToolUse hook fires.
// Waiting briefly for the tool_use entry keeps the assistant text ahead of the question.
function readTranscript(state: LogState, awaitToolUseId?: string) {
  let parsed = parseTranscript(readFileSync(state.transcript), state.cursor);
  const seen = () => parsed.events.some((e) => e.kind === "tool_use" && e.id === awaitToolUseId);
  for (let waited = 0; awaitToolUseId && !seen() && waited < WAIT_MAX_MS; waited += WAIT_STEP_MS) {
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, WAIT_STEP_MS);
    parsed = parseTranscript(readFileSync(state.transcript), state.cursor);
  }
  return parsed;
}

function sync(sessionId: string, payload: HookPayload): void {
  const state = readState(sessionId);
  if (!state) return;
  if (payload.transcript_path) state.transcript = payload.transcript_path;
  const rendered = new Set(state.rendered);
  const blocks: string[] = [];
  if (existsSync(state.transcript)) {
    const awaitId = payload.hook_event_name === "PreToolUse" && payload.tool_name && isQuestionTool(payload.tool_name) ? payload.tool_use_id : undefined;
    const parsed = readTranscript(state, awaitId);
    blocks.push(...renderEvents(parsed.events, rendered));
    state.cursor = parsed.cursor;
  }
  if (payload.hook_event_name === "PreToolUse" && payload.tool_name && payload.tool_use_id && !rendered.has(payload.tool_use_id)) {
    const q = questionBlock(payload.tool_name, payload.tool_input);
    if (q) {
      blocks.push(q);
      rendered.add(payload.tool_use_id);
    }
  }
  append(state, blocks);
  state.rendered = [...rendered];
  writeState(sessionId, state);
}

function main(): void {
  const [cmd, ...args] = process.argv.slice(2);
  const payload = readPayload();
  const sessionId = flag(args, "--session") ?? payload.session_id ?? process.env.CLAUDE_CODE_SESSION_ID;
  if (!sessionId) throw new Error("no session id: pass --session or run from a hook");
  const cwd = flag(args, "--cwd") ?? payload.cwd ?? process.cwd();
  switch (cmd) {
    case "link": {
      const flagValues = new Set([flag(args, "--session"), flag(args, "--cwd")]);
      const target = args.find((a) => !a.startsWith("--") && !flagValues.has(a));
      if (!target) throw new Error("usage: link <file>");
      const logFile = resolve(cwd, target);
      mkdirSync(dirname(logFile), { recursive: true });
      if (!existsSync(logFile)) writeFileSync(logFile, "");
      const transcript = process.env.LEARN_TRANSCRIPT ?? payload.transcript_path ?? transcriptPathFor(cwd, sessionId);
      writeState(sessionId, { logFile, transcript, cursor: 0, rendered: [] });
      sync(sessionId, payload);
      process.stdout.write(`linked ${logFile}\n`);
      return;
    }
    case "unlink":
      deleteState(sessionId);
      return;
    case "sync":
      sync(sessionId, payload);
      return;
    default:
      throw new Error("usage: cli.ts <link <file>|unlink|sync> [--session ID] [--cwd DIR]");
  }
}

// Exit code stays 0 on purpose: a failing log hook must never block the session.
try {
  main();
} catch (err) {
  process.stderr.write(`learn-mdlog: ${err instanceof Error ? err.message : String(err)}\n`);
}
