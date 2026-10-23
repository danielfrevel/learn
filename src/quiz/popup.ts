import { spawn } from "node:child_process";
import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { extname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { renderMarkdown } from "./markdown.ts";
import { page } from "./page.ts";
import type { QuizResult } from "./result.ts";
import {
  answerTab, cancelAll, createSession, finishTab, openTab, snapshot,
  type PageView, type Session, type SessionEvent, type Submission, type TabInput, type TabOutcome,
} from "./session.ts";
import { IMAGE_NAME, type ShowInput } from "./show.ts";

export type { PageView, Submission, TabOutcome } from "./session.ts";

const KATEX_DIR = fileURLToPath(new URL("../../node_modules/katex/dist/", import.meta.url));
const VIZ_DIR = process.env.LEARN_VIZ_DIR || join(process.cwd(), "viz");
const TYPES: Record<string, string> = {
  ".css": "text/css", ".js": "text/javascript", ".woff2": "font/woff2", ".woff": "font/woff", ".ttf": "font/ttf",
  ".png": "image/png", ".svg": "image/svg+xml",
};

const LOAD_TIMEOUT_MS = Number(process.env.LEARN_QUIZ_LOAD_TIMEOUT_MS) || 10_000;

let session: Session | undefined;
let server: Promise<Server> | undefined;

function send(res: ServerResponse, status: number, type: string, body: string | Buffer, cache = "no-store") {
  res.writeHead(status, { "content-type": type, "cache-control": cache });
  res.end(body);
}

const json = (res: ServerResponse, status: number, body: unknown) => send(res, status, "application/json", JSON.stringify(body));

async function readJson(req: IncomingMessage): Promise<any> {
  const chunks: Buffer[] = [];
  for await (const c of req) chunks.push(c as Buffer);
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    return undefined;
  }
}

async function serveFile(res: ServerResponse, dir: string, rel: string, cache: string) {
  const file = resolve(dir, rel);
  if (!file.startsWith(dir)) return send(res, 404, "text/plain", "not found");
  try {
    send(res, 200, TYPES[extname(file)] ?? "application/octet-stream", await readFile(file), cache);
  } catch {
    send(res, 404, "text/plain", "not found");
  }
}

function serveEvents(req: IncomingMessage, res: ServerResponse, s: Session) {
  res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-store", connection: "keep-alive" });
  const write = (event: string, data: unknown) => res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  write("state", { tabs: snapshot(s) });
  const listener = (e: SessionEvent) => write(e.type, e.tab);
  s.listeners.add(listener);
  req.socket.unref();
  req.on("close", () => s.listeners.delete(listener));
  for (const w of [...connectWaiters]) w();
}

async function route(req: IncomingMessage, res: ServerResponse) {
  // Any other Host means a page from elsewhere reached this port via DNS rebinding.
  if (req.headers.host !== `127.0.0.1:${req.socket.localPort}`) return send(res, 403, "text/plain", "forbidden");
  const url = new URL(req.url ?? "/", "http://127.0.0.1");
  const path = url.pathname;
  if (req.method === "GET" && path.startsWith("/katex/")) return serveFile(res, KATEX_DIR, path.slice("/katex/".length), "max-age=86400");
  const m = path.match(/^\/s\/([0-9a-f]{32})(\/.*)?$/);
  const s = session;
  if (!m || !s || m[1] !== s.token) return send(res, 404, "text/plain", "not found");
  const rest = m[2] ?? "";
  if (req.method === "GET") {
    if (rest === "") return send(res, 200, "text/html; charset=utf-8", page(s.token));
    if (rest === "/state") return json(res, 200, { tabs: snapshot(s) });
    if (rest === "/events") return serveEvents(req, res, s);
    const viz = rest.match(/^\/viz\/([^/]+)$/);
    if (viz && IMAGE_NAME.test(viz[1])) return serveFile(res, VIZ_DIR, viz[1], "no-store");
    return send(res, 404, "text/plain", "not found");
  }
  if (req.method !== "POST") return send(res, 405, "text/plain", "method not allowed");
  const action = rest.match(/^\/tabs\/(\d+)\/(answer|finish)$/);
  if (!action) return send(res, 404, "text/plain", "not found");
  const id = Number(action[1]);
  const body = (await readJson(req)) ?? {};
  if (action[2] === "answer") {
    const answers = Array.isArray(body.answers) ? body.answers.filter((a: unknown): a is string => typeof a === "string") : [];
    const reply = answerTab(s, id, body.cancel === true ? { cancel: true } : { answers, note: body.note });
    return json(res, reply.status, reply.body);
  }
  const reply = finishTab(s, id, body.cancel === true ? { cancel: true } : { rating: body.rating, feedback: body.feedback });
  return json(res, reply.status, reply.body);
}

function listen(): Promise<Server> {
  server ??= new Promise((ok, fail) => {
    const srv = createServer((req, res) => void route(req, res).catch(() => send(res, 500, "text/plain", "error")));
    srv.once("error", fail);
    srv.listen(0, "127.0.0.1", () => {
      srv.unref();
      ok(srv);
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

const connectWaiters = new Set<() => void>();

function waitForListener(): Promise<boolean> {
  return new Promise((ok) => {
    const timer = setTimeout(() => {
      connectWaiters.delete(done);
      ok(false);
    }, LOAD_TIMEOUT_MS);
    timer.unref();
    const done = () => {
      clearTimeout(timer);
      connectWaiters.delete(done);
      ok(true);
    };
    connectWaiters.add(done);
  });
}

async function ensureConnected(s: Session, port: number): Promise<boolean> {
  if (s.listeners.size > 0) return true;
  // xdg-open starts even without a display or browser, so only an open event stream proves the page is visible.
  return (await launch(`http://127.0.0.1:${port}/s/${s.token}`)) && waitForListener();
}

async function open(input: TabInput): Promise<TabOutcome | undefined> {
  if (!existsSync(KATEX_DIR)) return undefined;
  const { port } = (await listen()).address() as AddressInfo;
  session ??= createSession();
  const s = session;
  if (!(await ensureConnected(s, port))) return undefined;
  return openTab(s, input).done;
}

export function askInBrowser(view: PageView, intro: string | undefined, grade: (s: Submission | undefined) => QuizResult) {
  return open({ kind: "quiz", title: view.question, introHtml: intro ? renderMarkdown(intro) : undefined, view, grade });
}

export function showInBrowser(input: ShowInput) {
  return open({ kind: "show", title: input.title, bodyHtml: renderMarkdown(input.body), image: input.image });
}

export function cancelOpenTabs() {
  if (session) cancelAll(session);
}
