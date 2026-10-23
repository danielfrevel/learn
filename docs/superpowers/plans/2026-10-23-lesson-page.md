# Lektionsseite im Browser: Implementierungsplan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Eine Browserseite pro Session mit In-Page-Tabs für Fragen und Text, Rückmeldeblock pro Tab, Teacher-Skill, der Erklärungen nur noch auf die Seite schickt.

**Architecture:** Der MCP-Server in `src/quiz/` bekommt einen Session-Zustand (`session.ts`) mit Tabs, einen HTTP-Server mit Server-Sent Events (`popup.ts`) und eine Seite (`page.ts`), die Tabs rendert. Prosa wird serverseitig mit `marked` zu HTML, Mathe bleibt als `$...$` stehen und wird im Browser von KaTeX gerendert. Zwei Tools: `quiz` (plus `intro`) und `show`. `mdlog` rendert beide ins Log.

**Tech Stack:** Node 22 (direkter `.ts`-Start, `node:test`), `katex`, `marked`, Vanilla JS in der Seite.

**Spec:** `docs/superpowers/specs/2026-10-23-lesson-page-design.md`

## Global Constraints

- Node ≥ 22.18, kein Build-Schritt, Tests mit `npm test`, Typen mit `npm run typecheck`.
- Browser lädt alles von `127.0.0.1:<port>`. Host-Prüfung bleibt (`403` für fremden Host). Kein CDN.
- Jeder Tool-Aufruf blockiert bis "Weiter", "Abbrechen" oder `notifications/cancelled`.
- Terminal-Fallback: Verbindet sich innerhalb `LEARN_QUIZ_LOAD_TIMEOUT_MS` (Default 10000) kein Client, läuft nur dieser Aufruf im Terminal.
- Abbruch nach Bewertung behält Ausgang und Antwort, Rating und Notiz fehlen. Abbruch vor Antwort ergibt Ausgang `cancelled`.
- Kaputtes LaTeX wird als Quelltext gezeigt (`throwOnError: false`).
- Kommentare nur nach der CLAUDE.md-Regel (externe Einschränkung, Quelle eines Werts, Korrektheitsbedingung, absichtliche Auslassung).
- Git: Commit-Subject einzeilig, keine Trailer. In einer interaktiven Session vor jedem Commit fragen.
- Der vorbestehende rote Test `render-mermaid` (Chromium-Socket im Sandbox) zählt nicht. Erwartung bei "alle Tests grün": nur dieser eine rot.

## Review Focus

- `GET /s/<token>/state` und das SSE-Ereignis dürfen bei einem offenen Frage-Tab weder `correctAnswer`, `correctIndices` noch `explanation` enthalten. Test in Task 4 (`publicTab`).
- `finish` mit Rating außerhalb 1..5, nicht ganzzahlig oder fehlend ohne `cancel` lässt den Tab offen und antwortet `400`. Test in Task 4 und Task 5.
- `finish` auf einem Frage-Tab vor `answer` antwortet `409`, Tab bleibt offen. Test in Task 4.
- Markdown mit rohem HTML (`<script>`) landet escaped auf der Seite. Test in Task 3.
- `image` mit Pfadtrenner oder fremder Endung wird im Tool abgelehnt, die Route liefert `404` für Namen außerhalb von `viz/`. Test in Task 2 und Task 6.
- Offene SSE-Verbindungen halten den Serverprozess nicht am Leben, wenn Claude Code stdin schließt. Test in Task 5.

---

### Task 0: Baseline committen

**Files:**
- Modify: `README.md`, `docs/superpowers/plans/2026-10-14-quiz-browser-popup.md`, `src/quiz/popup.ts`, `test/fixtures/answer-quiz.mjs`, `test/quiz/server.test.ts` (bereits geändert, uncommitted)

- [ ] **Step 1: Tests laufen lassen**

Run: `npm test 2>&1 | grep -E "^ℹ (pass|fail)"`
Expected: `pass 53`, `fail 1` (render-mermaid).

- [ ] **Step 2: Commit**

```bash
git add README.md docs/superpowers/plans/2026-10-14-quiz-browser-popup.md src/quiz/popup.ts test/fixtures/answer-quiz.mjs test/quiz/server.test.ts docs/superpowers/specs/2026-10-23-lesson-page-design.md docs/superpowers/plans/2026-10-23-lesson-page.md
git commit -m "Wait for the quiz page to load before trusting the browser, add lesson page design"
```

---

### Task 1: Rückmeldung im Ergebnis, Ergebnis für `show`

**Files:**
- Modify: `src/quiz/result.ts`
- Test: `test/quiz/result.test.ts`

**Interfaces:**
- Produces:
  - `QuizResult` bekommt `rating?: number; feedback?: string`.
  - `interface ShowResult { kind: "show"; title: string; body: string; image?: string; rating?: number; feedback?: string; cancelled: boolean }`
  - `SHOW_MARKER = "learn-show"`, `encodeShow(r: ShowResult): string`, `decodeShow(text: string): ShowResult | undefined`, `formatShowText(r: ShowResult): string`
  - `formatFeedback(r: { rating?: number; feedback?: string }): string[]` liefert `["Verständnis: 4/5", "Hilft mir: mehr Beispiele"]`, nur die vorhandenen Zeilen.

- [ ] **Step 1: Tests schreiben**

In `test/quiz/result.test.ts`:

```ts
test("formatResultText appends rating and feedback", () => {
  const r: QuizResult = { ...base, outcome: "correct", answers: [options[0]], rating: 4, feedback: "mehr Beispiele" };
  assert.equal(formatResultText(r), "✓ Richtig: 1. A\nErklärung: weil\nVerständnis: 4/5\nHilft mir: mehr Beispiele");
});
test("formatResultText without rating has no feedback lines", () => {
  assert.equal(formatResultText({ ...base, outcome: "correct", answers: [options[0]] }), "✓ Richtig: 1. A\nErklärung: weil");
});
test("show result round-trips and formats", () => {
  const r: ShowResult = { kind: "show", title: "Grenzwert", body: "Sei $\\epsilon > 0$.", rating: 5, cancelled: false };
  assert.equal(formatShowText(r), "Verständnis: 5/5");
  assert.deepEqual(decodeShow("x\n" + encodeShow(r)), r);
  assert.equal(formatShowText({ kind: "show", title: "t", body: "b", cancelled: false }), "Gelesen, keine Rückmeldung.");
  assert.equal(formatShowText({ kind: "show", title: "t", body: "b", cancelled: true }), "Abgebrochen, keine Rückmeldung.");
  assert.equal(decodeShow(encodeResult(base)), undefined);
});
```

- [ ] **Step 2: Tests laufen lassen, Fehlschlag sehen**

Run: `node --test test/quiz/result.test.ts`
Expected: FAIL, `formatShowText is not a function` bzw. Rating-Zeilen fehlen.

- [ ] **Step 3: `result.ts` erweitern**

`formatResultText` hängt `formatFeedback(r)` nach der Notiz-Zeile an. Reihenfolge: Kopf, Erklärung, Notiz, Verständnis, Hilft mir. `decodeShow` prüft `kind === "show"` und `typeof body === "string"`.

- [ ] **Step 4: Tests grün**

Run: `node --test test/quiz/result.test.ts test/mdlog/render.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/quiz/result.ts test/quiz/result.test.ts
git commit -m "Carry rating and feedback in quiz results, add show result"
```

---

### Task 2: `show`-Eingabe validieren

**Files:**
- Create: `src/quiz/show.ts`
- Test: `test/quiz/show.test.ts`

**Interfaces:**
- Produces:
  - `interface ShowInput { title: string; body: string; image?: string }`
  - `validateShow(raw: unknown): { ok: true; show: ShowInput } | { ok: false; error: string }`
  - `IMAGE_NAME = /^[A-Za-z0-9._-]+\.(png|svg)$/`

- [ ] **Step 1: Tests schreiben**

```ts
test("validateShow accepts title, body, image", () => {
  const v = validateShow({ title: "Grenzwert", body: "Text", image: "viz-grenzwert-1.png" });
  assert.deepEqual(v, { ok: true, show: { title: "Grenzwert", body: "Text", image: "viz-grenzwert-1.png" } });
});
test("validateShow rejects missing body, path separators and other extensions", () => {
  assert.equal(validateShow({ title: "t" }).ok, false);
  assert.match((validateShow({ title: "t", body: "b", image: "../x.png" }) as any).error, /image/);
  assert.match((validateShow({ title: "t", body: "b", image: "x.jpg" }) as any).error, /image/);
  assert.equal((validateShow({ title: "", body: "b" }) as any).error, "`title` is required.");
});
```

- [ ] **Step 2: Fehlschlag sehen**

Run: `node --test test/quiz/show.test.ts`
Expected: FAIL, Modul fehlt.

- [ ] **Step 3: `show.ts` schreiben**

`str` aus `grade.ts` wiederverwenden. Fehlermeldungen: `` `title` is required. ``, `` `body` is required. ``, `` `image` must be a file name in viz/ ending in .png or .svg. ``

- [ ] **Step 4: Tests grün**

Run: `node --test test/quiz/show.test.ts`

- [ ] **Step 5: Commit**

```bash
git add src/quiz/show.ts test/quiz/show.test.ts
git commit -m "Validate show tool input"
```

---

### Task 3: Markdown mit geschützter Mathe

**Files:**
- Create: `src/quiz/markdown.ts`
- Modify: `package.json` (dependency `marked`)
- Test: `test/quiz/markdown.test.ts`

**Interfaces:**
- Produces: `renderMarkdown(md: string): string` (HTML).

- [ ] **Step 1: `marked` installieren**

Run: `npm install marked@^18`
Expected: `node_modules/marked` existiert, `package.json` listet `marked` unter `dependencies`.

- [ ] **Step 2: Tests schreiben**

```ts
test("renders markdown to html", () => {
  assert.equal(renderMarkdown("Ein **Satz**.").trim(), "<p>Ein <strong>Satz</strong>.</p>");
});
test("keeps inline and display math untouched", () => {
  const html = renderMarkdown("Sei $a_1 * a_2$ und\n\n$$\\sum_{i=1}^n x_i$$\n\nfertig.");
  assert.ok(html.includes("$a_1 * a_2$"));
  assert.ok(html.includes("$$\\sum_{i=1}^n x_i$$"));
  assert.ok(!html.includes("<em>"));
});
test("escapes html in math and raw html blocks", () => {
  assert.ok(renderMarkdown("$a < b$").includes("$a &lt; b$"));
  const html = renderMarkdown("<script>alert(1)</script>\n\nText");
  assert.ok(!html.includes("<script>"));
  assert.ok(html.includes("&lt;script&gt;"));
});
test("dollar inside code stays code", () => {
  assert.ok(renderMarkdown("`$x$`").includes("<code>$x$</code>"));
});
```

- [ ] **Step 3: Fehlschlag sehen**

Run: `node --test test/quiz/markdown.test.ts`

- [ ] **Step 4: `markdown.ts` schreiben**

Ansatz: Vor dem Parsen `$$...$$` (zuerst) und `$...$` (eine Zeile, kein `$` innen) durch Platzhalter `\u0000MATH<n>\u0000` ersetzen, aber nur außerhalb von Code-Spans und Fenced-Code. Einfacher Weg: ein `marked`-Tokenizer-Extension `math` mit `start: (src) => src.indexOf("$")` und `tokenizer` für beide Formen, Renderer gibt den Originaltext HTML-escaped zurück. Das vermeidet den Platzhalter und respektiert Code-Spans, weil `marked` Code zuerst tokenisiert. Rohes HTML: Renderer-Override `html: ({ text }) => escape(text)`. `escape` selbst schreiben (fünf Zeichen).

- [ ] **Step 5: Tests grün, Typen prüfen**

Run: `node --test test/quiz/markdown.test.ts && npm run typecheck`

- [ ] **Step 6: Commit**

```bash
git add package.json package-lock.json src/quiz/markdown.ts test/quiz/markdown.test.ts
git commit -m "Render lesson markdown with marked, keep math for KaTeX"
```

---

### Task 4: Session-Zustand mit Tabs

**Files:**
- Create: `src/quiz/session.ts`
- Test: `test/quiz/session.test.ts`

**Interfaces:**
- Consumes: `QuizResult` (Task 1), `PageView`, `Submission` aus `popup.ts` (werden in Task 5 nach `session.ts` verschoben; hier definieren).
- Produces:

```ts
export type PageView = Pick<QuizInput, "question" | "details" | "multiSelect"> & { options: DisplayOption[] };
export interface Submission { answers: string[]; note?: unknown }
export type TabStatus = "open" | "answered" | "done" | "cancelled";
export interface Feedback { rating?: number; feedback?: string }
export type TabInput =
  | { kind: "quiz"; title: string; introHtml?: string; view: PageView; grade: (s: Submission | undefined) => QuizResult }
  | { kind: "show"; title: string; bodyHtml: string; image?: string };
export interface PublicTab {
  id: number; kind: "quiz" | "show"; title: string; status: TabStatus;
  introHtml?: string; view?: PageView; bodyHtml?: string; image?: string;
  result?: { outcome: Outcome; correct: string[]; text: string };
  rating?: number; feedback?: string;
}
export interface TabOutcome { result?: QuizResult; rating?: number; feedback?: string; cancelled: boolean }
export type SessionEvent = { type: "tab" | "update"; tab: PublicTab };
export interface Session { token: string; listeners: Set<(e: SessionEvent) => void> }
export function createSession(): Session
export function openTab(s: Session, input: TabInput): { id: number; done: Promise<TabOutcome> }
export function snapshot(s: Session): PublicTab[]
export function answerTab(s: Session, id: number, sub: Submission | { cancel: true }): { status: number; body: unknown }
export function finishTab(s: Session, id: number, fb: Feedback | { cancel: true }): { status: number; body: unknown }
export function cancelAll(s: Session): void
```

Regeln:
- `answerTab` nur auf `kind: "quiz"` mit Status `open`, sonst `409`. Erfolg: Status `answered`, `result` gesetzt, Rückgabe `200` mit `{ outcome, correct, text }` wie heute. `{ cancel: true }`: Status `cancelled`, `done` wird mit `{ result: grade(undefined), cancelled: true }` erfüllt.
- `finishTab` auf Status `open` bei `show`, `answered` bei `quiz`, sonst `409`. Rating muss ganze Zahl 1..5 sein, sonst `400` `{ error: "rating must be an integer from 1 to 5" }`. Erfolg: Status `done`, `done` erfüllt mit `{ result?, rating, feedback, cancelled: false }`. `{ cancel: true }`: Status `cancelled`, `done` erfüllt mit `{ result?, cancelled: true }` (Ergebnis bleibt, wenn schon bewertet).
- `cancelAll` bricht jeden Tab in `open` oder `answered` ab wie ein `cancel` auf `finish` bzw. `answer`.
- Jede Statusänderung ruft alle Listener mit `{ type: "update", tab }`, `openTab` mit `{ type: "tab", tab }`.
- `snapshot` und Ereignisse enthalten nie `grade`, `correctAnswer`, `correctIndices` oder `explanation`. Der Erklärungstext erreicht die Seite nur über `result.text` nach der Antwort.
- Unbekannte `id`: `404`.

- [ ] **Step 1: Tests schreiben**

```ts
const view: PageView = { question: "q", multiSelect: false, options: displayOrder({ question: "q", options: [{ label: "A", value: "a" }, { label: "B", value: "b" }], shuffle: false }) };
const grade = (s: Submission | undefined): QuizResult => ({ outcome: s ? (s.answers[0] === "a" ? "correct" : "wrong") : "cancelled", question: "q", mode: "single-select", options: [], answers: [], correctIndices: [1], explanation: "geheim" });

test("quiz tab: answer then finish resolves with result and rating", async () => {
  const s = createSession();
  const events: SessionEvent[] = [];
  s.listeners.add((e) => events.push(e));
  const { id, done } = openTab(s, { kind: "quiz", title: "q", view, grade });
  assert.equal(snapshot(s)[0].status, "open");
  assert.ok(!JSON.stringify(snapshot(s)).includes("geheim"));
  assert.ok(!JSON.stringify(events).includes("geheim"));
  assert.equal(finishTab(s, id, { rating: 3 }).status, 409);
  const a = answerTab(s, id, { answers: ["a"] });
  assert.equal(a.status, 200);
  assert.equal((a.body as any).outcome, "correct");
  assert.equal(finishTab(s, id, { rating: 7 }).status, 400);
  assert.equal(finishTab(s, id, { rating: 4, feedback: "mehr" }).status, 200);
  assert.deepEqual(await done, { result: { ...grade({ answers: ["a"] }) }, rating: 4, feedback: "mehr", cancelled: false });
  assert.deepEqual(events.map((e) => [e.type, e.tab.status]), [["tab", "open"], ["update", "answered"], ["update", "done"]]);
});
test("show tab: finish resolves with rating only", async () => {
  const s = createSession();
  const { id, done } = openTab(s, { kind: "show", title: "t", bodyHtml: "<p>x</p>" });
  assert.equal(answerTab(s, id, { answers: [] }).status, 409);
  finishTab(s, id, { rating: 5 });
  const out = await done;
  assert.equal(out.rating, 5);
  assert.equal(out.result, undefined);
  assert.equal(out.cancelled, false);
});
test("cancel after answer keeps the result, cancel before answer yields cancelled outcome", async () => {
  const s = createSession();
  const a = openTab(s, { kind: "quiz", title: "q", view, grade });
  answerTab(s, a.id, { answers: ["b"] });
  finishTab(s, a.id, { cancel: true });
  assert.equal((await a.done).result?.outcome, "wrong");
  assert.equal((await a.done).cancelled, true);
  const b = openTab(s, { kind: "quiz", title: "q", view, grade });
  answerTab(s, b.id, { cancel: true });
  assert.equal((await b.done).result?.outcome, "cancelled");
});
test("cancelAll ends every open tab, second finish is 409, unknown id is 404", async () => {
  const s = createSession();
  const a = openTab(s, { kind: "show", title: "t", bodyHtml: "" });
  cancelAll(s);
  assert.equal((await a.done).cancelled, true);
  assert.equal(finishTab(s, a.id, { rating: 1 }).status, 409);
  assert.equal(finishTab(s, 99, { rating: 1 }).status, 404);
});
```

- [ ] **Step 2: Fehlschlag sehen**

Run: `node --test test/quiz/session.test.ts`

- [ ] **Step 3: `session.ts` schreiben**

Interner Tab-Typ hält `grade`, `result: QuizResult` und `resolve`. `publicTab(tab)` baut `PublicTab` ohne diese Felder und mit `result` als `{ outcome, correct: values der correctIndices, text: formatResultText(result) }`. `correct` aus `result.options.filter(o => result.correctIndices.includes(o.index)).map(o => o.value)` wie heute in `popup.ts`.

- [ ] **Step 4: Tests grün**

Run: `node --test test/quiz/session.test.ts && npm run typecheck`

- [ ] **Step 5: Commit**

```bash
git add src/quiz/session.ts test/quiz/session.test.ts
git commit -m "Add session tab state for the lesson page"
```

---

### Task 5: HTTP-Server, Seite und Quiz-Tab im Browser

**Files:**
- Create: `src/quiz/page.ts`
- Modify: `src/quiz/popup.ts` (Routen, Session-URL, SSE, Verbindungs-Erkennung, Opener)
- Modify: `src/quiz/server.ts` (`intro` im Schema, Aufruf von `askInBrowser` mit Intro)
- Modify: `test/fixtures/answer-quiz.mjs` → ersetzen durch `test/fixtures/lesson-browser.mjs`
- Test: `test/quiz/server.test.ts`

**Interfaces:**
- Consumes: Task 4 (`createSession`, `openTab`, `snapshot`, `answerTab`, `finishTab`, `cancelAll`, `PageView`, `Submission`, `TabOutcome`), Task 3 (`renderMarkdown`).
- Produces:
  - `askInBrowser(view: PageView, intro: string | undefined, grade: (s: Submission | undefined) => QuizResult): Promise<TabOutcome | undefined>` (`undefined` = Fallback)
  - `showInBrowser(input: ShowInput): Promise<TabOutcome | undefined>` (Task 6 nutzt es; hier schon exportieren)
  - `cancelOpenTabs(): void` (ersetzt `cancelOpenQuizzes`)
  - `page(token: string): string` in `page.ts`
  - Routen:
    - `GET /s/<token>` → Seite (`200`), falsches Token `404`
    - `GET /s/<token>/state` → `{ tabs: PublicTab[] }`
    - `GET /s/<token>/events` → `text/event-stream`, erst `event: state` mit `{ tabs }`, dann `event: tab` / `event: update` mit `PublicTab`
    - `POST /s/<token>/tabs/<id>/answer`, `POST /s/<token>/tabs/<id>/finish` → Status und Body aus `session.ts`
    - `GET /s/<token>/viz/<name>` → Datei aus `VIZ_DIR` (Task 6)
    - `GET /katex/*` wie heute, zusätzlich `GET /marked.js` wird nicht gebraucht (Markdown rendert serverseitig)
  - Verbindungs-Erkennung: `connected = session.listeners.size > 0`. Vor dem Öffnen eines Tabs: wenn nicht verbunden, Opener mit `http://127.0.0.1:<port>/s/<token>` starten und bis `LOAD_TIMEOUT_MS` auf den ersten Listener oder auf `done` warten. Kommt nichts, Tab per `cancelAll` räumen und `undefined` liefern.
  - Token: einmal pro Prozess, `randomBytes(16).toString("hex")`.
  - SSE-Sockets: `req.socket.unref()`; `server.ts` beendet den Prozess bei `close` von stdin mit `process.exit(0)`.

Seite (`page.ts`), fixe Punkte:
- Kopfleiste: Button `‹` (`#prev`), Text `#pos` mit `"3 / 7"`, Titel `#title` (bei Frage-Tab der Fragetext, per CSS auf eine Zeile gekürzt), Button `›` (`#next`). Tastatur `ArrowLeft`/`ArrowRight`, wenn `document.activeElement` kein `input`, `textarea` oder `button` ist.
- Jeder Tab ist ein `<section data-id>`; nur der aktive ist sichtbar. Neuer Tab wird aktiv, `window.scrollTo(0, 0)`.
- Frage-Tab: `.intro` (innerHTML = `introHtml`), dann Frage, Details, Optionen, Notiz, "Antworten" / "Abbrechen" wie heute. Nach `answer`: Optionen markiert, `#result` mit `text`, dann `.feedback`.
- Text-Tab: `.body` (innerHTML = `bodyHtml`), `<img src="/s/<token>/viz/<name>">` wenn `image`, dann `.feedback`.
- `.feedback`: Überschrift "Wie gut verstehst du das?", fünf Radio-Buttons 1..5 als Buttons gestylt, Textarea mit Placeholder "Was würde dir helfen? (optional)", Button "Weiter" (disabled bis ein Rating gewählt ist), Button "Abbrechen".
- Status `done`: Feedback-Block eingefroren, zeigt gewähltes Rating und Notiz. Status `cancelled`: Zeile "Abgebrochen." und alles disabled.
- `EventSource` auf `/s/<token>/events`. Bei `state` die Tabliste ersetzen, bei `tab` anhängen und aktivieren, bei `update` den Tab mit gleicher `id` neu rendern. `onopen` ruft `/state` ab, damit ein Reconnect den Stand holt.
- KaTeX `renderMathInElement` nach jedem Rendern eines Tabs auf dessen `section`.
- Daten gelangen nur per `textContent` ins DOM, außer `introHtml` und `bodyHtml` (serverseitig gerendert und escaped).

Fixture `test/fixtures/lesson-browser.mjs`:
- Argument: Session-URL. Env `QUIZ_REPORT` (Pfad), `QUIZ_SCRIPT` (JSON-Array, ein Eintrag pro erwartetem Tab, in Reihenfolge): `{ answer?: object, finish?: object }`. Fehlt `finish`, bleibt der Tab offen (für den `notifications/cancelled`-Test). `QUIZ_STAY=1`: nach dem Report nicht beenden, Stream offen halten.
- Beim Start eine Zeile `1\n` an `QUIZ_REPORT + ".opened"` anhängen. Der Test-Helfer `opened()` zählt die Zeilen dieser Datei.
- Ablauf: Seite laden (`page: html.includes("<title>Lektion</title>")`), KaTeX-Status, fremder Host, dann `/events` per `fetch` als Stream lesen. Pro `tab`-Ereignis den nächsten Script-Eintrag abarbeiten: `answer` posten, Antwort merken, `finish` posten, Status merken. Beim ersten Tab `state` abrufen und `stateHasSecret: JSON.stringify(state).includes("Ein Halbes.")` melden. Nach dem letzten Eintrag Report schreiben: `{ page, katex, foreignHost, stateHasSecret, tabs: [...] }`, wobei `tabs[i]` der `PublicTab` aus dem Ereignis ist plus `answered` (Antwort-Body) und `finished` (HTTP-Status). Report wie heute atomar über `.tmp` + `rename`, vorhandene Datei überschreiben. Danach Prozess beenden, außer `QUIZ_STAY` ist gesetzt.

- [ ] **Step 1: Browser-Tests umschreiben**

In `test/quiz/server.test.ts` die Helfer `browserServer` und die vier Browser-Tests ersetzen:

```ts
const OPENER = fileURLToPath(new URL("../fixtures/lesson-browser.mjs", import.meta.url));
function browserServer(t: TestContext, script: unknown[], env: Record<string, string> = {}) {
  const report = join(mkdtempSync(join(tmpdir(), "quiz-")), "report.json");
  const s = startServer(() => assert.fail("terminal form must not open"), { LEARN_QUIZ_OPENER: OPENER, QUIZ_SCRIPT: JSON.stringify(script), QUIZ_REPORT: report, ...env });
  t.after(s.stop);
  return { ...s, report: () => waitForFile(report) };
}

test("browser: two quiz tabs on one page, intro rendered, rating in the result", async (t) => {
  const s = browserServer(t, [
    { answer: { answers: ["half"], note: "sicher" }, finish: { rating: 4, feedback: "mehr Beispiele" } },
    { answer: { answers: ["two"] }, finish: { rating: 2 } },
  ]);
  const first = resultText(await s.call("tools/call", { name: "quiz", arguments: { ...quizArgs, intro: "Sei $a_1$ **fett**." } }));
  assert.match(first, /^✓ Richtig: 1\. 0\.5\nErklärung: Ein Halbes\.\nNotiz: sicher\nVerständnis: 4\/5\nHilft mir: mehr Beispiele/);
  const second = resultText(await s.call("tools/call", { name: "quiz", arguments: quizArgs }));
  assert.match(second, /^✗ Falsch: 2\. 2\nRichtig wäre: 1\. 0\.5\nErklärung: Ein Halbes\.\nVerständnis: 2\/5$/m);
  const report = await s.report();
  assert.equal(report.page, true);
  assert.deepEqual(report.katex, [200, 200, 200]);
  assert.equal(report.foreignHost, 403);
  assert.equal(report.stateHasSecret, false);
  assert.equal(report.tabs.length, 2);
  assert.equal(report.tabs[0].introHtml, "<p>Sei $a_1$ <strong>fett</strong>.</p>\n");
  assert.equal(report.tabs[0].answered.outcome, "correct");
  assert.equal(report.tabs[0].finished, 200);
  assert.equal(report.tabs[1].id, 2);
  assert.equal(s.opened(), 1);
});

test("browser: cancel after answering keeps the grade, cancel before answering does not", async (t) => {
  const s = browserServer(t, [
    { answer: { answers: ["half"] }, finish: { cancel: true } },
    { answer: { cancel: true } },
  ]);
  const a = decodeResult(resultText(await s.call("tools/call", { name: "quiz", arguments: quizArgs })))!;
  assert.equal(a.outcome, "correct");
  assert.equal(a.rating, undefined);
  const b = decodeResult(resultText(await s.call("tools/call", { name: "quiz", arguments: quizArgs })))!;
  assert.equal(b.outcome, "cancelled");
});

test("browser: invalid rating is rejected and the tab stays open", async (t) => {
  const s = browserServer(t, [{ answer: { answers: ["half"] }, finish: { rating: 0 } }]);
  const pending = s.call("tools/call", { name: "quiz", arguments: quizArgs });
  const report = await s.report();
  assert.equal(report.tabs[0].finished, 400);
  s.notify("notifications/cancelled", { requestId: 1 });
  assert.equal(decodeResult(resultText(await pending))!.outcome, "correct");
});

test("notifications/cancelled ends an open browser tab", async (t) => {
  const s = browserServer(t, [{}]);
  const pending = s.call("tools/call", { name: "quiz", arguments: quizArgs });
  await s.report();
  s.notify("notifications/cancelled", { requestId: 1 });
  assert.equal(decodeResult(resultText(await pending))!.outcome, "cancelled");
});

test("falls back to the terminal form when no browser connects", async (t) => { /* wie heute, Opener "true", Timeout 200 */ });

test("server exits when stdin closes even with an open event stream", async (t) => {
  const s = browserServer(t, [{}], { QUIZ_STAY: "1" });
  const pending = s.call("tools/call", { name: "quiz", arguments: quizArgs });
  await s.report();
  const exited = s.end();
  assert.equal(await exited, 0);
  void pending;
});
```

`startServer` bekommt `end: () => Promise<number | null>`, das `child.stdin.end()` ruft und auf `exit` wartet (Timeout 2 s, dann `assert.fail`). `browserServer` liefert zusätzlich `opened: () => number` (Zeilen in `report + ".opened"`, 0 wenn die Datei fehlt).

- [ ] **Step 2: Fehlschlag sehen**

Run: `node --test test/quiz/server.test.ts`
Expected: Browser-Tests FAIL (Fixture fehlt, Routen fehlen).

- [ ] **Step 3: `page.ts` schreiben**

HTML-Shell mit `<title>Lektion</title>`, CSS wie heute plus Kopfleiste, `.feedback`, `.rating` (fünf Labels nebeneinander). Das Script implementiert die Punkte oben. Keine Daten im HTML außer dem Token.

- [ ] **Step 4: `popup.ts` umbauen**

Session beim ersten Aufruf anlegen (`createSession`). `ensureConnected(): Promise<boolean>` kapselt Opener und Warten. `askInBrowser` und `showInBrowser` rufen `renderMarkdown` für `intro` bzw. `body`, dann `openTab`. Routen wie oben. Bestehende `serveKatex`, `send`, `readJson`, `launch`, Host-Prüfung bleiben. Die alten Typen `PageView`, `Submission` aus `session.ts` re-exportieren oder Importe umstellen.

- [ ] **Step 5: `server.ts` anpassen**

`intro` im `quiz`-Schema: `{ type: "string", description: "Markdown with LaTeX shown above the question: resolution of the previous question, derivation, transition. All teaching prose goes here or into show." }`. `validateInput` in `grade.ts` liest `intro: str(r.intro)` in `QuizInput`. `runQuiz`: `askInBrowser(view, quiz.intro, finish)`; das Ergebnis ist `{ ...outcome.result, rating, feedback }`. Fallback-Terminalpfad: `intro` als ersten Absatz der Elicitation-Message (per `plainMath`). `notifications/cancelled` ruft `cancelOpenTabs()`. stdin `close` → `process.exit(0)`.

- [ ] **Step 6: Fixture schreiben**

`test/fixtures/lesson-browser.mjs` nach der Beschreibung oben. `answer-quiz.mjs` löschen.

- [ ] **Step 7: Tests grün**

Run: `npm test 2>&1 | grep -E "^ℹ (pass|fail)|^not ok"; npm run typecheck`
Expected: nur `render-mermaid` rot.

- [ ] **Step 8: Commit**

```bash
git add src/quiz/page.ts src/quiz/popup.ts src/quiz/server.ts src/quiz/grade.ts test/fixtures/lesson-browser.mjs test/quiz/server.test.ts
git rm test/fixtures/answer-quiz.mjs
git commit -m "Show quizzes as tabs on one lesson page with intro and feedback"
```

---

### Task 6: `show`-Tool, Bilder, Fallback und Wiederöffnen

**Files:**
- Modify: `src/quiz/server.ts` (Tool `show`), `src/quiz/popup.ts` (`/viz/` Route, Wiederöffnen)
- Test: `test/quiz/server.test.ts`

**Interfaces:**
- Consumes: Task 2 (`validateShow`), Task 1 (`encodeShow`, `formatShowText`), Task 5 (`showInBrowser`).
- Produces: Tool `show` mit Schema `{ title: string, body: string, image?: string }`, required `title`, `body`. Description: "Show a text tab on the lesson page: explanation, derivation, summary or plan. Markdown with LaTeX ($...$, $$...$$). Optional `image`: file name of a PNG in viz/ returned by a maker agent. The learner rates their understanding 1-5 and may write what would help; decide the next step from that, the note and how deep you already are in the topic."
- `VIZ_DIR = process.env.LEARN_VIZ_DIR || join(process.cwd(), "viz")`.
- Fallback-Text für `show`: `Kein Browser verbunden. Zeig diesen Text im Terminal:\n\n<body>` plus Marker mit `cancelled: false` und ohne Rating.

- [ ] **Step 1: Tests schreiben**

```ts
const showArgs = { title: "Grenzwert", body: "Sei $\\epsilon > 0$.\n\n**Idee:** klein.", image: "bild.png" };

test("tools/list exposes show, invalid image is rejected", async (t) => {
  const s = startServer(() => ({ action: "cancel" }));
  t.after(s.stop);
  const list = await s.call("tools/list");
  assert.deepEqual(list.result.tools.map((x: any) => x.name), ["quiz", "show"]);
  const res = await s.call("tools/call", { name: "show", arguments: { ...showArgs, image: "../bild.png" } });
  assert.equal(res.result.isError, true);
});

test("browser: show tab with image, rating comes back, viz route serves only files in viz/", async (t) => {
  const viz = mkdtempSync(join(tmpdir(), "viz-"));
  writeFileSync(join(viz, "bild.png"), Buffer.from([0x89, 0x50, 0x4e, 0x47]));
  const s = browserServer(t, [{ finish: { rating: 3, feedback: "ein Bild mehr" } }], { LEARN_VIZ_DIR: viz, QUIZ_VIZ: "bild.png" });
  const text = resultText(await s.call("tools/call", { name: "show", arguments: showArgs }));
  assert.equal(text.split("\n<!--")[0], "Verständnis: 3/5\nHilft mir: ein Bild mehr");
  assert.equal(decodeShow(text)!.title, "Grenzwert");
  const report = await s.report();
  assert.equal(report.tabs[0].kind, "show");
  assert.equal(report.tabs[0].bodyHtml, "<p>Sei $\\epsilon &gt; 0$.</p>\n<p><strong>Idee:</strong> klein.</p>\n");
  assert.deepEqual(report.viz, [200, 404]);
});

test("show falls back to the terminal when no browser connects", async (t) => {
  const s = startServer(() => assert.fail("show must not elicit"), { LEARN_QUIZ_OPENER: "true", LEARN_QUIZ_LOAD_TIMEOUT_MS: "200" });
  t.after(s.stop);
  const text = resultText(await s.call("tools/call", { name: "show", arguments: showArgs }));
  assert.match(text, /^Kein Browser verbunden\. Zeig diesen Text im Terminal:\n\nSei/);
  assert.equal(decodeShow(text)!.rating, undefined);
});

test("reopens the page when the browser disconnected between tabs", async (t) => {
  const s = browserServer(t, [{ finish: { rating: 5 } }]);
  assert.match(resultText(await s.call("tools/call", { name: "show", arguments: showArgs })), /^Verständnis: 5\/5/);
  assert.match(resultText(await s.call("tools/call", { name: "show", arguments: showArgs })), /^Verständnis: 5\/5/);
  assert.equal(s.opened(), 2);
});
```

Der letzte Test funktioniert, weil die Fixture nach ihrem Script beendet und damit den Stream schließt. Der zweite Aufruf findet keinen Listener und startet den Opener erneut, der das gleiche Script noch einmal abarbeitet.

Fixture-Erweiterung: `QUIZ_VIZ` gesetzt → `viz: [status("/s/<token>/viz/" + QUIZ_VIZ), status("/s/<token>/viz/../package.json")]` (der zweite Pfad normalisiert auf `/s/<token>/package.json` und ist `404`, zusätzlich prüft die Route den Namen gegen `IMAGE_NAME`).

- [ ] **Step 2: Fehlschlag sehen**

Run: `node --test test/quiz/server.test.ts`

- [ ] **Step 3: `show` implementieren**

`runShow(args)` in `server.ts`: validieren, `showInBrowser`, Ergebnis `ShowResult` bauen, `[{ text: formatShowText(r) }, { text: encodeShow(r) }]`; Fallback-Text wie oben. `tools/call` dispatcht auf `quiz` oder `show`. Route `/viz/<name>` in `popup.ts`: Name gegen `IMAGE_NAME`, Datei aus `VIZ_DIR`, Typ `image/png` oder `image/svg+xml`, sonst `404`.

- [ ] **Step 4: Tests grün**

Run: `npm test 2>&1 | grep -E "^ℹ (pass|fail)|^not ok"; npm run typecheck`

- [ ] **Step 5: Commit**

```bash
git add src/quiz/server.ts src/quiz/popup.ts test/fixtures/lesson-browser.mjs test/quiz/server.test.ts
git commit -m "Add show tool for text tabs with images and reopen the page after a disconnect"
```

---

### Task 7: Log rendert Intro, Text-Tabs und Rückmeldung

**Files:**
- Modify: `src/mdlog/render.ts`, `hooks/hooks.json`
- Test: `test/mdlog/render.test.ts`

**Interfaces:**
- Consumes: Task 1 (`decodeShow`, `formatShowText`, `formatFeedback`), Task 2 (`validateShow`).
- Produces: `SHOW_TOOL = /^mcp__.*quiz__show$/`. `questionBlock(name, input)` liefert für `quiz` mit `intro` den Intro-Text als eigenen Absatz vor dem Callout (`intro + "\n\n" + callout`), für `show` `body` plus bei `image` `\n\n![[<image>|500]]`. `resultBlock` für `show`: Callout `info` mit Titel `Rückmeldung` und den Zeilen aus `formatShowText`, nur wenn Rating oder Feedback vorhanden, sonst kein Block.

- [ ] **Step 1: Tests schreiben**

```ts
test("quiz intro renders as prose before the question callout", () => {
  const b = questionBlock("mcp__plugin_learn_quiz__quiz", { question: "q", options: [{ label: "A" }, { label: "B" }], correctAnswer: "A", explanation: "e", shuffle: false, intro: "Sei $x$." });
  assert.ok(b!.startsWith("Sei $x$.\n\n> [!question] Quiz"));
});
test("show renders body and image embed", () => {
  assert.equal(questionBlock("mcp__plugin_learn_quiz__show", { title: "t", body: "Text", image: "viz-a.png" }), "Text\n\n![[viz-a.png|500]]");
});
test("show result renders a feedback callout only when rated", () => {
  const rated = encodeShow({ kind: "show", title: "t", body: "b", rating: 4, feedback: "mehr", cancelled: false });
  const blocks = renderEvents([{ kind: "tool_result", toolUseId: "x", text: rated, toolUseResult: undefined }], new Set());
  assert.deepEqual(blocks, ["> [!info] Rückmeldung\n> Verständnis: 4/5\n> Hilft mir: mehr"]);
  const unrated = encodeShow({ kind: "show", title: "t", body: "b", cancelled: false });
  assert.deepEqual(renderEvents([{ kind: "tool_result", toolUseId: "x", text: unrated, toolUseResult: undefined }], new Set()), []);
});
test("quiz result carries rating lines", () => {
  const text = encodeResult({ outcome: "correct", question: "q", mode: "single-select", options, answers: [options[0]], correctIndices: [1], explanation: "e", rating: 5 });
  const [b] = renderEvents([{ kind: "tool_result", toolUseId: "x", text, toolUseResult: undefined }], new Set());
  assert.ok(b.endsWith("> Verständnis: 5/5"));
});
```

- [ ] **Step 2: Fehlschlag sehen**

Run: `node --test test/mdlog/render.test.ts`

- [ ] **Step 3: `render.ts` und `hooks.json` anpassen**

Matcher in allen drei Hook-Einträgen: `mcp__plugin_learn_quiz__quiz|mcp__plugin_learn_quiz__show|AskUserQuestion`.

- [ ] **Step 4: Tests grün**

Run: `npm test 2>&1 | grep -E "^ℹ (pass|fail)|^not ok"; claude plugin validate .`

- [ ] **Step 5: Commit**

```bash
git add src/mdlog/render.ts hooks/hooks.json test/mdlog/render.test.ts
git commit -m "Log quiz intros, show tabs and understanding ratings"
```

---

### Task 8: Skill, Output-Style, Visualize-Skill, README

**Files:**
- Modify: `skills/teach/SKILL.md`, `output-styles/learn.md`, `skills/visualize/SKILL.md`, `README.md`

Keine Tests. Prüfung: `claude plugin validate .` und ein Lesedurchgang gegen die Spec-Abschnitte "Skill und Output-Style" und "Log".

- [ ] **Step 1: `skills/teach/SKILL.md`**

Änderungen, Stelle für Stelle:
- Abschnitt "Formatting": Ersetzen durch "Where the learner reads": Jede Erklärung, Herleitung, Definition, Zusammenfassung und der Plan aus Phase 2 gehen durch `show` oder das `intro` eines `quiz`. Die Terminal-Antwort ist ein Einzeiler wie "Weiter im Browser." LaTeX-Regeln bleiben (die Seite rendert KaTeX, der Log Obsidian).
- Neuer Abschnitt nach Phase 3 "After every tab": Jeder Tab endet mit Rating 1 bis 5 und optionaler Notiz. Entscheide den nächsten Tab aus Rating, Notiz und erreichter Tiefe im Thema. Die Notiz hat Vorrang. Eine richtige Antwort allein ist kein Grund weiterzugehen. Bring zu jedem Knoten mehrere Beispiele mit anderer Oberfläche (andere Zahlen, andere Formulierung, Umkehrung). Bei Unsicherheit `AskUserQuestion` mit den Optionen "Noch eine Aufgabe", "Visualisierung", "Mehr Text", "Nächster Knoten".
- Phase 1a: Satz ergänzen, dass die Notiz auch beim Abtasten zählt und einen Sprung verhindern oder umlenken kann. Der Binary-Search-Mechanismus bleibt.
- Phase 2: "present the plan in chat" wird "present the plan in a `show` tab"; der DAG kommt als PNG vom `mermaid-maker` über `image`, kein Mermaid-Codeblock. Freigabe weiterhin per `AskUserQuestion`.
- Phase 3, Schritt 4 "Quiz-check": Hinweis, dass das `intro` des Quiz die Auflösung der vorigen Frage trägt, wenn sie falsch war.

- [ ] **Step 2: `output-styles/learn.md`**

Satz "working with one learner in a terminal session whose log renders in Obsidian" wird "working with one learner who reads everything on the lesson page in the browser; the terminal is for steering only". Ergänzen: "Every explanation goes through `show` or a quiz `intro`. Your terminal reply is one line."

- [ ] **Step 3: `skills/visualize/SKILL.md`**

Abschnitt "Embed it in the lesson" ersetzen: Dateinamen aus `RESULT` an `show` als `image` übergeben, Text zum Bild in `body`. Der Log bekommt das Embed vom Renderer. Beschreibung im Frontmatter: "renders on the lesson page and in the Obsidian log".

- [ ] **Step 4: `README.md`**

Abschnitt "Use": Die Lektionsseite öffnet sich beim ersten Tab, alle Erklärungen und Fragen erscheinen dort als Tabs, jeder Tab endet mit einer Rückmeldung. `/learn:md-log` ist ein manueller Schritt pro Session, wenn man zusätzlich eine Obsidian-Mitschrift will. "What is in it": `src/quiz` beschreibt beide Tools. Open todos: Eintrag zum manuellen md-log als bekannte Lücke.

- [ ] **Step 5: Validieren**

Run: `claude plugin validate . && npm test 2>&1 | grep -E "^ℹ (pass|fail)"`

- [ ] **Step 6: Commit**

```bash
git add skills/teach/SKILL.md output-styles/learn.md skills/visualize/SKILL.md README.md
git commit -m "Route all teaching through the lesson page and decide next steps from ratings"
```

---

### Task 9: Rauchtest im echten Browser

**Files:** keine Änderung.

- [ ] **Step 1: Server manuell starten und zwei Tabs schicken**

```bash
cd /home/dan/code/learn && node -e '
const { spawn } = require("node:child_process");
const c = spawn(process.execPath, ["src/quiz/server.ts"], { stdio: ["pipe", "inherit", "inherit"] });
const send = (m) => c.stdin.write(JSON.stringify(m) + "\n");
send({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "smoke", version: "0" } } });
send({ jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: "show", arguments: { title: "Start", body: "Sei $\\epsilon > 0$.\n\n$$\\lim_{n\\to\\infty} \\frac{1}{n} = 0$$" } } });
setTimeout(() => send({ jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: "quiz", arguments: { intro: "Jetzt die **Frage**.", question: "Was ist $\\frac{1}{2}$?", options: [{ label: "0.5" }, { label: "2" }], correctAnswer: "0.5", explanation: "Ein Halbes." } } }), 15000);
'
```

Erwartung: Browser öffnet die Seite, Tab 1 zeigt den Text mit gerenderter Mathe und den Rückmeldeblock. Nach 15 s erscheint Tab 2 und wird aktiv, Pfeile wechseln, Tastatur-Pfeile wechseln. Antworten, Rating, Weiter: stdout zeigt die Tool-Ergebnisse mit `Verständnis`. Browser-Tab schließen, erneut starten: Seite öffnet wieder.

- [ ] **Step 2: Befund notieren**

Abweichungen in diesem Plan unter einer Überschrift "Befund Rauchtest" eintragen und beheben, bevor die Arbeit als fertig gilt.
