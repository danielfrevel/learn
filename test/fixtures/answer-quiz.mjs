#!/usr/bin/env node
import { rename, writeFile } from "node:fs/promises";
import { request } from "node:http";

const url = new URL(process.argv[2]);
const status = (path) => fetch(new URL(path, url)).then((r) => r.status);
const foreignHost = () =>
  new Promise((ok) => request(url, { method: "GET", headers: { host: "evil.example" } }, (r) => ok(r.statusCode)).end());

const html = await (await fetch(url)).text();
const report = {
  page: html.includes(process.env.QUIZ_EXPECT),
  katex: await Promise.all(["/katex/katex.min.css", "/katex/katex.min.js", "/katex/contrib/auto-render.min.js"].map(status)),
  foreignHost: await foreignHost(),
};
if (process.env.QUIZ_ANSWER) {
  const res = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: process.env.QUIZ_ANSWER });
  report.posted = await res.json();
  report.again = (await fetch(url, { method: "POST", body: "{}" })).status;
}
await writeFile(process.env.QUIZ_REPORT + ".tmp", JSON.stringify(report));
await rename(process.env.QUIZ_REPORT + ".tmp", process.env.QUIZ_REPORT);
