import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createInterface } from "node:readline";
import { existsSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { decodeResult } from "../../src/quiz/result.ts";

const SERVER = fileURLToPath(new URL("../../src/quiz/server.ts", import.meta.url));

function startServer(onElicit: (params: any) => unknown, env: Record<string, string> = { LEARN_QUIZ_OPENER: "/nonexistent/opener" }) {
  const child = spawn(process.execPath, [SERVER], { stdio: ["pipe", "pipe", "inherit"], env: { ...process.env, ...env } });
  const waiting = new Map<number, (msg: any) => void>();
  let id = 1;
  createInterface({ input: child.stdout }).on("line", (line) => {
    const msg = JSON.parse(line);
    if (msg.method === "elicitation/create") {
      child.stdin.write(JSON.stringify({ jsonrpc: "2.0", id: msg.id, result: onElicit(msg.params) }) + "\n");
      return;
    }
    waiting.get(msg.id)?.(msg);
  });
  const call = (method: string, params: unknown = {}) =>
    new Promise<any>((resolve) => {
      const my = id++;
      waiting.set(my, resolve);
      child.stdin.write(JSON.stringify({ jsonrpc: "2.0", id: my, method, params }) + "\n");
    });
  return { call, stop: () => child.kill() };
}

const quizArgs = {
  question: "Was ist $\\frac{1}{2}$?",
  options: [{ label: "0.5", value: "half" }, { label: "2", value: "two" }],
  correctAnswer: "half",
  explanation: "Ein Halbes.",
  shuffle: false,
};

test("initialize and tools/list expose quiz", async (t) => {
  const s = startServer(() => ({ action: "cancel" }));
  t.after(s.stop);
  const init = await s.call("initialize", { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "t", version: "0" } });
  assert.equal(init.result.serverInfo.name, "learn-quiz");
  const list = await s.call("tools/list");
  assert.equal(list.result.tools[0].name, "quiz");
  assert.ok(list.result.tools[0].inputSchema.required.includes("correctAnswer"));
});

test("tools/call grades a correct single-select answer", async (t) => {
  let seen: any;
  const s = startServer((p) => {
    seen = p;
    return { action: "accept", content: { answer: "half", note: "sicher" } };
  });
  t.after(s.stop);
  const res = await s.call("tools/call", { name: "quiz", arguments: quizArgs });
  assert.equal(seen.mode, "form");
  assert.equal(seen.message, "Was ist (1)/(2)?");
  assert.deepEqual(seen.requestedSchema.properties.answer.oneOf.map((o: any) => o.title), ["1. 0.5", "2. 2", "Ich weiß es nicht"]);
  assert.deepEqual(seen.requestedSchema.required, ["answer"]);
  const text = res.result.content.map((c: any) => c.text).join("\n");
  assert.match(text, /^✓ Richtig: 1\. 0\.5\nErklärung: Ein Halbes\.\nNotiz: sicher/);
  const r = decodeResult(text)!;
  assert.equal(r.outcome, "correct");
  assert.deepEqual(r.correctIndices, [1]);
  assert.equal(res.result.structuredContent, undefined);
});

test("option titles reach the terminal as plain math and map back to values", async (t) => {
  let seen: any;
  const s = startServer((p) => {
    seen = p;
    return { action: "accept", content: { answer: ["1. x ∈ X"] } };
  });
  t.after(s.stop);
  const args = { ...quizArgs, multiSelect: true, correctAnswer: ["half"], options: [{ label: "$x \\in X$", value: "half" }, { label: "$x \\le 2$", value: "two" }] };
  const res = await s.call("tools/call", { name: "quiz", arguments: args });
  assert.deepEqual(seen.requestedSchema.properties.answer.items.enum, ["1. x ∈ X", "2. x ≤ 2", "Ich weiß es nicht"]);
  assert.equal(decodeResult(res.result.content.map((c: any) => c.text).join("\n"))!.outcome, "correct");
});

test("tools/call multi-select uses an array schema and exact-set grading", async (t) => {
  let seen: any;
  const s = startServer((p) => {
    seen = p;
    return { action: "accept", content: { answer: ["1. 0.5"] } };
  });
  t.after(s.stop);
  const res = await s.call("tools/call", { name: "quiz", arguments: { ...quizArgs, multiSelect: true, correctAnswer: ["half", "two"] } });
  assert.equal(seen.requestedSchema.properties.answer.type, "array");
  assert.deepEqual(seen.requestedSchema.properties.answer.items.enum, ["1. 0.5", "2. 2", "Ich weiß es nicht"]);
  const r = decodeResult(res.result.content.map((c: any) => c.text).join("\n"))!;
  assert.equal(r.outcome, "wrong");
  assert.deepEqual(r.correctIndices, [1, 2]);
});

test("tools/call dontKnow and cancel", async (t) => {
  const dk = startServer(() => ({ action: "accept", content: { answer: "__dont_know__" } }));
  t.after(dk.stop);
  const r1 = await dk.call("tools/call", { name: "quiz", arguments: quizArgs });
  assert.equal(decodeResult(r1.result.content[1].text)!.outcome, "dontKnow");
  assert.match(r1.result.content[0].text, /^Weiß nicht\./);
  const cancel = startServer(() => ({ action: "cancel" }));
  t.after(cancel.stop);
  const r2 = await cancel.call("tools/call", { name: "quiz", arguments: quizArgs });
  assert.equal(decodeResult(r2.result.content[1].text)!.outcome, "cancelled");
});

test("tools/call with invalid input returns isError without eliciting", async (t) => {
  let elicited = false;
  const s = startServer(() => { elicited = true; return { action: "cancel" }; });
  t.after(s.stop);
  const res = await s.call("tools/call", { name: "quiz", arguments: { ...quizArgs, correctAnswer: "nope" } });
  assert.equal(res.result.isError, true);
  assert.match(res.result.content[0].text, /nope/);
  assert.equal(elicited, false);
});

const OPENER = fileURLToPath(new URL("../fixtures/answer-quiz.mjs", import.meta.url));

async function answerInBrowser(t: any, answer: unknown) {
  const report = join(mkdtempSync(join(tmpdir(), "quiz-")), "report.json");
  const s = startServer(() => assert.fail("terminal form must not open"), {
    LEARN_QUIZ_OPENER: OPENER, QUIZ_ANSWER: JSON.stringify(answer), QUIZ_EXPECT: JSON.stringify(quizArgs.question).slice(1, -1), QUIZ_REPORT: report,
  });
  t.after(s.stop);
  const res = await s.call("tools/call", { name: "quiz", arguments: quizArgs });
  while (!existsSync(report)) await new Promise((r) => setTimeout(r, 20));
  return { text: res.result.content.map((c: any) => c.text).join("\n"), report: JSON.parse(readFileSync(report, "utf8")) };
}

test("browser quiz serves the page with LaTeX and KaTeX, grades the posted answer", async (t) => {
  const { text, report } = await answerInBrowser(t, { answers: ["half"], note: "sicher" });
  assert.equal(report.page, true);
  assert.equal(report.katex, 200);
  assert.equal(report.posted.outcome, "correct");
  assert.deepEqual(report.posted.correct, ["half"]);
  assert.equal(report.again, 410);
  assert.match(text, /^✓ Richtig: 1\. 0\.5\nErklärung: Ein Halbes\.\nNotiz: sicher/);
});

test("browser quiz cancel ends the tool call without grading", async (t) => {
  const { text } = await answerInBrowser(t, { cancel: true });
  assert.equal(decodeResult(text)!.outcome, "cancelled");
});
