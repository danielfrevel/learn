#!/usr/bin/env node
import { appendFile, rename, writeFile } from "node:fs/promises";
import { request } from "node:http";

const url = new URL(process.argv[2]);
const script = JSON.parse(process.env.QUIZ_SCRIPT ?? "[]");
await appendFile(process.env.QUIZ_REPORT + ".opened", "1\n");

const status = (path) => fetch(new URL(path, url)).then((r) => r.status);
const post = (path, body) => fetch(new URL(url.pathname + path, url), { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
const foreignHost = () =>
  new Promise((ok) => request(url, { method: "GET", headers: { host: "evil.example" } }, (r) => ok(r.statusCode)).end());

const html = await (await fetch(url)).text();
const report = {
  page: html.includes("<title>Lektion</title>"),
  katex: await Promise.all(["/katex/katex.min.css", "/katex/katex.min.js", "/katex/contrib/auto-render.min.js"].map(status)),
  foreignHost: await foreignHost(),
  tabs: [],
};
if (process.env.QUIZ_VIZ) report.viz = await Promise.all([status(url.pathname + "/viz/" + process.env.QUIZ_VIZ), status(url.pathname + "/viz/../package.json")]);

async function writeReport() {
  await writeFile(process.env.QUIZ_REPORT + ".tmp", JSON.stringify(report));
  await rename(process.env.QUIZ_REPORT + ".tmp", process.env.QUIZ_REPORT);
}

async function runTab(tab, step) {
  const entry = { ...tab };
  if (report.tabs.length === 0) {
    const state = await (await fetch(new URL(url.pathname + "/state", url))).json();
    report.stateHasSecret = JSON.stringify(state).includes("Ein Halbes.");
  }
  if (step.answer) entry.answered = await (await post("/tabs/" + tab.id + "/answer", step.answer)).json();
  if (step.finish) entry.finished = (await post("/tabs/" + tab.id + "/finish", step.finish)).status;
  report.tabs.push(entry);
}

const res = await fetch(new URL(url.pathname + "/events", url));
const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
let buffer = "";
let next = 0;
while (next < script.length) {
  const { value, done } = await reader.read();
  if (done) break;
  buffer += value;
  let sep;
  while ((sep = buffer.indexOf("\n\n")) >= 0) {
    const frame = buffer.slice(0, sep);
    buffer = buffer.slice(sep + 2);
    const event = frame.match(/^event: (.*)$/m)?.[1];
    const data = JSON.parse(frame.match(/^data: (.*)$/m)?.[1] ?? "null");
    if (event === "tab" && next < script.length) await runTab(data, script[next++]);
  }
}
await writeReport();
if (!process.env.QUIZ_STAY) process.exit(0);
await new Promise(() => {});
