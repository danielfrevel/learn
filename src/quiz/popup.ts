import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { extname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { DONT_KNOW_VALUE, optionTitle, type DisplayOption, type QuizInput } from "./grade.ts";
import { formatResultText, type QuizResult } from "./result.ts";

export type PageView = Pick<QuizInput, "question" | "details" | "multiSelect"> & { options: DisplayOption[] };
export interface Submission { answers: string[]; note?: unknown }
type Settle = (submission: Submission | undefined) => QuizResult;

const KATEX_DIR = fileURLToPath(new URL("../../node_modules/katex/dist/", import.meta.url));
const TYPES: Record<string, string> = {
  ".css": "text/css", ".js": "text/javascript", ".woff2": "font/woff2", ".woff": "font/woff", ".ttf": "font/ttf",
};

const open = new Map<string, { html: string; finish: Settle }>();
let server: Promise<Server> | undefined;

function send(res: ServerResponse, status: number, type: string, body: string | Buffer, cache = "no-store") {
  res.writeHead(status, { "content-type": type, "cache-control": cache });
  res.end(body);
}

async function readJson(req: IncomingMessage): Promise<any> {
  const chunks: Buffer[] = [];
  for await (const c of req) chunks.push(c as Buffer);
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    return undefined;
  }
}

async function serveKatex(res: ServerResponse, rel: string) {
  const file = resolve(KATEX_DIR, rel);
  if (!file.startsWith(KATEX_DIR)) return send(res, 404, "text/plain", "not found");
  try {
    send(res, 200, TYPES[extname(file)] ?? "application/octet-stream", await readFile(file), "max-age=86400");
  } catch {
    send(res, 404, "text/plain", "not found");
  }
}

async function route(req: IncomingMessage, res: ServerResponse) {
  const url = new URL(req.url ?? "/", "http://127.0.0.1");
  if (req.method === "GET" && url.pathname.startsWith("/katex/")) return serveKatex(res, url.pathname.slice("/katex/".length));
  const token = url.pathname.match(/^\/q\/([0-9a-f]{32})$/)?.[1];
  if (!token) return send(res, 404, "text/plain", "not found");
  const entry = open.get(token);
  if (req.method === "GET") return send(res, entry ? 200 : 410, "text/html; charset=utf-8", entry?.html ?? GONE);
  if (req.method !== "POST") return send(res, 405, "text/plain", "method not allowed");
  if (!entry) return send(res, 410, "application/json", JSON.stringify({ gone: true }));
  const body = await readJson(req);
  const answers = Array.isArray(body?.answers) ? body.answers.filter((a: unknown): a is string => typeof a === "string") : [];
  const result = entry.finish(body?.cancel === true ? undefined : { answers, note: body?.note });
  const correct = result.options.filter((o) => result.correctIndices.includes(o.index)).map((o) => o.value);
  send(res, 200, "application/json", JSON.stringify({ outcome: result.outcome, correct, text: formatResultText(result) }));
}

function listen(): Promise<Server> {
  server ??= new Promise((ok, fail) => {
    const s = createServer((req, res) => void route(req, res).catch(() => send(res, 500, "text/plain", "error")));
    s.once("error", fail);
    s.listen(0, "127.0.0.1", () => {
      s.unref();
      ok(s);
    });
  });
  return server;
}

function launch(url: string): Promise<boolean> {
  return new Promise((ok) => {
    const child = spawn(process.env.LEARN_QUIZ_OPENER || "xdg-open", [url], { detached: true, stdio: "ignore" });
    child.once("error", () => ok(false));
    child.once("spawn", () => {
      child.unref();
      ok(true);
    });
  });
}

export async function askInBrowser(view: PageView, settle: Settle): Promise<QuizResult | undefined> {
  if (!existsSync(KATEX_DIR)) return undefined;
  const { port } = (await listen()).address() as AddressInfo;
  const token = randomBytes(16).toString("hex");
  const answered = new Promise<QuizResult>((done) => {
    const finish = (s: Submission | undefined) => {
      open.delete(token);
      const result = settle(s);
      done(result);
      return result;
    };
    open.set(token, { html: page(view), finish });
  });
  if (!(await launch(`http://127.0.0.1:${port}/q/${token}`))) {
    open.delete(token);
    return undefined;
  }
  return answered;
}

export function cancelOpenQuizzes() {
  for (const entry of [...open.values()]) entry.finish(undefined);
}

const GONE = `<!doctype html><meta charset="utf-8"><title>Quiz</title><p>Dieses Quiz ist beendet.</p>`;

function page(view: PageView): string {
  const options = view.options.map((o) => ({ value: o.value, title: optionTitle(o), description: o.description, dontKnow: o.value === DONT_KNOW_VALUE }));
  const data = JSON.stringify({ ...view, options }).replace(/</g, "\\u003c");
  return `<!doctype html>
<html lang="de">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Quiz</title>
<link rel="stylesheet" href="/katex/katex.min.css">
<script defer src="/katex/katex.min.js"></script>
<script defer src="/katex/contrib/auto-render.min.js"></script>
<style>
  :root { color-scheme: light dark; --ok: #2e9d5b; --bad: #d1495b; --line: color-mix(in srgb, currentColor 20%, transparent); }
  body { font: 18px/1.5 system-ui, sans-serif; max-width: 46rem; margin: 3rem auto; padding: 0 1.25rem; }
  h1 { font-size: 1.25rem; font-weight: 600; }
  .details { opacity: .8; }
  label.opt { display: flex; gap: .75rem; align-items: baseline; padding: .7rem .9rem; margin: .5rem 0; border: 1px solid var(--line); border-radius: .5rem; cursor: pointer; }
  label.opt:has(input:checked) { border-color: currentColor; }
  label.opt.correct { border-color: var(--ok); background: color-mix(in srgb, var(--ok) 15%, transparent); }
  label.opt.wrong { border-color: var(--bad); background: color-mix(in srgb, var(--bad) 15%, transparent); }
  .desc { display: block; font-size: .9em; opacity: .7; }
  .dontknow { opacity: .75; }
  textarea { width: 100%; box-sizing: border-box; min-height: 4rem; font: inherit; margin-top: .25rem; }
  .actions { display: flex; gap: .75rem; margin-top: 1rem; }
  button { font: inherit; padding: .5rem 1.1rem; border-radius: .4rem; border: 1px solid var(--line); cursor: pointer; }
  button[type=submit] { font-weight: 600; }
  #result { margin-top: 1.5rem; padding: 1rem; border-radius: .5rem; border: 1px solid var(--line); }
  #result p { white-space: pre-line; margin: 0; }
  .hint { opacity: .6; font-size: .9em; margin-top: 1rem; }
</style>
</head>
<body>
<h1 id="question"></h1>
<p class="details" id="details" hidden></p>
<form id="form">
  <div id="options"></div>
  <label for="note">Notiz (optional)</label>
  <textarea id="note" placeholder="Begründung oder Unsicherheit"></textarea>
  <div class="actions"><button type="submit">Antworten</button><button type="button" id="cancel">Abbrechen</button></div>
</form>
<div id="result" hidden></div>
<script type="application/json" id="data">${data}</script>
<script>
const view = JSON.parse(document.getElementById("data").textContent);
const math = (el) => window.renderMathInElement?.(el, { delimiters: [
  { left: "$$", right: "$$", display: true }, { left: "$", right: "$", display: false },
], throwOnError: false });
const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text !== undefined) e.textContent = text; return e; };
document.getElementById("question").textContent = view.question;
if (view.details) { const d = document.getElementById("details"); d.textContent = view.details; d.hidden = false; }
const box = document.getElementById("options");
for (const o of view.options) {
  const label = el("label", "opt" + (o.dontKnow ? " dontknow" : ""));
  label.dataset.value = o.value;
  const input = el("input");
  input.type = view.multiSelect && !o.dontKnow ? "checkbox" : "radio";
  input.name = "answer";
  input.value = o.value;
  input.dataset.dontKnow = o.dontKnow;
  const text = el("span", "", o.title);
  if (o.description) text.append(el("span", "desc", o.description));
  label.append(input, text);
  box.append(label);
}
box.addEventListener("change", (e) => {
  const picked = e.target;
  for (const i of box.querySelectorAll("input")) {
    if (i === picked) continue;
    if (picked.dataset.dontKnow === "true" || i.dataset.dontKnow === "true" || !view.multiSelect) i.checked = false;
  }
});
const finish = (r) => {
  for (const i of document.querySelectorAll("input, textarea, button")) i.disabled = true;
  const out = document.getElementById("result");
  out.hidden = false;
  if (r.gone) { out.textContent = "Dieses Quiz ist nicht mehr offen."; return; }
  if (r.outcome === "cancelled") { out.textContent = "Abgebrochen. Zurück zum Terminal."; return; }
  const correct = new Set(r.correct);
  for (const l of box.querySelectorAll("label.opt")) {
    if (correct.has(l.dataset.value)) l.classList.add("correct");
    else if (l.querySelector("input").checked) l.classList.add("wrong");
  }
  out.append(el("p", "", r.text), el("div", "hint", "Zurück zum Terminal, die Lektion geht dort weiter."));
  math(out);
};
const submit = (body) => fetch(location.pathname, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) })
  .then((r) => r.json()).then(finish, () => finish({ gone: true }));
document.getElementById("form").addEventListener("submit", (e) => {
  e.preventDefault();
  const answers = [...box.querySelectorAll("input:checked")].map((i) => i.value);
  if (!answers.length) return;
  submit({ answers, note: document.getElementById("note").value });
});
document.getElementById("cancel").addEventListener("click", () => submit({ cancel: true }));
window.addEventListener("load", () => math(document.body));
</script>
</body>
</html>`;
}
