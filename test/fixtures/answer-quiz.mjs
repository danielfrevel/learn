#!/usr/bin/env node
import { rename, writeFile } from "node:fs/promises";

const url = process.argv[2];
const html = await (await fetch(url)).text();
const katex = await fetch(new URL("/katex/katex.min.css", url));
const answer = JSON.parse(process.env.QUIZ_ANSWER);
const res = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(answer) });
const again = await fetch(url, { method: "POST", body: "{}" });
const report = { page: html.includes(process.env.QUIZ_EXPECT), katex: katex.status, posted: await res.json(), again: again.status };
await writeFile(process.env.QUIZ_REPORT + ".tmp", JSON.stringify(report));
await rename(process.env.QUIZ_REPORT + ".tmp", process.env.QUIZ_REPORT);
