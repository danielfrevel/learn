import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";
import { decodeResult } from "../../src/quiz/result.ts";

const SERVER = fileURLToPath(new URL("../../src/quiz/server.ts", import.meta.url));

function startServer(onElicit: (params: any) => unknown) {
  const child = spawn(process.execPath, [SERVER], { stdio: ["pipe", "pipe", "inherit"] });
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

test("initialize and tools/list expose quiz", async () => {
  const s = startServer(() => ({ action: "cancel" }));
  const init = await s.call("initialize", { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "t", version: "0" } });
  assert.equal(init.result.serverInfo.name, "learn-quiz");
  const list = await s.call("tools/list");
  assert.equal(list.result.tools[0].name, "quiz");
  assert.ok(list.result.tools[0].inputSchema.required.includes("correctAnswer"));
  s.stop();
});

test("tools/call grades a correct single-select answer", async () => {
  let seen: any;
  const s = startServer((p) => {
    seen = p;
    return { action: "accept", content: { answer: "half", note: "sicher" } };
  });
  const res = await s.call("tools/call", { name: "quiz", arguments: quizArgs });
  assert.equal(seen.mode, "form");
  assert.equal(seen.message, "Was ist (1)/(2)?");
  assert.deepEqual(seen.requestedSchema.properties.answer.oneOf.map((o: any) => o.title), ["1. 0.5", "2. 2", "Ich weiß es nicht"]);
  assert.deepEqual(seen.requestedSchema.required, ["answer"]);
  const text = res.result.content.map((c: any) => c.text).join("\n");
  assert.match(text, /^✓ Richtig: 1\. 0\.5\nErklärung: Ein Halbes\.\nNotiz: sicher/);
  const r = decodeResult(text)!;
  assert.equal(r.correct, true);
  assert.deepEqual(r.correctIndices, [1]);
  assert.equal(res.result.structuredContent.correct, true);
  s.stop();
});

test("tools/call multi-select uses an array schema and exact-set grading", async () => {
  let seen: any;
  const s = startServer((p) => {
    seen = p;
    return { action: "accept", content: { answer: ["1. 0.5"] } };
  });
  const res = await s.call("tools/call", { name: "quiz", arguments: { ...quizArgs, multiSelect: true, correctAnswer: ["half", "two"] } });
  assert.equal(seen.requestedSchema.properties.answer.type, "array");
  assert.deepEqual(seen.requestedSchema.properties.answer.items.enum, ["1. 0.5", "2. 2", "Ich weiß es nicht"]);
  assert.equal(res.result.structuredContent.correct, false);
  assert.deepEqual(res.result.structuredContent.correctIndices, [1, 2]);
  s.stop();
});

test("tools/call dontKnow and cancel", async () => {
  const dk = startServer(() => ({ action: "accept", content: { answer: "__dont_know__" } }));
  const r1 = await dk.call("tools/call", { name: "quiz", arguments: quizArgs });
  assert.equal(r1.result.structuredContent.dontKnow, true);
  assert.match(r1.result.content[0].text, /^Weiß nicht\./);
  dk.stop();
  const cancel = startServer(() => ({ action: "cancel" }));
  const r2 = await cancel.call("tools/call", { name: "quiz", arguments: quizArgs });
  assert.equal(r2.result.structuredContent.status, "cancelled");
  cancel.stop();
});

test("tools/call with invalid input returns isError without eliciting", async () => {
  let elicited = false;
  const s = startServer(() => { elicited = true; return { action: "cancel" }; });
  const res = await s.call("tools/call", { name: "quiz", arguments: { ...quizArgs, correctAnswer: "nope" } });
  assert.equal(res.result.isError, true);
  assert.match(res.result.content[0].text, /nope/);
  assert.equal(elicited, false);
  s.stop();
});
