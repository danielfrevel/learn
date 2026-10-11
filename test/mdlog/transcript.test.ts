import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { parseTranscript, transcriptPathFor } from "../../src/mdlog/transcript.ts";

const FIXTURE = fileURLToPath(new URL("../fixtures/transcript.jsonl", import.meta.url));
const buf = readFileSync(FIXTURE);

test("parses user, assistant, tool_use and tool_result; skips meta, sidechain, attachments", () => {
  const { events, cursor } = parseTranscript(buf, 0);
  assert.equal(cursor, buf.length);
  assert.deepEqual(events.map((e) => e.kind), [
    "user_text", "assistant_text", "tool_use", "tool_result", "tool_use", "tool_result", "assistant_text",
  ]);
  assert.equal(events[0].kind === "user_text" && events[0].text, "Erklär mir Grenzwerte");
  const tu = events[2];
  assert.ok(tu.kind === "tool_use" && tu.name === "mcp__plugin_learn_quiz__quiz" && tu.id === "toolu_1");
  const tr = events[3];
  assert.ok(tr.kind === "tool_result" && tr.toolUseId === "toolu_1" && tr.text.includes("<!--learn-quiz"));
  const ask = events[5];
  assert.ok(ask.kind === "tool_result" && (ask.toolUseResult as any).answers["Was willst du erreichen?"] === "Klausur");
});

test("does not consume a trailing partial line", () => {
  const partial = Buffer.concat([buf, Buffer.from('{"type":"assistant","uuid":"a4","message":{"role":"assistant","content":[{"type":"text","text":"unfinished')]);
  const first = parseTranscript(partial, 0);
  assert.equal(first.cursor, buf.length);
  assert.equal(first.events.length, 7);
  const completed = Buffer.concat([partial, Buffer.from('"}]}}\n')]);
  const second = parseTranscript(completed, first.cursor);
  assert.equal(second.events.length, 1);
  assert.equal(second.cursor, completed.length);
});

test("skips unparseable lines", () => {
  const broken = Buffer.from('not json\n{"type":"assistant","message":{"role":"assistant","content":[{"type":"text","text":"ok"}]}}\n');
  const { events } = parseTranscript(broken, 0);
  assert.deepEqual(events, [{ kind: "assistant_text", text: "ok" }]);
});

test("transcriptPathFor encodes cwd like Claude Code", () => {
  const p = transcriptPathFor("/home/dan/Documents/Uni/Algo Mathe", "abc");
  assert.ok(p.endsWith("/.claude/projects/-home-dan-Documents-Uni-Algo-Mathe/abc.jsonl"));
});
