export function page(token: string): string {
  return `<!doctype html>
<html lang="de">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Lektion</title>
<link rel="stylesheet" href="/katex/katex.min.css">
<script defer src="/katex/katex.min.js"></script>
<script defer src="/katex/contrib/auto-render.min.js"></script>
<style>
  :root { color-scheme: light dark; --ok: #2e9d5b; --bad: #d1495b; --line: color-mix(in srgb, currentColor 20%, transparent); }
  body { font: 18px/1.5 system-ui, sans-serif; max-width: 46rem; margin: 0 auto 4rem; padding: 0 1.25rem; }
  header { position: sticky; top: 0; display: flex; align-items: center; gap: .75rem; padding: .75rem 0; background: Canvas; border-bottom: 1px solid var(--line); }
  header .title { flex: 1; min-width: 0; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; font-weight: 600; }
  header .pos { opacity: .6; font-variant-numeric: tabular-nums; }
  header button { padding: .25rem .7rem; }
  header button:disabled { opacity: .3; }
  section[hidden] { display: none; }
  .intro, .body { margin: 1.5rem 0; }
  .intro { padding-bottom: 1rem; border-bottom: 1px solid var(--line); }
  .body img { max-width: 100%; display: block; margin: 1rem auto; }
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
  button { font: inherit; padding: .5rem 1.1rem; border-radius: .4rem; border: 1px solid var(--line); background: Canvas; color: inherit; cursor: pointer; }
  button:disabled { cursor: default; }
  button.primary { font-weight: 600; }
  .result { margin-top: 1.5rem; padding: 1rem; border-radius: .5rem; border: 1px solid var(--line); }
  .result p { white-space: pre-line; margin: 0; }
  .feedback { margin-top: 2rem; padding-top: 1rem; border-top: 1px solid var(--line); }
  .rating { display: flex; gap: .5rem; margin: .5rem 0 1rem; }
  .rating label { flex: 1; text-align: center; padding: .5rem 0; border: 1px solid var(--line); border-radius: .4rem; cursor: pointer; }
  .rating label:has(input:checked) { border-color: currentColor; font-weight: 600; }
  .rating input { position: absolute; opacity: 0; width: 0; height: 0; }
  .status { opacity: .6; font-size: .9em; margin-top: 1rem; }
</style>
</head>
<body>
<header>
  <button id="prev" type="button" aria-label="Vorheriger Tab">‹</button>
  <span class="pos" id="pos"></span>
  <span class="title" id="title"></span>
  <button id="next" type="button" aria-label="Nächster Tab">›</button>
</header>
<main id="tabs"></main>
<script>
const token = ${JSON.stringify(token)};
const base = "/s/" + token;
const tabs = new Map();
let active = 0;
const math = (el) => window.renderMathInElement?.(el, { delimiters: [
  { left: "$$", right: "$$", display: true }, { left: "$", right: "$", display: false },
], throwOnError: false });
const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text !== undefined) e.textContent = text; return e; };
const post = (path, body) => fetch(base + path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) })
  .then((r) => r.json().then((j) => ({ status: r.status, ...j })), () => ({ status: 0, gone: true }));

function activate(id) {
  if (!tabs.has(id)) return;
  const changed = id !== active;
  active = id;
  const ids = [...tabs.keys()];
  for (const [tid, t] of tabs) t.section.hidden = tid !== id;
  const tab = tabs.get(id).data;
  document.getElementById("pos").textContent = (ids.indexOf(id) + 1) + " / " + ids.length;
  const title = document.getElementById("title");
  title.textContent = tab.title;
  math(title);
  document.getElementById("prev").disabled = ids.indexOf(id) === 0;
  document.getElementById("next").disabled = ids.indexOf(id) === ids.length - 1;
  if (changed) window.scrollTo(0, 0);
}
const step = (d) => { const ids = [...tabs.keys()]; activate(ids[ids.indexOf(active) + d]); };
document.getElementById("prev").addEventListener("click", () => step(-1));
document.getElementById("next").addEventListener("click", () => step(1));
window.addEventListener("keydown", (e) => {
  if (e.altKey || e.ctrlKey || e.metaKey) return;
  if (["INPUT", "TEXTAREA"].includes(document.activeElement?.tagName)) return;
  if (e.key === "ArrowLeft") step(-1);
  if (e.key === "ArrowRight") step(1);
});

function feedbackBlock(tab) {
  const box = el("div", "feedback");
  box.append(el("p", "", "Wie gut verstehst du das?"));
  const rating = el("div", "rating");
  for (let i = 1; i <= 5; i++) {
    const label = el("label", "", String(i));
    const input = el("input");
    input.type = "radio"; input.name = "rating-" + tab.id; input.value = String(i);
    input.checked = tab.rating === i;
    label.prepend(input);
    rating.append(label);
  }
  const note = el("textarea");
  note.placeholder = "Was würde dir helfen? (optional)";
  note.value = tab.feedback ?? "";
  const next = el("button", "primary", "Weiter"); next.type = "button";
  const cancel = el("button", "", "Abbrechen"); cancel.type = "button";
  const actions = el("div", "actions");
  actions.append(next, cancel);
  box.append(rating, note, actions);
  const frozen = tab.status === "done" || tab.status === "cancelled";
  next.disabled = frozen || tab.rating === undefined;
  cancel.disabled = frozen;
  note.disabled = frozen;
  for (const i of rating.querySelectorAll("input")) i.disabled = frozen;
  rating.addEventListener("change", () => { next.disabled = false; });
  next.addEventListener("click", async () => {
    const picked = rating.querySelector("input:checked");
    if (!picked) return;
    next.disabled = true;
    const r = await post("/tabs/" + tab.id + "/finish", { rating: Number(picked.value), feedback: note.value });
    if (r.status !== 200) { next.disabled = false; box.append(el("p", "status", r.error ?? "Konnte nicht senden.")); }
  });
  cancel.addEventListener("click", () => post("/tabs/" + tab.id + "/finish", { cancel: true }));
  if (tab.status === "cancelled") box.append(el("p", "status", "Abgebrochen."));
  if (tab.status === "done") box.append(el("p", "status", "Gesendet. Weiter im Terminal."));
  return box;
}

function quizBody(tab, section) {
  const view = tab.view;
  section.append(el("h1", "", view.question));
  if (view.details) section.append(el("p", "details", view.details));
  const form = el("form");
  const box = el("div", "options");
  const answered = tab.status !== "open";
  const correct = new Set(tab.result?.correct ?? []);
  const picked = new Set(tab.result?.answers ?? []);
  for (const o of view.options) {
    const dontKnow = o.index === 0;
    const label = el("label", "opt" + (dontKnow ? " dontknow" : ""));
    const input = el("input");
    input.type = view.multiSelect && !dontKnow ? "checkbox" : "radio";
    input.name = "answer-" + tab.id; input.value = o.value; input.dataset.dontKnow = dontKnow;
    input.disabled = answered;
    input.checked = picked.has(o.value);
    const text = el("span", "", dontKnow ? o.label : o.index + ". " + o.label);
    if (o.description) text.append(el("span", "desc", o.description));
    label.append(input, text);
    if (answered && correct.has(o.value)) label.classList.add("correct");
    else if (answered && picked.has(o.value) && !dontKnow) label.classList.add("wrong");
    box.append(label);
  }
  box.addEventListener("change", (e) => {
    const picked = e.target;
    for (const i of box.querySelectorAll("input")) {
      if (i === picked) continue;
      if (picked.dataset.dontKnow === "true" || i.dataset.dontKnow === "true" || !view.multiSelect) i.checked = false;
    }
  });
  const note = el("textarea"); note.placeholder = "Notiz (optional): Begründung oder Unsicherheit"; note.disabled = answered; note.value = tab.result?.note ?? "";
  const submit = el("button", "primary", "Antworten"); submit.type = "submit"; submit.disabled = answered;
  const cancel = el("button", "", "Abbrechen"); cancel.type = "button"; cancel.disabled = answered;
  const actions = el("div", "actions"); actions.append(submit, cancel);
  form.append(box, note, actions);
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const answers = [...box.querySelectorAll("input:checked")].map((i) => i.value);
    if (!answers.length) return;
    submit.disabled = true;
    const r = await post("/tabs/" + tab.id + "/answer", { answers, note: note.value });
    if (r.status !== 200) submit.disabled = false;
  });
  cancel.addEventListener("click", () => post("/tabs/" + tab.id + "/answer", { cancel: true }));
  section.append(form);
  if (tab.result) {
    const out = el("div", "result");
    out.append(el("p", "", tab.result.text));
    section.append(out);
    section.append(feedbackBlock(tab));
  } else if (tab.status === "cancelled") {
    section.append(el("p", "status", "Abgebrochen."));
  }
}

function render(tab) {
  const prev = tabs.get(tab.id);
  const section = el("section");
  section.dataset.id = tab.id;
  if (tab.kind === "quiz") {
    if (tab.introHtml) { const intro = el("div", "intro"); intro.innerHTML = tab.introHtml; section.append(intro); }
    quizBody(tab, section);
  } else {
    const body = el("div", "body");
    body.innerHTML = tab.bodyHtml;
    if (tab.image) { const img = el("img"); img.src = base + "/viz/" + encodeURIComponent(tab.image); img.alt = tab.title; body.append(img); }
    section.append(body, feedbackBlock(tab));
  }
  if (prev) prev.section.replaceWith(section); else document.getElementById("tabs").append(section);
  tabs.set(tab.id, { data: tab, section });
  section.hidden = true;
  math(section);
}

function applyState(list) {
  for (const t of list) render(t);
  activate(list.length ? list[list.length - 1].id : active);
}
// The first state event arrives before the deferred KaTeX scripts have run, so connect only once the page has loaded.
window.addEventListener("load", () => {
  const events = new EventSource(base + "/events");
  events.addEventListener("state", (e) => applyState(JSON.parse(e.data).tabs));
  events.addEventListener("tab", (e) => { const t = JSON.parse(e.data); render(t); activate(t.id); });
  events.addEventListener("update", (e) => { const t = JSON.parse(e.data); render(t); activate(active); });
});
</script>
</body>
</html>`;
}
