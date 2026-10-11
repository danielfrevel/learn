import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { parseArgs } from "node:util";
import { questionBlock, renderEvents } from "./render.ts";
import { deleteState, readState, writeState, type LogState } from "./state.ts";
import { readNewEntries, transcriptPathFor, type Event } from "./transcript.ts";

interface HookPayload {
  session_id?: string;
  transcript_path?: string;
  cwd?: string;
  hook_event_name?: string;
  tool_name?: string;
  tool_use_id?: string;
  tool_input?: unknown;
  last_assistant_message?: string;
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

const append = (state: LogState, blocks: string[]) => {
  if (blocks.length === 0) return;
  mkdirSync(dirname(state.logFile), { recursive: true });
  appendFileSync(state.logFile, blocks.map((b) => b + "\n\n").join(""));
};

const WAIT_STEP_MS = 100;
const WAIT_MAX_MS = 1500;
const sleeper = new Int32Array(new SharedArrayBuffer(4));

// Claude Code writes the transcript a moment after a hook fires. Waiting briefly for the
// entry the hook announces keeps the log complete and in order.
function readTranscript(state: LogState, arrived?: (events: Event[]) => boolean) {
  const events: Event[] = [];
  let cursor = state.cursor;
  for (let waited = 0; ; waited += WAIT_STEP_MS) {
    const fresh = readNewEntries(state.transcript, cursor);
    events.push(...fresh.events);
    cursor = fresh.cursor;
    if (!arrived || arrived(events) || waited >= WAIT_MAX_MS) return { events, cursor };
    Atomics.wait(sleeper, 0, 0, WAIT_STEP_MS);
  }
}

function expectedEntry(payload: HookPayload): ((events: Event[]) => boolean) | undefined {
  if (payload.hook_event_name === "PreToolUse" && payload.tool_use_id) {
    const id = payload.tool_use_id;
    return (events) => events.some((e) => e.kind === "tool_use" && e.id === id);
  }
  const last = payload.last_assistant_message?.trim();
  if (payload.hook_event_name === "Stop" && last) {
    const tail = last.slice(-80);
    return (events) => events.some((e) => e.kind === "assistant_text" && e.text.trim().endsWith(tail));
  }
  return undefined;
}

function sync(sessionId: string, payload: HookPayload): void {
  const state = readState(sessionId);
  if (!state) return;
  const before = JSON.stringify(state);
  if (payload.transcript_path) state.transcript = payload.transcript_path;
  const rendered = new Set(state.rendered);
  const parsed = readTranscript(state, expectedEntry(payload));
  const blocks = renderEvents(parsed.events, rendered);
  state.cursor = parsed.cursor;
  if (payload.hook_event_name === "PreToolUse" && payload.tool_name && payload.tool_use_id && !rendered.has(payload.tool_use_id)) {
    const q = questionBlock(payload.tool_name, payload.tool_input);
    if (q) {
      blocks.push(q);
      rendered.add(payload.tool_use_id);
    }
  }
  append(state, blocks);
  state.rendered = [...rendered];
  if (JSON.stringify(state) !== before) writeState(sessionId, state);
}

function main(): void {
  const { values, positionals } = parseArgs({
    args: process.argv.slice(2),
    options: { session: { type: "string" }, cwd: { type: "string" } },
    allowPositionals: true,
  });
  const [cmd, target] = positionals;
  const payload = readPayload();
  const sessionId = values.session ?? payload.session_id ?? process.env.CLAUDE_CODE_SESSION_ID;
  if (!sessionId) throw new Error("no session id: pass --session or run from a hook");
  const cwd = values.cwd ?? payload.cwd ?? process.cwd();
  switch (cmd) {
    case "link": {
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
