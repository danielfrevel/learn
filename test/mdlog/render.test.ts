import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { parseTranscript } from "../../src/mdlog/transcript.ts";
import { questionBlock, renderEvents } from "../../src/mdlog/render.ts";

const FIXTURE = fileURLToPath(new URL("../fixtures/transcript.jsonl", import.meta.url));
const { events } = parseTranscript(readFileSync(FIXTURE), 0);

test("renders the fixture in order", () => {
  const blocks = renderEvents(events, new Set());
  assert.equal(blocks[0], "> [!user]\n> Erklär mir Grenzwerte");
  assert.equal(blocks[1], "Erst eine Frage.\n\n$\\lim_{n\\to\\infty} \\frac{1}{n}$");
  assert.equal(blocks[2], [
    "> [!question] Quiz",
    "> Was ist $\\lim_{n\\to\\infty} \\frac{1}{n}$?",
    ">",
    "> 1. 0",
    "> 2. 1",
    "> 0. Ich weiß es nicht",
  ].join("\n"));
  assert.equal(blocks[3], "> [!success] ✓ Richtig: 1. 0\n> Erklärung: Geheim");
  assert.equal(blocks[4], [
    "> [!question] Frage",
    "> **Was willst du erreichen?**",
    "> 1. Klausur: EA und Klausur",
    "> 2. Verstehen: Tiefe",
  ].join("\n"));
  assert.equal(blocks[5], "> [!info] Antwort\n> Was willst du erreichen? → Klausur");
  assert.equal(blocks[6], "Gut, dann Klausur.");
  assert.equal(blocks.length, 7);
});

test("question block never contains correctAnswer or explanation", () => {
  const blocks = renderEvents(events, new Set());
  assert.ok(!blocks[2].includes("Geheim") && !blocks[2].includes("zero"));
});

test("already rendered question is skipped", () => {
  const blocks = renderEvents(events, new Set(["toolu_1"]));
  assert.equal(blocks.length, 6);
  assert.ok(!blocks.some((b) => b.startsWith("> [!question] Quiz")));
});

test("questionBlock from raw quiz tool_input uses the deterministic display order", () => {
  const input = { question: "q", options: [{ label: "a" }, { label: "b" }, { label: "c" }], correctAnswer: "a", explanation: "x" };
  const block = questionBlock("mcp__plugin_learn_quiz__quiz", input)!;
  const again = questionBlock("mcp__plugin_learn_quiz__quiz", input)!;
  assert.equal(block, again);
  assert.match(block, /> 1\. [abc]\n> 2\. [abc]\n> 3\. [abc]\n> 0\. Ich weiß es nicht$/);
});

test("wrong and dontKnow results use failure and info callouts", () => {
  const wrong = renderEvents([{ kind: "tool_result", toolUseId: "t", text: '✗\n<!--learn-quiz {"status":"answered","question":"q","mode":"single-select","options":[{"index":1,"label":"A","value":"a"},{"index":2,"label":"B","value":"b"}],"answers":[{"index":2,"label":"B","value":"b"}],"correctIndices":[1],"correct":false,"explanation":"e"}-->', toolUseResult: undefined }], new Set());
  assert.equal(wrong[0], "> [!failure] ✗ Falsch: 2. B\n> Richtig wäre: 1. A\n> Erklärung: e");
  const dk = renderEvents([{ kind: "tool_result", toolUseId: "t", text: '<!--learn-quiz {"status":"answered","question":"q","mode":"single-select","options":[{"index":1,"label":"A","value":"a"}],"answers":[],"correctIndices":[1],"dontKnow":true,"explanation":"e","note":"n"}-->', toolUseResult: undefined }], new Set());
  assert.equal(dk[0], "> [!info] Weiß nicht.\n> Richtig wäre: 1. A\n> Erklärung: e\n> Notiz: n");
});

test("user text strips command tags and system reminders", () => {
  const blocks = renderEvents([{ kind: "user_text", text: "<command-message>x</command-message>\n<command-name>/foo</command-name>\nhallo <system-reminder>noise</system-reminder>" }], new Set());
  assert.equal(blocks[0], "> [!user]\n> hallo");
});

test("tool results of other tools render nothing", () => {
  const blocks = renderEvents([{ kind: "tool_use", id: "x", name: "Bash", input: {} }, { kind: "tool_result", toolUseId: "x", text: "ls output", toolUseResult: undefined }], new Set());
  assert.deepEqual(blocks, []);
});
