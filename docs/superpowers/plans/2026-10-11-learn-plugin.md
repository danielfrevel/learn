# learn Plugin Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A Claude Code plugin that reproduces the pi learning system: teach skill, graded quiz tool, Obsidian markdown log, verified diagrams, researcher.

**Architecture:** Plugin repo with skills, agents, hooks, one stdio MCP server (quiz, form elicitation, grading in the server), one hook-driven CLI that renders the session transcript into a markdown log, and two bash render scripts for the maker agents. No build step: Node 25 runs `.ts` directly.

**Tech Stack:** Node 25 (type stripping), TypeScript (`tsc --noEmit` only), `node --test`, bash, `mermaid-cli` and `librsvg` via nix.

**Spec:** `docs/superpowers/specs/2026-10-11-learn-plugin-design.md`

## Global Constraints

- Runtime dependencies: none. Dev dependencies: `typescript`, `@types/node`.
- All `.ts` files use ESM with explicit `.ts` import extensions and only erasable TypeScript syntax (no enums, no parameter properties).
- Quiz tool text output and log callouts are German. Skill, agent, code and README text are English.
- Hooks never block the session: every hook path exits 0, errors go to stderr.
- `correctAnswer` and `explanation` never appear in the log before the answer.
- Display order of quiz options is `displayOrder()` from `src/quiz/grade.ts`, deterministic, used by server and log renderer alike.
- Comments only for: external workaround (named), magic value source, correctness constraint, deliberate omission.
- Commit after each task, one-line subject, no trailer.

## Review Focus

1. A quiz option list whose `correctAnswer` references a value absent from `options`: the tool must return an error result, not elicit. Test in Task 2.
2. A transcript whose last line is incomplete (Claude Code mid-write): `sync` must not consume it and the next sync must render it once. Test in Task 5.
3. A quiz where the user selects "Ich weiß es nicht" together with real options in multi-select: counts as dontKnow, never as correct. Test in Task 2.
4. A user prompt that is a skill expansion or an image attachment (`isMeta`): must not appear in the log. Test in Task 5.
5. `render-mermaid` invoked when `mmdc` is missing: exit 2 with an install hint, no stack trace. Test in Task 9.

---

### Task 1: Scaffold the plugin repository

**Files:**
- Create: `package.json`, `tsconfig.json`, `.gitignore`, `.claude-plugin/plugin.json`, `.claude-plugin/marketplace.json`, `flake.nix`, `README.md`

**Interfaces:**
- Produces: `npm test` runs `node --test`, `npm run typecheck` runs `tsc --noEmit`. Plugin name `learn`, marketplace `learn-local`.

- [ ] **Step 1: package.json**

```json
{
  "name": "learn",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "scripts": {
    "test": "node --test 'test/**/*.test.ts'",
    "typecheck": "tsc --noEmit"
  },
  "devDependencies": {
    "@types/node": "^24.0.0",
    "typescript": "^5.8.0"
  }
}
```

- [ ] **Step 2: tsconfig.json**

```json
{
  "compilerOptions": {
    "target": "es2023",
    "module": "nodenext",
    "moduleResolution": "nodenext",
    "allowImportingTsExtensions": true,
    "rewriteRelativeImportExtensions": false,
    "erasableSyntaxOnly": true,
    "verbatimModuleSyntax": true,
    "strict": true,
    "noEmit": true,
    "skipLibCheck": true,
    "types": ["node"]
  },
  "include": ["src/**/*.ts", "test/**/*.ts"]
}
```

- [ ] **Step 3: .gitignore**

```
node_modules/
.direnv/
result
```

- [ ] **Step 4: Plugin manifest and marketplace**

`.claude-plugin/plugin.json`:
```json
{
  "name": "learn",
  "description": "Teaching system: probe, plan, teach. Graded quiz, Obsidian log, verified diagrams.",
  "version": "0.1.0",
  "author": { "name": "dan" }
}
```

`.claude-plugin/marketplace.json`:
```json
{
  "name": "learn-local",
  "owner": { "name": "dan" },
  "plugins": [
    { "name": "learn", "source": "./", "description": "Teaching system for university math and CS." }
  ]
}
```

- [ ] **Step 5: flake.nix**

```nix
{
  description = "learn: Claude Code teaching plugin";
  inputs.nixpkgs.url = "github:NixOS/nixpkgs/nixos-unstable";
  outputs = { self, nixpkgs }:
    let
      system = "x86_64-linux";
      pkgs = nixpkgs.legacyPackages.${system};
    in {
      devShells.${system}.default = pkgs.mkShell {
        packages = with pkgs; [ nodejs mermaid-cli librsvg ];
      };
    };
}
```

- [ ] **Step 6: README.md stub**

```markdown
# learn

Claude Code port of [amosblomqvist/learn](https://github.com/amosblomqvist/learn).

See `docs/superpowers/specs/` for the design. Install instructions follow in the final task.
```

- [ ] **Step 7: Install dev deps and validate**

Run: `cd ~/code/learn && npm install && npm run typecheck && claude plugin validate .`
Expected: typecheck passes (no sources yet), validate reports the plugin as valid. If validate rejects `"source": "./"`, change the marketplace entry to `"source": "."` and retry; if still rejected, note the error in the README and rely on `claude --plugin-dir` until fixed.

- [ ] **Step 8: Commit**

```bash
git add -A && git commit -m "Scaffold plugin repository"
```

---

### Task 2: Quiz grading core

**Files:**
- Create: `src/quiz/grade.ts`
- Test: `test/quiz/grade.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export const DONT_KNOW_VALUE = "__dont_know__";
  export const DONT_KNOW_LABEL = "Ich weiß es nicht";
  export interface QuizOption { label: string; value: string; description?: string }
  export interface DisplayOption extends QuizOption { index: number } // 1-based; dontKnow has index 0
  export interface QuizInput { question: string; details?: string; options: QuizOption[]; multiSelect: boolean; correctAnswer: string[]; explanation: string; shuffle: boolean }
  export type Validation = { ok: true; quiz: QuizInput } | { ok: false; error: string };
  export function normalizeOptions(raw: unknown): QuizOption[];
  export function validateInput(raw: unknown): Validation;
  export function displayOrder(quiz: Pick<QuizInput, "question" | "options" | "shuffle">): DisplayOption[];
  export interface GradeResult { dontKnow: boolean; correct?: boolean; answers: DisplayOption[]; correctOptions: DisplayOption[] }
  export function grade(display: DisplayOption[], selected: string[], quiz: Pick<QuizInput, "correctAnswer" | "multiSelect">): GradeResult;
  ```

- [ ] **Step 1: Write the failing tests**

`test/quiz/grade.test.ts`:
```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  DONT_KNOW_VALUE, displayOrder, grade, normalizeOptions, validateInput,
} from "../../src/quiz/grade.ts";

const opts = [
  { label: "0" }, { label: "1", value: "one" }, { label: "unendlich", description: "divergiert" },
];

test("normalizeOptions trims, defaults value to label, drops duplicates and empties", () => {
  const out = normalizeOptions([{ label: " 0 " }, { label: "0" }, { label: "  " }, { label: "x", value: " y " }]);
  assert.deepEqual(out, [{ label: "0", value: "0" }, { label: "x", value: "y" }]);
});

test("validateInput rejects fewer than two options", () => {
  const v = validateInput({ question: "q", options: [{ label: "a" }], correctAnswer: "a", explanation: "e" });
  assert.equal(v.ok, false);
});

test("validateInput rejects a correctAnswer that is not an option value", () => {
  const v = validateInput({ question: "q", options: opts, correctAnswer: "nope", explanation: "e" });
  assert.equal(v.ok, false);
  if (!v.ok) assert.match(v.error, /nope/);
});

test("validateInput normalizes a valid single-select input", () => {
  const v = validateInput({ question: "q", options: opts, correctAnswer: "one", explanation: "e" });
  assert.equal(v.ok, true);
  if (v.ok) {
    assert.deepEqual(v.quiz.correctAnswer, ["one"]);
    assert.equal(v.quiz.multiSelect, false);
    assert.equal(v.quiz.shuffle, true);
  }
});

test("validateInput requires an array correctAnswer for multiSelect", () => {
  const v = validateInput({ question: "q", options: opts, correctAnswer: "one", explanation: "e", multiSelect: true });
  assert.equal(v.ok, false);
});

test("displayOrder is deterministic, appends dontKnow last with index 0", () => {
  const quiz = { question: "q", options: normalizeOptions(opts), shuffle: true };
  const a = displayOrder(quiz);
  const b = displayOrder(quiz);
  assert.deepEqual(a, b);
  assert.equal(a.length, 4);
  assert.equal(a[3].value, DONT_KNOW_VALUE);
  assert.equal(a[3].index, 0);
  assert.deepEqual(a.slice(0, 3).map((o) => o.index), [1, 2, 3]);
});

test("displayOrder keeps given order when shuffle is false", () => {
  const d = displayOrder({ question: "q", options: normalizeOptions(opts), shuffle: false });
  assert.deepEqual(d.slice(0, 3).map((o) => o.value), ["0", "one", "unendlich"]);
});

test("displayOrder changes order for some inputs", () => {
  const many = normalizeOptions(Array.from({ length: 8 }, (_, i) => ({ label: `o${i}` })));
  const orders = new Set(["a", "b", "c", "d"].map((q) => displayOrder({ question: q, options: many, shuffle: true }).map((o) => o.value).join(",")));
  assert.ok(orders.size > 1);
});

test("grade single-select right and wrong", () => {
  const d = displayOrder({ question: "q", options: normalizeOptions(opts), shuffle: false });
  const right = grade(d, ["one"], { correctAnswer: ["one"], multiSelect: false });
  assert.equal(right.correct, true);
  assert.equal(right.dontKnow, false);
  assert.deepEqual(right.answers.map((o) => o.value), ["one"]);
  assert.deepEqual(right.correctOptions.map((o) => o.value), ["one"]);
  const wrong = grade(d, ["0"], { correctAnswer: ["one"], multiSelect: false });
  assert.equal(wrong.correct, false);
});

test("grade multi-select needs the exact set", () => {
  const d = displayOrder({ question: "q", options: normalizeOptions(opts), shuffle: false });
  assert.equal(grade(d, ["0", "one"], { correctAnswer: ["one", "0"], multiSelect: true }).correct, true);
  assert.equal(grade(d, ["0"], { correctAnswer: ["one", "0"], multiSelect: true }).correct, false);
  assert.equal(grade(d, ["0", "one", "unendlich"], { correctAnswer: ["one", "0"], multiSelect: true }).correct, false);
});

test("grade dontKnow wins over any selection", () => {
  const d = displayOrder({ question: "q", options: normalizeOptions(opts), shuffle: false });
  const r = grade(d, ["one", DONT_KNOW_VALUE], { correctAnswer: ["one"], multiSelect: true });
  assert.equal(r.dontKnow, true);
  assert.equal(r.correct, undefined);
  assert.deepEqual(r.answers, []);
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npm test`
Expected: FAIL, cannot find module `src/quiz/grade.ts`.

- [ ] **Step 3: Implement**

`src/quiz/grade.ts`:
```ts
export const DONT_KNOW_VALUE = "__dont_know__";
export const DONT_KNOW_LABEL = "Ich weiß es nicht";

export interface QuizOption { label: string; value: string; description?: string }
export interface DisplayOption extends QuizOption { index: number }
export interface QuizInput {
  question: string;
  details?: string;
  options: QuizOption[];
  multiSelect: boolean;
  correctAnswer: string[];
  explanation: string;
  shuffle: boolean;
}
export type Validation = { ok: true; quiz: QuizInput } | { ok: false; error: string };
export interface GradeResult {
  dontKnow: boolean;
  correct?: boolean;
  answers: DisplayOption[];
  correctOptions: DisplayOption[];
}

const str = (v: unknown): string | undefined => (typeof v === "string" && v.trim() ? v.trim() : undefined);

export function normalizeOptions(raw: unknown): QuizOption[] {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>();
  const out: QuizOption[] = [];
  for (const item of raw) {
    const label = str(item?.label);
    if (!label) continue;
    const value = str(item?.value) ?? label;
    if (seen.has(value)) continue;
    seen.add(value);
    const description = str(item?.description);
    out.push(description ? { label, value, description } : { label, value });
  }
  return out;
}

export function validateInput(raw: unknown): Validation {
  const r = (raw ?? {}) as Record<string, unknown>;
  const question = str(r.question);
  if (!question) return { ok: false, error: "`question` is required." };
  const explanation = str(r.explanation);
  if (!explanation) return { ok: false, error: "`explanation` is required." };
  const options = normalizeOptions(r.options);
  if (options.length < 2) return { ok: false, error: "At least two distinct options are required." };
  const multiSelect = r.multiSelect === true;
  const rawCorrect = r.correctAnswer;
  if (multiSelect && !Array.isArray(rawCorrect)) return { ok: false, error: "`correctAnswer` must be an array when `multiSelect` is true." };
  const correctAnswer = (Array.isArray(rawCorrect) ? rawCorrect : [rawCorrect])
    .map((v) => str(v))
    .filter((v): v is string => v !== undefined);
  if (correctAnswer.length === 0) return { ok: false, error: "`correctAnswer` is required." };
  const values = new Set(options.map((o) => o.value));
  const unknown = correctAnswer.filter((v) => !values.has(v));
  if (unknown.length > 0) return { ok: false, error: `\`correctAnswer\` references unknown option value(s): ${unknown.join(", ")}. Use the \`value\` of an option.` };
  return {
    ok: true,
    quiz: {
      question,
      details: str(r.details),
      options,
      multiSelect,
      correctAnswer: [...new Set(correctAnswer)],
      explanation,
      shuffle: r.shuffle !== false,
    },
  };
}

function fnv1a(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h;
}

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Server and log hook run in separate processes and must show the same order,
// so the shuffle is a pure function of the question and option values.
export function displayOrder(quiz: Pick<QuizInput, "question" | "options" | "shuffle">): DisplayOption[] {
  const ordered = [...quiz.options];
  if (quiz.shuffle) {
    const rand = mulberry32(fnv1a(JSON.stringify([quiz.question, quiz.options.map((o) => o.value)])));
    for (let i = ordered.length - 1; i > 0; i--) {
      const j = Math.floor(rand() * (i + 1));
      [ordered[i], ordered[j]] = [ordered[j], ordered[i]];
    }
  }
  const display = ordered.map((o, i) => ({ ...o, index: i + 1 }));
  display.push({ label: DONT_KNOW_LABEL, value: DONT_KNOW_VALUE, index: 0 });
  return display;
}

export function grade(
  display: DisplayOption[],
  selected: string[],
  quiz: Pick<QuizInput, "correctAnswer" | "multiSelect">,
): GradeResult {
  const byValue = new Map(display.map((o) => [o.value, o]));
  const correctOptions = quiz.correctAnswer.map((v) => byValue.get(v)).filter((o): o is DisplayOption => !!o);
  if (selected.includes(DONT_KNOW_VALUE)) return { dontKnow: true, answers: [], correctOptions };
  const answers = selected.map((v) => byValue.get(v)).filter((o): o is DisplayOption => !!o);
  const chosen = new Set(answers.map((o) => o.value));
  const want = new Set(quiz.correctAnswer);
  const correct = quiz.multiSelect
    ? chosen.size === want.size && [...want].every((v) => chosen.has(v))
    : chosen.size === 1 && want.has(answers[0].value);
  return { dontKnow: false, correct, answers, correctOptions };
}
```

- [ ] **Step 4: Run tests**

Run: `npm test && npm run typecheck`
Expected: all grade tests PASS, typecheck clean.

- [ ] **Step 5: Commit**

```bash
git add src/quiz/grade.ts test/quiz/grade.test.ts && git commit -m "Add quiz grading core"
```

---

### Task 3: Plain-math rewrite for the terminal

**Files:**
- Create: `src/quiz/plainmath.ts`
- Test: `test/quiz/plainmath.test.ts`

**Interfaces:**
- Produces: `export function plainMath(text: string): string`

- [ ] **Step 1: Failing tests**

`test/quiz/plainmath.test.ts`:
```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { plainMath } from "../../src/quiz/plainmath.ts";

test("strips dollar fences", () => {
  assert.equal(plainMath("Sei $x$ reell."), "Sei x reell.");
  assert.equal(plainMath("$$\nf(x)\n$$"), "f(x)");
});

test("rewrites common commands", () => {
  assert.equal(plainMath("$\\lim_{n\\to\\infty} \\frac{1}{n}$"), "lim_{n→∞} (1)/(n)");
  assert.equal(plainMath("$a \\le b \\ne c \\ge d$"), "a ≤ b ≠ c ≥ d");
  assert.equal(plainMath("$\\sqrt{2} \\cdot \\alpha$"), "sqrt(2) · α");
  assert.equal(plainMath("$x^{2}$ und $x_{i}$"), "x^{2} und x_{i}");
});

test("keeps unknown commands by name", () => {
  assert.equal(plainMath("$\\mathbb{R}$"), "mathbb{R}");
});

test("leaves text without math untouched", () => {
  assert.equal(plainMath("Warum?"), "Warum?");
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npm test`
Expected: FAIL, module not found.

- [ ] **Step 3: Implement**

`src/quiz/plainmath.ts`:
```ts
const SYMBOLS: Record<string, string> = {
  to: "→", infty: "∞", le: "≤", leq: "≤", ge: "≥", geq: "≥", ne: "≠", neq: "≠",
  cdot: "·", times: "×", pm: "±", in: "∈", notin: "∉", subset: "⊂", subseteq: "⊆",
  cup: "∪", cap: "∩", forall: "∀", exists: "∃", sum: "Σ", prod: "Π", int: "∫",
  partial: "∂", nabla: "∇", rightarrow: "→", leftarrow: "←", Rightarrow: "⇒", Leftrightarrow: "⇔",
  alpha: "α", beta: "β", gamma: "γ", delta: "δ", epsilon: "ε", varepsilon: "ε", zeta: "ζ", eta: "η",
  theta: "θ", lambda: "λ", mu: "μ", nu: "ν", xi: "ξ", pi: "π", rho: "ρ", sigma: "σ", tau: "τ",
  phi: "φ", varphi: "φ", chi: "χ", psi: "ψ", omega: "ω",
  Gamma: "Γ", Delta: "Δ", Theta: "Θ", Lambda: "Λ", Pi: "Π", Sigma: "Σ", Phi: "Φ", Psi: "Ψ", Omega: "Ω",
};

function rewrite(math: string): string {
  let s = math;
  for (let i = 0; i < 10 && /\\frac\{/.test(s); i++) {
    s = s.replace(/\\frac\{([^{}]*)\}\{([^{}]*)\}/g, "($1)/($2)");
  }
  s = s.replace(/\\sqrt\{([^{}]*)\}/g, "sqrt($1)");
  s = s.replace(/\\([A-Za-z]+)/g, (_, name: string) => SYMBOLS[name] ?? name);
  return s.replace(/\s+/g, " ").trim();
}

export function plainMath(text: string): string {
  return text
    .replace(/\$\$([\s\S]*?)\$\$/g, (_, m: string) => rewrite(m))
    .replace(/\$([^$\n]+?)\$/g, (_, m: string) => rewrite(m))
    .trim();
}
```

- [ ] **Step 4: Run tests**

Run: `npm test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/quiz/plainmath.ts test/quiz/plainmath.test.ts && git commit -m "Add plain-math rewrite for terminal prompts"
```

---

### Task 4: Quiz MCP server

**Files:**
- Create: `src/quiz/server.ts`, `src/quiz/result.ts`, `.mcp.json`
- Test: `test/quiz/server.test.ts`, `test/quiz/result.test.ts`

**Interfaces:**
- Consumes: Task 2 and 3 exports.
- Produces:
  ```ts
  // src/quiz/result.ts
  export const RESULT_MARKER = "learn-quiz";
  export interface QuizResult {
    status: "answered" | "cancelled";
    question: string; details?: string;
    mode: "single-select" | "multi-select";
    options: { index: number; label: string; value: string }[];
    answers: { index: number; label: string; value: string }[];
    correctIndices: number[];
    correct?: boolean; dontKnow?: boolean;
    note?: string; explanation: string;
  }
  export function formatResultText(r: QuizResult): string;
  export function encodeResult(r: QuizResult): string;         // "<!--learn-quiz {json}-->"
  export function decodeResult(text: string): QuizResult | undefined;
  ```
  The tool result content is `[{type:"text", text: formatResultText(r)}, {type:"text", text: encodeResult(r)}]` plus `structuredContent: r`. The log renderer in Task 6 uses `decodeResult` on the joined result text.

- [ ] **Step 1: Failing tests for result formatting**

`test/quiz/result.test.ts`:
```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { decodeResult, encodeResult, formatResultText, type QuizResult } from "../../src/quiz/result.ts";

const base: QuizResult = {
  status: "answered", question: "q", mode: "single-select",
  options: [{ index: 1, label: "A", value: "a" }, { index: 2, label: "B", value: "b" }],
  answers: [{ index: 2, label: "B", value: "b" }], correctIndices: [1], correct: false, explanation: "weil",
};

test("formats wrong answer", () => {
  assert.equal(formatResultText(base), "✗ Falsch: 2. B\nRichtig wäre: 1. A\nErklärung: weil");
});

test("formats right answer with note", () => {
  const r = { ...base, answers: [{ index: 1, label: "A", value: "a" }], correct: true, note: "hm" };
  assert.equal(formatResultText(r), "✓ Richtig: 1. A\nErklärung: weil\nNotiz: hm");
});

test("formats dont know", () => {
  const r = { ...base, answers: [], correct: undefined, dontKnow: true };
  assert.equal(formatResultText(r), "Weiß nicht.\nRichtig wäre: 1. A\nErklärung: weil");
});

test("formats cancelled", () => {
  const r = { ...base, status: "cancelled" as const, answers: [], correct: undefined };
  assert.equal(formatResultText(r), "Quiz abgebrochen, keine Antwort. Weiter ohne Bewertung.");
});

test("encode and decode round-trip inside other text", () => {
  const text = "✗ Falsch\n" + encodeResult(base) + "\n";
  assert.deepEqual(decodeResult(text), base);
  assert.equal(decodeResult("nothing here"), undefined);
});
```

- [ ] **Step 2: Implement result.ts**

```ts
export const RESULT_MARKER = "learn-quiz";

export interface QuizResult {
  status: "answered" | "cancelled";
  question: string;
  details?: string;
  mode: "single-select" | "multi-select";
  options: { index: number; label: string; value: string }[];
  answers: { index: number; label: string; value: string }[];
  correctIndices: number[];
  correct?: boolean;
  dontKnow?: boolean;
  note?: string;
  explanation: string;
}

const numbered = (o: { index: number; label: string }) => `${o.index}. ${o.label}`;

export function formatResultText(r: QuizResult): string {
  if (r.status === "cancelled") return "Quiz abgebrochen, keine Antwort. Weiter ohne Bewertung.";
  const correct = r.options.filter((o) => r.correctIndices.includes(o.index)).map(numbered).join(", ");
  const lines: string[] = [];
  if (r.dontKnow) lines.push("Weiß nicht.", `Richtig wäre: ${correct}`);
  else if (r.correct) lines.push(`✓ Richtig: ${r.answers.map(numbered).join(", ")}`);
  else lines.push(`✗ Falsch: ${r.answers.map(numbered).join(", ")}`, `Richtig wäre: ${correct}`);
  lines.push(`Erklärung: ${r.explanation}`);
  if (r.note) lines.push(`Notiz: ${r.note}`);
  return lines.join("\n");
}

export function encodeResult(r: QuizResult): string {
  return `<!--${RESULT_MARKER} ${JSON.stringify(r)}-->`;
}

export function decodeResult(text: string): QuizResult | undefined {
  const m = text.match(new RegExp(`<!--${RESULT_MARKER} (\\{[\\s\\S]*?\\})-->`));
  if (!m) return undefined;
  try {
    return JSON.parse(m[1]) as QuizResult;
  } catch {
    return undefined;
  }
}
```

Run: `npm test` → result tests PASS.

- [ ] **Step 3: Failing protocol test**

`test/quiz/server.test.ts`:
```ts
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
```

Run: `npm test` → server tests FAIL (file missing).

- [ ] **Step 4: Implement server.ts**

```ts
import { createInterface } from "node:readline";
import {
  DONT_KNOW_LABEL, DONT_KNOW_VALUE, displayOrder, grade, validateInput,
  type DisplayOption, type QuizInput,
} from "./grade.ts";
import { plainMath } from "./plainmath.ts";
import { encodeResult, formatResultText, type QuizResult } from "./result.ts";

const TOOL = {
  name: "quiz",
  description: [
    "Pose ONE graded multiple-choice question. The learner answers in a dialog; the server grades and returns ✓/✗, the correct answer and the explanation.",
    "Options only, no free text. Give each option a stable `value` and reference the correct one(s) by value in `correctAnswer`.",
    "An 'Ich weiß es nicht' option is always added; it is neither right nor wrong.",
    "Options are shuffled by default; set `shuffle: false` when order carries meaning (ordered numbers, 'all of the above').",
    "Write math as LaTeX ($...$); the log renders it. Keep options parallel: same length, same grain, no justification in any option.",
  ].join(" "),
  inputSchema: {
    type: "object",
    properties: {
      question: { type: "string", description: "The single quiz question." },
      details: { type: "string", description: "Optional context shown under the question." },
      options: {
        type: "array",
        minItems: 2,
        items: {
          type: "object",
          properties: {
            label: { type: "string", description: "Display label." },
            value: { type: "string", description: "Stable id, defaults to label." },
            description: { type: "string", description: "Optional detail shown next to the label." },
          },
          required: ["label"],
        },
      },
      multiSelect: { type: "boolean", description: "True when the learner must select the exact set of correct options." },
      correctAnswer: {
        oneOf: [{ type: "string" }, { type: "array", items: { type: "string" } }],
        description: "Option value(s) that are correct. String for single-select, array for multi-select.",
      },
      explanation: { type: "string", description: "Revealed after answering, right or wrong." },
      shuffle: { type: "boolean", description: "Default true." },
    },
    required: ["question", "options", "correctAnswer", "explanation"],
  },
};

const write = (msg: unknown) => process.stdout.write(JSON.stringify(msg) + "\n");
let nextId = 1;
const pending = new Map<number, (msg: any) => void>();

function request(method: string, params: unknown): Promise<any> {
  const id = nextId++;
  write({ jsonrpc: "2.0", id, method, params });
  return new Promise((resolve) => pending.set(id, resolve));
}

const numbered = (o: DisplayOption) => (o.value === DONT_KNOW_VALUE ? DONT_KNOW_LABEL : `${o.index}. ${o.label}`);
const HINT = "→ öffnet die Liste, ↑/↓ wählen, Enter bestätigt.";

function elicitationSchema(quiz: QuizInput, display: DisplayOption[]) {
  const answer = quiz.multiSelect
    ? {
        type: "array",
        title: "Antwort (mehrere möglich)",
        description: HINT,
        items: { type: "string", enum: display.map(numbered) },
      }
    : {
        type: "string",
        title: "Antwort",
        description: HINT,
        oneOf: display.map((o) => ({ const: o.value, title: numbered(o) })),
      };
  return {
    type: "object",
    properties: {
      answer,
      note: { type: "string", title: "Notiz (optional)", description: "Freitext, z. B. Begründung oder Unsicherheit." },
    },
    required: ["answer"],
  };
}

function selectedValues(quiz: QuizInput, display: DisplayOption[], raw: unknown): string[] {
  const picks = Array.isArray(raw) ? raw : [raw];
  const byTitle = new Map(display.map((o) => [numbered(o), o.value]));
  return picks
    .filter((p): p is string => typeof p === "string")
    .map((p) => byTitle.get(p) ?? p);
}

async function runQuiz(args: unknown) {
  const v = validateInput(args);
  if (!v.ok) return { isError: true, content: [{ type: "text", text: `quiz: ${v.error}` }] };
  const quiz = v.quiz;
  const display = displayOrder(quiz);
  const message = [plainMath(quiz.question), quiz.details ? plainMath(quiz.details) : ""].filter(Boolean).join("\n\n");
  const res = await request("elicitation/create", { mode: "form", message, requestedSchema: elicitationSchema(quiz, display) });
  const action = res?.result?.action;
  const content = res?.result?.content ?? {};
  const options = display.filter((o) => o.value !== DONT_KNOW_VALUE).map(({ index, label, value }) => ({ index, label, value }));
  const base: Omit<QuizResult, "answers" | "correctIndices"> = {
    status: action === "accept" ? "answered" : "cancelled",
    question: quiz.question,
    details: quiz.details,
    mode: quiz.multiSelect ? "multi-select" : "single-select",
    options,
    explanation: quiz.explanation,
  };
  const correctIndices = display.filter((o) => quiz.correctAnswer.includes(o.value)).map((o) => o.index);
  let result: QuizResult;
  if (action !== "accept") {
    result = { ...base, answers: [], correctIndices };
  } else {
    const g = grade(display, selectedValues(quiz, display, content.answer), quiz);
    const note = typeof content.note === "string" && content.note.trim() ? content.note.trim() : undefined;
    result = {
      ...base,
      answers: g.answers.map(({ index, label, value }) => ({ index, label, value })),
      correctIndices,
      correct: g.correct,
      dontKnow: g.dontKnow || undefined,
      note,
    };
  }
  return {
    content: [{ type: "text", text: formatResultText(result) }, { type: "text", text: encodeResult(result) }],
    structuredContent: result,
  };
}

async function handle(msg: any) {
  if (msg.id !== undefined && msg.method === undefined) {
    pending.get(msg.id)?.(msg);
    pending.delete(msg.id);
    return;
  }
  const { id, method, params } = msg;
  switch (method) {
    case "initialize":
      return write({
        jsonrpc: "2.0", id,
        result: {
          protocolVersion: params?.protocolVersion ?? "2025-06-18",
          capabilities: { tools: {} },
          serverInfo: { name: "learn-quiz", version: "0.1.0" },
        },
      });
    case "notifications/initialized":
      return;
    case "ping":
      return write({ jsonrpc: "2.0", id, result: {} });
    case "tools/list":
      return write({ jsonrpc: "2.0", id, result: { tools: [TOOL] } });
    case "tools/call":
      if (params?.name !== "quiz") return write({ jsonrpc: "2.0", id, error: { code: -32602, message: `unknown tool ${params?.name}` } });
      return write({ jsonrpc: "2.0", id, result: await runQuiz(params.arguments) });
    default:
      if (id !== undefined) write({ jsonrpc: "2.0", id, error: { code: -32601, message: `method not found: ${method}` } });
  }
}

createInterface({ input: process.stdin }).on("line", (line) => {
  if (!line.trim()) return;
  try {
    void handle(JSON.parse(line));
  } catch (err) {
    process.stderr.write(`learn-quiz: ${String(err)}\n`);
  }
});
```

`.mcp.json`:
```json
{
  "mcpServers": {
    "quiz": {
      "command": "node",
      "args": ["${CLAUDE_PLUGIN_ROOT}/src/quiz/server.ts"]
    }
  }
}
```

- [ ] **Step 5: Run tests and typecheck**

Run: `npm test && npm run typecheck`
Expected: PASS. If the multi-select test fails on `selectedValues`, check that numbered titles map back to values via `byTitle`.

- [ ] **Step 6: Commit**

```bash
git add src/quiz/server.ts src/quiz/result.ts .mcp.json test/quiz && git commit -m "Add quiz MCP server with form elicitation"
```

---

### Task 5: Transcript parsing and log state

**Files:**
- Create: `src/mdlog/transcript.ts`, `src/mdlog/state.ts`
- Test: `test/mdlog/transcript.test.ts`, `test/mdlog/state.test.ts`, `test/fixtures/transcript.jsonl`

**Interfaces:**
- Produces:
  ```ts
  // transcript.ts
  export type Event =
    | { kind: "user_text"; text: string }
    | { kind: "assistant_text"; text: string }
    | { kind: "tool_use"; id: string; name: string; input: unknown }
    | { kind: "tool_result"; toolUseId: string; text: string; toolUseResult: unknown };
  export function parseTranscript(buf: Buffer, cursor: number): { events: Event[]; cursor: number };
  export function transcriptPathFor(cwd: string, sessionId: string): string;
  // state.ts
  export interface LogState { logFile: string; transcript: string; cursor: number; rendered: string[] }
  export function stateDir(): string;
  export function readState(sessionId: string): LogState | undefined;
  export function writeState(sessionId: string, s: LogState): void;
  export function deleteState(sessionId: string): void;
  ```

- [ ] **Step 1: Build the fixture**

Write `test/fixtures/transcript.jsonl` by hand with these 9 lines (one JSON object per line, minified):

1. `{"type":"user","isSidechain":false,"uuid":"u1","message":{"role":"user","content":"Erklär mir Grenzwerte"}}`
2. `{"type":"user","isMeta":true,"uuid":"u2","message":{"role":"user","content":[{"type":"text","text":"Base directory for this skill: /x\n# Skill"}]}}`
3. `{"type":"assistant","isSidechain":false,"uuid":"a1","message":{"role":"assistant","content":[{"type":"thinking","thinking":"..."},{"type":"text","text":"Erst eine Frage.\n\n$\\lim_{n\\to\\infty} \\frac{1}{n}$"},{"type":"tool_use","id":"toolu_1","name":"mcp__plugin_learn_quiz__quiz","input":{"question":"Was ist $\\lim_{n\\to\\infty} \\frac{1}{n}$?","options":[{"label":"0","value":"zero"},{"label":"1","value":"one"}],"correctAnswer":"zero","explanation":"Geheim","shuffle":false}}]}}`
4. `{"type":"user","isSidechain":false,"uuid":"u3","message":{"role":"user","content":[{"type":"tool_result","tool_use_id":"toolu_1","content":[{"type":"text","text":"✓ Richtig: 1. 0\nErklärung: Geheim"},{"type":"text","text":"<!--learn-quiz {\"status\":\"answered\",\"question\":\"Was ist $\\\\lim_{n\\\\to\\\\infty} \\\\frac{1}{n}$?\",\"mode\":\"single-select\",\"options\":[{\"index\":1,\"label\":\"0\",\"value\":\"zero\"},{\"index\":2,\"label\":\"1\",\"value\":\"one\"}],\"answers\":[{\"index\":1,\"label\":\"0\",\"value\":\"zero\"}],\"correctIndices\":[1],\"correct\":true,\"explanation\":\"Geheim\"}-->"}]}]},"toolUseResult":[{"type":"text","text":"✓ Richtig: 1. 0\nErklärung: Geheim"}]}`
5. `{"type":"assistant","isSidechain":false,"uuid":"a2","message":{"role":"assistant","content":[{"type":"tool_use","id":"toolu_2","name":"AskUserQuestion","input":{"questions":[{"question":"Was willst du erreichen?","header":"Ziel","multiSelect":false,"options":[{"label":"Klausur","description":"EA und Klausur"},{"label":"Verstehen","description":"Tiefe"}]}]}}]}}`
6. `{"type":"user","isSidechain":false,"uuid":"u4","message":{"role":"user","content":[{"type":"tool_result","tool_use_id":"toolu_2","content":"Your questions have been answered: \"Was willst du erreichen?\"=\"Klausur\". You can now continue with these answers in mind."}]},"toolUseResult":{"questions":[{"question":"Was willst du erreichen?","header":"Ziel","options":[{"label":"Klausur","description":"EA und Klausur"},{"label":"Verstehen","description":"Tiefe"}]}],"answers":{"Was willst du erreichen?":"Klausur"}}}`
7. `{"type":"assistant","isSidechain":true,"uuid":"s1","message":{"role":"assistant","content":[{"type":"text","text":"subagent noise"}]}}`
8. `{"type":"attachment","uuid":"att1","attachment":{"type":"prompt_snapshot"}}`
9. `{"type":"assistant","isSidechain":false,"uuid":"a3","message":{"role":"assistant","content":[{"type":"text","text":"Gut, dann Klausur."}]}}`

Line 9 ends with `\n`. For the partial-line test the test appends an unterminated 10th line at runtime.

- [ ] **Step 2: Failing tests**

`test/mdlog/transcript.test.ts`:
```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { parseTranscript, transcriptPathFor } from "../../src/mdlog/transcript.ts";

const FIXTURE = fileURLToPath(new URL("../fixtures/transcript.jsonl", import.meta.url));
const buf = readFileSync(FIXTURE);

test("parses user, assistant, tool_use and tool_result; skips meta, sidechain, attachments", () => {
  const { events, cursor } = parseTranscript(buf, 0);
  assert.equal(cursor, buf.length);
  assert.deepEqual(events.map((e) => e.kind), [
    "user_text", "assistant_text", "tool_use", "tool_result", "tool_use", "tool_result", "assistant_text",
  ]);
  assert.equal(events[0].kind === "user_text" && events[0].text, "Erklär mir Grenzwerte");
  const tu = events[2];
  assert.ok(tu.kind === "tool_use" && tu.name === "mcp__plugin_learn_quiz__quiz" && tu.id === "toolu_1");
  const tr = events[3];
  assert.ok(tr.kind === "tool_result" && tr.toolUseId === "toolu_1" && tr.text.includes("<!--learn-quiz"));
  const ask = events[5];
  assert.ok(ask.kind === "tool_result" && (ask.toolUseResult as any).answers["Was willst du erreichen?"] === "Klausur");
});

test("does not consume a trailing partial line", () => {
  const partial = Buffer.concat([buf, Buffer.from('{"type":"assistant","uuid":"a4","message":{"role":"assistant","content":[{"type":"text","text":"unfinished')]);
  const first = parseTranscript(partial, 0);
  assert.equal(first.cursor, buf.length);
  assert.equal(first.events.length, 7);
  const completed = Buffer.concat([partial, Buffer.from('"}]}}\n')]);
  const second = parseTranscript(completed, first.cursor);
  assert.equal(second.events.length, 1);
  assert.equal(second.cursor, completed.length);
});

test("skips unparseable lines", () => {
  const broken = Buffer.from('not json\n{"type":"assistant","message":{"role":"assistant","content":[{"type":"text","text":"ok"}]}}\n');
  const { events } = parseTranscript(broken, 0);
  assert.deepEqual(events, [{ kind: "assistant_text", text: "ok" }]);
});

test("transcriptPathFor encodes cwd like Claude Code", () => {
  const p = transcriptPathFor("/home/dan/Documents/Uni/Algo Mathe", "abc");
  assert.ok(p.endsWith("/.claude/projects/-home-dan-Documents-Uni-Algo-Mathe/abc.jsonl"));
});
```

`test/mdlog/state.test.ts`:
```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { deleteState, readState, stateDir, writeState } from "../../src/mdlog/state.ts";

test("state round-trips under XDG_STATE_HOME", () => {
  process.env.XDG_STATE_HOME = mkdtempSync(join(tmpdir(), "learn-state-"));
  assert.ok(stateDir().startsWith(process.env.XDG_STATE_HOME));
  assert.equal(readState("s1"), undefined);
  const s = { logFile: "/v/l.md", transcript: "/t.jsonl", cursor: 12, rendered: ["toolu_1"] };
  writeState("s1", s);
  assert.deepEqual(readState("s1"), s);
  deleteState("s1");
  assert.equal(readState("s1"), undefined);
});
```

Run: `npm test` → FAIL, modules missing.

- [ ] **Step 3: Implement transcript.ts**

```ts
import { homedir } from "node:os";
import { join } from "node:path";

export type Event =
  | { kind: "user_text"; text: string }
  | { kind: "assistant_text"; text: string }
  | { kind: "tool_use"; id: string; name: string; input: unknown }
  | { kind: "tool_result"; toolUseId: string; text: string; toolUseResult: unknown };

function blockText(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .filter((b) => b && b.type === "text" && typeof b.text === "string")
    .map((b) => b.text)
    .join("\n");
}

function eventsOf(entry: any): Event[] {
  if (!entry || entry.isSidechain || entry.isMeta) return [];
  const content = entry.message?.content;
  if (entry.type === "user") {
    if (typeof content === "string") return content.trim() ? [{ kind: "user_text", text: content }] : [];
    if (!Array.isArray(content)) return [];
    const out: Event[] = [];
    for (const b of content) {
      if (b?.type === "text" && typeof b.text === "string" && b.text.trim()) out.push({ kind: "user_text", text: b.text });
      if (b?.type === "tool_result") out.push({ kind: "tool_result", toolUseId: b.tool_use_id, text: blockText(b.content), toolUseResult: entry.toolUseResult });
    }
    return out;
  }
  if (entry.type === "assistant" && Array.isArray(content)) {
    const out: Event[] = [];
    for (const b of content) {
      if (b?.type === "text" && typeof b.text === "string" && b.text.trim()) out.push({ kind: "assistant_text", text: b.text });
      if (b?.type === "tool_use") out.push({ kind: "tool_use", id: b.id, name: b.name, input: b.input });
    }
    return out;
  }
  return [];
}

export function parseTranscript(buf: Buffer, cursor: number): { events: Event[]; cursor: number } {
  const end = buf.lastIndexOf(0x0a);
  if (end < cursor) return { events: [], cursor };
  const chunk = buf.subarray(cursor, end + 1).toString("utf8");
  const events: Event[] = [];
  for (const line of chunk.split("\n")) {
    if (!line.trim()) continue;
    try {
      events.push(...eventsOf(JSON.parse(line)));
    } catch {
      continue;
    }
  }
  return { events, cursor: end + 1 };
}

export function transcriptPathFor(cwd: string, sessionId: string): string {
  return join(homedir(), ".claude", "projects", cwd.replace(/[^A-Za-z0-9-]/g, "-"), `${sessionId}.jsonl`);
}
```

- [ ] **Step 4: Implement state.ts**

```ts
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

export interface LogState {
  logFile: string;
  transcript: string;
  cursor: number;
  rendered: string[];
}

export function stateDir(): string {
  const base = process.env.XDG_STATE_HOME || join(homedir(), ".local", "state");
  return join(base, "learn", "mdlog");
}

const file = (sessionId: string) => join(stateDir(), `${sessionId}.json`);

export function readState(sessionId: string): LogState | undefined {
  const p = file(sessionId);
  if (!existsSync(p)) return undefined;
  try {
    return JSON.parse(readFileSync(p, "utf8")) as LogState;
  } catch {
    return undefined;
  }
}

export function writeState(sessionId: string, s: LogState): void {
  mkdirSync(stateDir(), { recursive: true });
  writeFileSync(file(sessionId), JSON.stringify(s, null, 2));
}

export function deleteState(sessionId: string): void {
  rmSync(file(sessionId), { force: true });
}
```

- [ ] **Step 5: Run tests**

Run: `npm test && npm run typecheck`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/mdlog/transcript.ts src/mdlog/state.ts test/mdlog test/fixtures && git commit -m "Add transcript parser and log state"
```

---

### Task 6: Markdown renderer

**Files:**
- Create: `src/mdlog/render.ts`
- Test: `test/mdlog/render.test.ts`

**Interfaces:**
- Consumes: `Event` from Task 5, `displayOrder`/`normalizeOptions` from Task 2, `decodeResult` from Task 4.
- Produces:
  ```ts
  export const QUIZ_TOOL = /^mcp__.*quiz__quiz$/;
  export const ASK_TOOL = "AskUserQuestion";
  export function isQuestionTool(name: string): boolean;
  export function questionBlock(name: string, input: unknown): string | undefined;
  export function renderEvents(events: Event[], rendered: Set<string>): string[];
  ```
  `renderEvents` returns markdown blocks in order, renders a question block for a `tool_use` only when its id is not yet in `rendered` (and adds it), and renders result blocks for `tool_result` events of question tools.

- [ ] **Step 1: Failing tests**

`test/mdlog/render.test.ts`:
```ts
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
```

Run: `npm test` → FAIL.

- [ ] **Step 2: Implement render.ts**

```ts
import { displayOrder, normalizeOptions, DONT_KNOW_VALUE } from "../quiz/grade.ts";
import { decodeResult, formatResultText } from "../quiz/result.ts";
import type { Event } from "./transcript.ts";

export const QUIZ_TOOL = /^mcp__.*quiz__quiz$/;
export const ASK_TOOL = "AskUserQuestion";

export function isQuestionTool(name: string): boolean {
  return QUIZ_TOOL.test(name) || name === ASK_TOOL;
}

const quote = (lines: string[]) => lines.map((l) => (l ? `> ${l}` : ">")).join("\n");
const callout = (type: string, title: string, body: string[]) => quote([`[!${type}] ${title}`, ...body]);

function stripNoise(text: string): string {
  return text
    .replace(/<command-message>[\s\S]*?<\/command-message>/g, "")
    .replace(/<command-name>[\s\S]*?<\/command-name>/g, "")
    .replace(/<command-args>[\s\S]*?<\/command-args>/g, "")
    .replace(/<system-reminder[^>]*>[\s\S]*?<\/system-reminder>/g, "")
    .replace(/<local-command-[a-z]+>[\s\S]*?<\/local-command-[a-z]+>/g, "")
    .trim();
}

function userBlock(text: string): string | undefined {
  const clean = stripNoise(text);
  return clean ? quote(["[!user]", ...clean.split("\n")]) : undefined;
}

function quizQuestion(input: any): string {
  const options = displayOrder({ question: String(input?.question ?? ""), options: normalizeOptions(input?.options), shuffle: input?.shuffle !== false });
  const body = [String(input?.question ?? "")];
  if (typeof input?.details === "string" && input.details.trim()) body.push(input.details.trim());
  body.push("");
  for (const o of options) body.push(`${o.index}. ${o.label}${o.description && o.value !== DONT_KNOW_VALUE ? `: ${o.description}` : ""}`);
  return callout("question", "Quiz", body.flatMap((l) => l.split("\n")));
}

function askQuestion(input: any): string {
  const body: string[] = [];
  for (const q of input?.questions ?? []) {
    body.push(`**${q.question}**`);
    (q.options ?? []).forEach((o: any, i: number) => body.push(`${i + 1}. ${o.label}${o.description ? `: ${o.description}` : ""}`));
  }
  return callout("question", "Frage", body);
}

export function questionBlock(name: string, input: unknown): string | undefined {
  if (QUIZ_TOOL.test(name)) return quizQuestion(input);
  if (name === ASK_TOOL) return askQuestion(input);
  return undefined;
}

function quizResult(text: string): string | undefined {
  const r = decodeResult(text);
  if (!r) return undefined;
  const lines = formatResultText(r).split("\n");
  const type = r.status === "cancelled" ? "warning" : r.dontKnow ? "info" : r.correct ? "success" : "failure";
  return callout(type, lines[0], lines.slice(1));
}

function askResult(toolUseResult: any, text: string): string {
  const answers = toolUseResult?.answers;
  const body = answers && typeof answers === "object"
    ? Object.entries(answers).map(([q, a]) => `${q} → ${Array.isArray(a) ? a.join(", ") : String(a)}`)
    : [stripNoise(text)];
  return callout("info", "Antwort", body);
}

export function renderEvents(events: Event[], rendered: Set<string>): string[] {
  const toolNames = new Map<string, string>();
  const blocks: string[] = [];
  for (const e of events) {
    switch (e.kind) {
      case "user_text": {
        const b = userBlock(e.text);
        if (b) blocks.push(b);
        break;
      }
      case "assistant_text":
        blocks.push(e.text.trim());
        break;
      case "tool_use": {
        toolNames.set(e.id, e.name);
        if (!isQuestionTool(e.name) || rendered.has(e.id)) break;
        const b = questionBlock(e.name, e.input);
        if (b) {
          blocks.push(b);
          rendered.add(e.id);
        }
        break;
      }
      case "tool_result": {
        const name = toolNames.get(e.toolUseId);
        if (name === ASK_TOOL || (e.toolUseResult as any)?.answers) blocks.push(askResult(e.toolUseResult, e.text));
        else {
          const b = quizResult(e.text);
          if (b) blocks.push(b);
        }
        break;
      }
    }
  }
  return blocks;
}
```

- [ ] **Step 3: Run tests, fix until green**

Run: `npm test && npm run typecheck`
Expected: PASS. The quiz question block in the fixture test assumes `shuffle: false`, which the fixture sets.

- [ ] **Step 4: Commit**

```bash
git add src/mdlog/render.ts test/mdlog/render.test.ts && git commit -m "Add markdown log renderer"
```

---

### Task 7: md-log CLI, hooks and wrapper

**Files:**
- Create: `src/mdlog/cli.ts`, `hooks/hooks.json`, `bin/learn-mdlog`
- Test: `test/mdlog/cli.test.ts`

**Interfaces:**
- Consumes: Tasks 5 and 6.
- Produces: CLI `node src/mdlog/cli.ts <link <file> | unlink | sync> [--session ID] [--cwd DIR]`. Hook payload on stdin when stdin is not a TTY. `bin/learn-mdlog` forwards to the CLI.

- [ ] **Step 1: Failing test**

`test/mdlog/cli.test.ts`:
```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { copyFileSync, mkdtempSync, readFileSync, appendFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const CLI = fileURLToPath(new URL("../../src/mdlog/cli.ts", import.meta.url));
const FIXTURE = fileURLToPath(new URL("../fixtures/transcript.jsonl", import.meta.url));

function run(args: string[], stdin: string, env: Record<string, string>) {
  return execFileSync(process.execPath, [CLI, ...args], { input: stdin, env: { ...process.env, ...env }, encoding: "utf8" });
}

test("link backfills, sync is idempotent and appends only new entries", () => {
  const dir = mkdtempSync(join(tmpdir(), "learn-cli-"));
  const transcript = join(dir, "s1.jsonl");
  copyFileSync(FIXTURE, transcript);
  const log = join(dir, "lesson.md");
  const env = { XDG_STATE_HOME: join(dir, "state"), LEARN_TRANSCRIPT: transcript };

  run(["link", log, "--session", "s1"], "", env);
  const first = readFileSync(log, "utf8");
  assert.ok(first.startsWith("> [!user]\n> Erklär mir Grenzwerte"));
  assert.ok(first.includes("> [!question] Quiz"));
  assert.ok(first.trimEnd().endsWith("Gut, dann Klausur."));

  run(["sync"], JSON.stringify({ session_id: "s1", transcript_path: transcript, hook_event_name: "Stop" }), env);
  assert.equal(readFileSync(log, "utf8"), first);

  appendFileSync(transcript, '{"type":"assistant","message":{"role":"assistant","content":[{"type":"text","text":"Nachtrag"}]}}\n');
  run(["sync"], JSON.stringify({ session_id: "s1", transcript_path: transcript, hook_event_name: "Stop" }), env);
  assert.ok(readFileSync(log, "utf8").trimEnd().endsWith("Nachtrag"));

  run(["unlink"], JSON.stringify({ session_id: "s1" }), env);
  assert.ok(!existsSync(join(dir, "state", "learn", "mdlog", "s1.json")));
});

test("PreToolUse renders the question from tool_input before the transcript has it", () => {
  const dir = mkdtempSync(join(tmpdir(), "learn-cli-"));
  const transcript = join(dir, "s2.jsonl");
  appendFileSync(transcript, "");
  const log = join(dir, "lesson.md");
  const env = { XDG_STATE_HOME: join(dir, "state"), LEARN_TRANSCRIPT: transcript };
  run(["link", log, "--session", "s2"], "", env);
  const payload = {
    session_id: "s2", transcript_path: transcript, hook_event_name: "PreToolUse",
    tool_name: "mcp__plugin_learn_quiz__quiz", tool_use_id: "toolu_9",
    tool_input: { question: "Q?", options: [{ label: "a" }, { label: "b" }], correctAnswer: "a", explanation: "secret", shuffle: false },
  };
  run(["sync"], JSON.stringify(payload), env);
  const text = readFileSync(log, "utf8");
  assert.ok(text.includes("> [!question] Quiz\n> Q?"));
  assert.ok(!text.includes("secret"));
  appendFileSync(transcript, JSON.stringify({ type: "assistant", message: { role: "assistant", content: [{ type: "tool_use", id: "toolu_9", name: "mcp__plugin_learn_quiz__quiz", input: payload.tool_input }] } }) + "\n");
  run(["sync"], JSON.stringify({ session_id: "s2", transcript_path: transcript, hook_event_name: "Stop" }), env);
  assert.equal(readFileSync(log, "utf8").split("> [!question] Quiz").length, 2);
});

test("sync without a linked log exits 0 and writes nothing", () => {
  const dir = mkdtempSync(join(tmpdir(), "learn-cli-"));
  const out = run(["sync"], JSON.stringify({ session_id: "nope", transcript_path: join(dir, "x.jsonl") }), { XDG_STATE_HOME: join(dir, "state") });
  assert.equal(out, "");
});
```

Run: `npm test` → FAIL.

- [ ] **Step 2: Implement cli.ts**

```ts
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { questionBlock, renderEvents } from "./render.ts";
import { deleteState, readState, writeState, type LogState } from "./state.ts";
import { parseTranscript, transcriptPathFor } from "./transcript.ts";

interface HookPayload {
  session_id?: string;
  transcript_path?: string;
  cwd?: string;
  hook_event_name?: string;
  tool_name?: string;
  tool_use_id?: string;
  tool_input?: unknown;
}

function readPayload(): HookPayload {
  if (process.stdin.isTTY) return {};
  try {
    const raw = readFileSync(0, "utf8").trim();
    return raw ? (JSON.parse(raw) as HookPayload) : {};
  } catch {
    return {};
  }
}

function flag(args: string[], name: string): string | undefined {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
}

function append(state: LogState, blocks: string[]): void {
  if (blocks.length === 0) return;
  mkdirSync(dirname(state.logFile), { recursive: true });
  const existing = existsSync(state.logFile) ? readFileSync(state.logFile, "utf8") : "";
  const prefix = existing.length === 0 || existing.endsWith("\n\n") ? "" : existing.endsWith("\n") ? "\n" : "\n\n";
  appendFileSync(state.logFile, prefix + blocks.join("\n\n") + "\n");
}

function sync(sessionId: string, payload: HookPayload): void {
  const state = readState(sessionId);
  if (!state) return;
  if (payload.transcript_path) state.transcript = payload.transcript_path;
  const rendered = new Set(state.rendered);
  const blocks: string[] = [];
  if (existsSync(state.transcript)) {
    const parsed = parseTranscript(readFileSync(state.transcript), state.cursor);
    blocks.push(...renderEvents(parsed.events, rendered));
    state.cursor = parsed.cursor;
  }
  if (payload.hook_event_name === "PreToolUse" && payload.tool_name && payload.tool_use_id && !rendered.has(payload.tool_use_id)) {
    const q = questionBlock(payload.tool_name, payload.tool_input);
    if (q) {
      blocks.push(q);
      rendered.add(payload.tool_use_id);
    }
  }
  append(state, blocks);
  state.rendered = [...rendered];
  writeState(sessionId, state);
}

function main(): void {
  const [cmd, ...args] = process.argv.slice(2);
  const payload = readPayload();
  const sessionId = flag(args, "--session") ?? payload.session_id ?? process.env.CLAUDE_CODE_SESSION_ID;
  if (!sessionId) throw new Error("no session id: pass --session or run from a hook");
  const cwd = flag(args, "--cwd") ?? payload.cwd ?? process.cwd();
  switch (cmd) {
    case "link": {
      const target = args.find((a) => !a.startsWith("--") && a !== flag(args, "--session") && a !== flag(args, "--cwd"));
      if (!target) throw new Error("usage: link <file>");
      const logFile = resolve(cwd, target);
      mkdirSync(dirname(logFile), { recursive: true });
      if (!existsSync(logFile)) writeFileSync(logFile, "");
      const transcript = process.env.LEARN_TRANSCRIPT ?? payload.transcript_path ?? transcriptPathFor(cwd, sessionId);
      writeState(sessionId, { logFile, transcript, cursor: 0, rendered: [] });
      sync(sessionId, payload);
      process.stdout.write(`linked ${logFile}\n`);
      return;
    }
    case "unlink":
      deleteState(sessionId);
      return;
    case "sync":
      sync(sessionId, payload);
      return;
    default:
      throw new Error("usage: cli.ts <link <file>|unlink|sync> [--session ID] [--cwd DIR]");
  }
}

try {
  main();
} catch (err) {
  process.stderr.write(`learn-mdlog: ${err instanceof Error ? err.message : String(err)}\n`);
}
```

Note the deliberate exit code 0 on error: a failing hook must never block the session.

- [ ] **Step 3: hooks.json and wrapper**

`hooks/hooks.json`:
```json
{
  "hooks": {
    "UserPromptSubmit": [
      { "hooks": [{ "type": "command", "command": "node \"${CLAUDE_PLUGIN_ROOT}/src/mdlog/cli.ts\" sync", "timeout": 10 }] }
    ],
    "PreToolUse": [
      { "matcher": "mcp__plugin_learn_quiz__quiz|AskUserQuestion", "hooks": [{ "type": "command", "command": "node \"${CLAUDE_PLUGIN_ROOT}/src/mdlog/cli.ts\" sync", "timeout": 10 }] }
    ],
    "PostToolUse": [
      { "matcher": "mcp__plugin_learn_quiz__quiz|AskUserQuestion", "hooks": [{ "type": "command", "command": "node \"${CLAUDE_PLUGIN_ROOT}/src/mdlog/cli.ts\" sync", "timeout": 10 }] }
    ],
    "Stop": [
      { "hooks": [{ "type": "command", "command": "node \"${CLAUDE_PLUGIN_ROOT}/src/mdlog/cli.ts\" sync", "timeout": 10 }] }
    ]
  }
}
```

`bin/learn-mdlog` (chmod +x):
```bash
#!/usr/bin/env bash
set -euo pipefail
exec node "$(dirname "$(readlink -f "$0")")/../src/mdlog/cli.ts" "$@" < /dev/null
```

- [ ] **Step 4: Run tests and validate**

Run: `chmod +x bin/learn-mdlog && npm test && npm run typecheck && claude plugin validate .`
Expected: PASS, plugin valid (hooks.json accepted).

- [ ] **Step 5: Commit**

```bash
git add src/mdlog/cli.ts hooks/hooks.json bin/learn-mdlog test/mdlog/cli.test.ts && git commit -m "Add md-log CLI, hooks and wrapper"
```

---

### Task 8: md-log skills

**Files:**
- Create: `skills/md-log/SKILL.md`, `skills/md-unlog/SKILL.md`

- [ ] **Step 1: Write the skills**

`skills/md-log/SKILL.md`:
```markdown
---
name: md-log
description: Link a markdown file to this session so every message, quiz and answer is mirrored into it for reading in Obsidian. Use when the learner runs /learn:md-log <file> or asks to log the lesson to a file.
---

# md-log

Run exactly this, with the path the learner gave (relative paths resolve against the project root):

```bash
learn-mdlog link "<file>" --session "$CLAUDE_CODE_SESSION_ID" --cwd "$PWD"
```

The command creates the file when missing and backfills the session so far. From then on hooks append every user message, your replies, quiz questions (before the answer, without the solution) and graded results.

Confirm with one line: the linked path. Then continue the lesson. Do not re-run the command unless the learner asks for a different file.
```

`skills/md-unlog/SKILL.md`:
```markdown
---
name: md-unlog
description: Stop mirroring this session to its markdown log. Use when the learner runs /learn:md-unlog.
---

# md-unlog

Run:

```bash
learn-mdlog unlink --session "$CLAUDE_CODE_SESSION_ID"
```

Confirm with one line.
```

- [ ] **Step 2: Validate and commit**

Run: `claude plugin validate .`
```bash
git add skills/md-log skills/md-unlog && git commit -m "Add md-log skills"
```

---

### Task 9: Render scripts

**Files:**
- Create: `bin/render-mermaid`, `bin/render-svg`, `lib/viz-publish.sh`
- Test: `test/bin/render.test.ts`, `test/fixtures/sample.svg`, `test/fixtures/sample.mmd`

**Interfaces:**
- Produces: `render-svg <src> [--save-as <slug>]`, `render-mermaid <src> [--save-as <slug>]`. Stdout lines: `preview: <path>`, and with `--save-as` also `filename: <name>` and `path: <abs>`. Published files land in `$PWD/viz/viz-<slug>-<ms>.png`.

- [ ] **Step 1: Failing tests**

`test/fixtures/sample.svg`:
```svg
<svg xmlns="http://www.w3.org/2000/svg" width="200" height="120" viewBox="0 0 200 120">
  <rect width="200" height="120" fill="white"/>
  <line x1="20" y1="100" x2="180" y2="100" stroke="black" stroke-width="2"/>
  <text x="100" y="60" font-family="sans-serif" font-size="18" text-anchor="middle">x</text>
</svg>
```

`test/fixtures/sample.mmd`:
```
graph TD
  A[Paket] --> B[Zuverlässiger Strom]
```

`test/bin/render.test.ts`:
```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const BIN = fileURLToPath(new URL("../../bin/", import.meta.url));
const FIX = fileURLToPath(new URL("../fixtures/", import.meta.url));

test("render-svg previews and publishes", () => {
  const cwd = mkdtempSync(join(tmpdir(), "learn-viz-"));
  const out = execFileSync(join(BIN, "render-svg"), [join(FIX, "sample.svg")], { cwd, encoding: "utf8" });
  const preview = out.match(/^preview: (.+)$/m)![1];
  assert.ok(existsSync(preview));
  const pub = execFileSync(join(BIN, "render-svg"), [join(FIX, "sample.svg"), "--save-as", "Number Line!"], { cwd, encoding: "utf8" });
  const filename = pub.match(/^filename: (.+)$/m)![1];
  assert.match(filename, /^viz-number-line-\d+\.png$/);
  assert.deepEqual(readdirSync(join(cwd, "viz")), [filename]);
});

test("render-mermaid fails with exit 2 and a hint when mmdc is missing", () => {
  const r = spawnSync(join(BIN, "render-mermaid"), [join(FIX, "sample.mmd")], { encoding: "utf8", env: { PATH: "/nonexistent", HOME: "/nonexistent" } });
  assert.equal(r.status, 2);
  assert.match(r.stderr, /mermaid-cli/);
});

test("render-mermaid renders when mmdc exists", { skip: spawnSync("bash", ["-c", "command -v mmdc || test -x \"$HOME/.nix-profile/bin/mmdc\""]).status !== 0 }, () => {
  const cwd = mkdtempSync(join(tmpdir(), "learn-viz-"));
  const out = execFileSync(join(BIN, "render-mermaid"), [join(FIX, "sample.mmd")], { cwd, encoding: "utf8" });
  assert.ok(existsSync(out.match(/^preview: (.+)$/m)![1]));
});
```

Run: `npm test` → FAIL.

- [ ] **Step 2: Implement lib/viz-publish.sh**

```bash
# Sourced by bin/render-*. Expects: SRC, SAVE_AS, and a render function `render_png <out>`.
viz_main() {
  local name work out
  name=$(basename "$SRC"); name=${name%.*}
  work=${TMPDIR:-/tmp}/learn-viz/$name
  mkdir -p "$work"
  out=$work/preview.png
  render_png "$out"
  echo "preview: $out"
  if [ -n "$SAVE_AS" ]; then
    local slug filename dest
    slug=$(printf '%s' "$SAVE_AS" | tr '[:upper:]' '[:lower:]' | sed -E 's/[^a-z0-9]+/-/g; s/^-+|-+$//g')
    [ -z "$slug" ] && slug=viz
    filename="viz-$slug-$(date +%s%3N).png"
    mkdir -p "$PWD/viz"
    dest=$PWD/viz/$filename
    cp "$out" "$dest"
    echo "filename: $filename"
    echo "path: $dest"
  fi
}

viz_parse_args() {
  SRC=${1:?usage: $(basename "$0") <source> [--save-as <slug>]}; shift
  SAVE_AS=""
  while [ $# -gt 0 ]; do
    case $1 in
      --save-as) SAVE_AS=${2:?--save-as needs a slug}; shift 2 ;;
      *) echo "unknown argument: $1" >&2; exit 2 ;;
    esac
  done
  [ -f "$SRC" ] || { echo "source not found: $SRC" >&2; exit 2; }
}
```

- [ ] **Step 3: Implement bin/render-svg**

```bash
#!/usr/bin/env bash
set -euo pipefail
. "$(dirname "$(readlink -f "$0")")/../lib/viz-publish.sh"
viz_parse_args "$@"

render_png() {
  if command -v rsvg-convert >/dev/null; then
    rsvg-convert -z 2 -b white -o "$1" "$SRC"
  elif command -v magick >/dev/null; then
    magick -density 192 -background white "$SRC" "$1"
  else
    echo "neither rsvg-convert nor magick found. Install: nix profile install nixpkgs#librsvg" >&2
    exit 2
  fi
}

viz_main
```

- [ ] **Step 4: Implement bin/render-mermaid**

```bash
#!/usr/bin/env bash
set -euo pipefail
. "$(dirname "$(readlink -f "$0")")/../lib/viz-publish.sh"
viz_parse_args "$@"

MMDC=${LEARN_MMDC:-$(command -v mmdc || true)}
[ -z "$MMDC" ] && [ -x "$HOME/.nix-profile/bin/mmdc" ] && MMDC=$HOME/.nix-profile/bin/mmdc
[ -z "$MMDC" ] && { echo "mmdc not found. Install: nix profile install nixpkgs#mermaid-cli" >&2; exit 2; }

render_png() {
  local cfg
  cfg=$(dirname "$1")/puppeteer.json
  # Chromium's own sandbox cannot start inside the Claude Code bash sandbox.
  echo '{"args":["--no-sandbox","--disable-gpu"]}' > "$cfg"
  "$MMDC" -q -i "$SRC" -o "$1" -b white -s 2 -p "$cfg"
}

viz_main
```

- [ ] **Step 5: Run tests**

Run: `chmod +x bin/render-svg bin/render-mermaid && npm test`
Expected: svg tests PASS, missing-mmdc test PASS, mmdc test skipped or PASS. Open the preview PNG with the Read tool once to confirm it shows the line and the `x`.

- [ ] **Step 6: Commit**

```bash
git add bin lib test/bin test/fixtures/sample.svg test/fixtures/sample.mmd && git commit -m "Add render scripts for mermaid and svg"
```

---

### Task 10: Subagents

**Files:**
- Create: `agents/researcher.md`, `agents/mermaid-maker.md`, `agents/svg-maker.md`

- [ ] **Step 1: researcher.md**

```markdown
---
name: researcher
description: Web and lecture-notes researcher. Searches, reads, and synthesizes a sourced brief that answers one question. Used by the teach skill to scope a topic and to verify any fact before it is taught.
tools: WebSearch, WebFetch, Read, Grep, Glob
model: sonnet
---

You are a research specialist. Given a question or topic, produce a focused, well-sourced brief.

You operate in an isolated context with no knowledge of any prior conversation. All necessary context is in the task description.

Process:
1. If the task names local sources (lecture notes, PDFs, summaries), read them first with `Read`. They are the primary source for this learner: definitions, notation and theorem names must match them. Cite as `[<file>, S. <page>]`.
2. Break the question into 2-4 searchable facets.
3. Search with `WebSearch` using varied angles: direct answer, authoritative source (official docs, textbooks, papers), practical experience, recent developments (only if time-sensitive).
4. For the 2-3 most promising URLs, use `WebFetch` to get full content.
5. Synthesize into a brief that directly answers the question. Where local sources and web sources disagree, say so and prefer the local source for terminology.

Evaluation:
- Primary sources and official docs outweigh blog posts and forum threads.
- Recent sources outweigh stale ones.
- Drop SEO filler, outdated info, beginner tutorials unless that is the audience.

If the first round does not fully answer the question, search again targeting the gaps.

Your FINAL message is the entire deliverable, in this format:

## Summary
2-3 sentence direct answer.

## Findings
1. **Finding** — explanation. [Source](url) or [file, S. n]
2. ...

## Sources
- Kept: title (url or path) — why relevant
- Dropped: title — why excluded

## Gaps
What could not be answered. Suggested next steps.
```

- [ ] **Step 2: mermaid-maker.md**

Take the original `agents/mermaid-maker.md` body verbatim and replace the frontmatter and the tool mechanics:

```markdown
---
name: mermaid-maker
description: Authors ONE Mermaid diagram from a brief, renders it to a PNG, LOOKS at the result, iterates until it is correct and clean, publishes the PNG into the vault's viz/ folder, and returns the filename. For structural/relational visuals (dependency graphs, flows, sequences, state machines, trees, ER, timelines).
tools: Read, Write, Edit, Bash
model: sonnet
---
```

Body: original text with these substitutions:
- "`write_mermaid`, `edit_mermaid`, `render_mermaid`" → "`Write`, `Edit`, and the `render-mermaid` command run through `Bash`".
- Step 2: "Write the source with `Write` to `/tmp/learn-viz/<short-kebab-topic>/source.mmd`."
- Step 3: "Render a preview: `render-mermaid /tmp/learn-viz/<topic>/source.mmd`. It prints `preview: <path>`. Open that path with `Read` and look at the image."
- Step 5: "Iterate with `Edit` on the source file and re-render."
- Step 6: "Publish: `render-mermaid /tmp/learn-viz/<topic>/source.mmd --save-as <short-kebab-topic>`. It prints `filename:` and `path:`. `Read` the published path once more."
- Add under guidelines: "Use `Bash` only for `render-mermaid`. Never write into the vault yourself; `--save-as` does that."
- Keep the `RESULT:` output block unchanged.

- [ ] **Step 3: svg-maker.md**

Same treatment for the original `agents/svg-maker.md`: frontmatter as above with `name: svg-maker`, source path `/tmp/learn-viz/<topic>/source.svg`, command `render-svg`. Keep the SVG guidelines (viewBox, margins, sans-serif, one accent color) verbatim.

- [ ] **Step 4: Validate and commit**

Run: `claude plugin validate .`
```bash
git add agents && git commit -m "Add researcher and maker subagents"
```

---

### Task 11: teach and visualize skills, output style

**Files:**
- Create: `skills/teach/SKILL.md`, `skills/visualize/SKILL.md`, `output-styles/learn.md`

- [ ] **Step 1: teach/SKILL.md**

Copy the original `skills/teach/SKILL.md` and apply exactly these edits:

1. Frontmatter:
   ```yaml
   ---
   name: teach
   description: Teach the learner anything so it locks in and is understood, not memorized. Use ANY time you explain or teach something, even a quick explanation. Two principles, three phases (probe, plan, teach).
   ---
   ```
2. Replace every "him"/"he"/"his" referring to the learner with "the learner"/"they"/"their".
3. Add a section right after the title:
   ```markdown
   ## Language and tools

   - Teach in **German**. Use the terminology of the learner's lecture notes; give the English term in parentheses the first time it helps. Full sentences, normal prose; this is teaching, not a terse status report.
   - Graded questions: the `quiz` MCP tool (`mcp__plugin_learn_quiz__quiz`). Preference or direction questions: `AskUserQuestion`.
   - Research and fact checks: `Agent` with `subagent_type: "learn:researcher"`. If the project's CLAUDE.md lists lecture material, pass those paths in the brief so the researcher reads them first.
   - Visuals: the `visualize` skill.
   - If the learner has not linked a log yet, suggest `/learn:md-log lessons/<date>-<topic>.md` once at the start, then move on.
   ```
4. Everywhere the original says `quiz` tool or `ask_user_question`, keep `quiz` and write `AskUserQuestion`.
5. "fire a quick `researcher` subagent" → "dispatch the `learn:researcher` subagent via `Agent`".
6. Keep the Formatting section (LaTeX) and everything else unchanged.

- [ ] **Step 2: visualize/SKILL.md**

Copy the original `skills/visualize/SKILL.md` and apply:

1. "Two makers, discovered from `.pi/agents/`" → "Two makers, plugin subagents".
2. Invoke section:
   ````markdown
   ## Invoke

   Dispatch the maker with the `Agent` tool:

   ```
   Agent(subagent_type: "learn:mermaid-maker", prompt: "<your minimal, concrete brief>")
   Agent(subagent_type: "learn:svg-maker", prompt: "<your minimal, concrete brief>")
   ```
   ````
3. "The maker owns its own purpose-built tools (`write_*`/`edit_*`/`render_*`)" → "The maker writes the source, renders it with `render-mermaid` / `render-svg`, looks at the PNG with `Read`, iterates".
4. Replace the closing note about `visual-tools` with: "The makers render through the plugin's `bin/render-mermaid` (mermaid-cli, needs `nix profile install nixpkgs#mermaid-cli`) and `bin/render-svg` (`rsvg-convert`). You never render anything yourself."
5. Keep the embed syntax `![[viz-<slug>-<timestamp>.png|500]]` and the `md-log` explanation.

- [ ] **Step 3: output-styles/learn.md**

```markdown
---
name: learn
description: Teacher for university mathematics and computer science. Replaces the coding system prompt.
keep-coding-instructions: false
force-for-plugin: true
---

You are a teacher for university mathematics and computer science, working with one learner in a terminal session whose log renders in Obsidian.

Follow the `teach` skill for every explanation, from a one-liner to a full lesson: probe, plan, teach. Write in German, in full sentences and normal prose. Terse or compressed modes do not apply in this project. Use LaTeX for all math. Prefer the `quiz` tool for anything with a right answer and `AskUserQuestion` for anything without one.

You still have file and shell tools; use them for reading lecture material, linking the log and running the render scripts, not for writing software unless the lesson is about code.
```

- [ ] **Step 4: Validate and commit**

Run: `claude plugin validate .`
```bash
git add skills/teach skills/visualize output-styles && git commit -m "Add teach and visualize skills and output style"
```

---

### Task 12: Project init, README, install and end-to-end check

**Files:**
- Create: `bin/learn-init`
- Modify: `README.md`
- Test: `test/bin/init.test.ts`

- [ ] **Step 1: Failing test**

`test/bin/init.test.ts`:
```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const INIT = fileURLToPath(new URL("../../bin/learn-init", import.meta.url));

test("learn-init creates settings, CLAUDE.md with sources, lessons and viz", () => {
  const dir = mkdtempSync(join(tmpdir(), "learn-init-"));
  writeFileSync(join(dir, "Skript.pdf"), "");
  writeFileSync(join(dir, "CLAUDE.md"), "keep me");
  execFileSync(INIT, [dir], { encoding: "utf8" });
  const settings = JSON.parse(readFileSync(join(dir, ".claude", "settings.json"), "utf8"));
  assert.equal(settings.enabledPlugins["learn@learn-local"], true);
  assert.deepEqual(settings.sandbox.excludedCommands, ["render-mermaid *"]);
  assert.equal(readFileSync(join(dir, "CLAUDE.md"), "utf8"), "keep me");
  assert.ok(existsSync(join(dir, "lessons", ".gitkeep")) && existsSync(join(dir, "viz", ".gitkeep")));
  const dir2 = mkdtempSync(join(tmpdir(), "learn-init-"));
  writeFileSync(join(dir2, "Skript.pdf"), "");
  execFileSync(INIT, [dir2], { encoding: "utf8" });
  const claude = readFileSync(join(dir2, "CLAUDE.md"), "utf8");
  assert.match(claude, /Skript\.pdf/);
  assert.match(claude, /normal mode/i);
});
```

- [ ] **Step 2: Implement bin/learn-init**

```bash
#!/usr/bin/env bash
set -euo pipefail
dir=$(readlink -f "${1:-.}")
plugin_root=$(readlink -f "$(dirname "$(readlink -f "$0")")/..")
mkdir -p "$dir/.claude" "$dir/lessons" "$dir/viz"
touch "$dir/lessons/.gitkeep" "$dir/viz/.gitkeep"

settings=$dir/.claude/settings.json
if [ ! -f "$settings" ]; then
  cat > "$settings" <<EOF
{
  "extraKnownMarketplaces": {
    "learn-local": { "source": { "source": "directory", "path": "$plugin_root" } }
  },
  "enabledPlugins": { "learn@learn-local": true },
  "sandbox": { "excludedCommands": ["render-mermaid *"] }
}
EOF
  echo "wrote $settings"
else
  echo "kept existing $settings (ensure enabledPlugins learn@learn-local and sandbox.excludedCommands render-mermaid *)"
fi

claude_md=$dir/CLAUDE.md
if [ ! -f "$claude_md" ]; then
  {
    echo "# Learning vault"
    echo
    echo "This directory is an Obsidian vault for learning, not a software project. Normal mode: full sentences, German, the \`teach\` skill applies to every explanation. Caveman or terse modes are off here."
    echo
    echo "## Lecture material (primary sources for the researcher)"
    echo
    find "$dir" -maxdepth 1 \( -name '*.pdf' -o -name '*.md' \) ! -name CLAUDE.md -printf '- %f\n' | sort
    echo
    echo "## Layout"
    echo
    echo "- \`lessons/\`: one markdown log per session, linked with \`/learn:md-log lessons/<date>-<topic>.md\`"
    echo "- \`viz/\`: published diagrams, embedded as \`![[viz-...png|500]]\`"
  } > "$claude_md"
  echo "wrote $claude_md"
else
  echo "kept existing $claude_md"
fi
```

- [ ] **Step 3: Run tests**

Run: `chmod +x bin/learn-init && npm test`
Expected: PASS.

- [ ] **Step 4: README**

Replace `README.md` with:

```markdown
# learn

Claude Code port of [amosblomqvist/learn](https://github.com/amosblomqvist/learn): a teaching system built on two principles (unconditional truths first, "how could I have discovered this") and a probe → plan → teach loop.

## What is in it

- `skills/teach`: the philosophy and the process
- `skills/visualize`: one correct, minimal diagram per idea, verified by the maker before you see it
- `skills/md-log`, `skills/md-unlog`: mirror the session into a markdown file for Obsidian
- `src/quiz`: MCP server with the `quiz` tool. Graded in the server, dialog via MCP elicitation
- `src/mdlog`: hook-driven transcript renderer
- `bin/render-mermaid`, `bin/render-svg`: render scripts for the maker agents
- `agents/`: `researcher`, `mermaid-maker`, `svg-maker`
- `output-styles/learn.md`: replaces the coding system prompt while the plugin is enabled

## Requirements

- Claude Code ≥ 2.1.290, Node ≥ 22.18 on PATH (runs `.ts` directly)
- `rsvg-convert` (librsvg) for SVG, `mmdc` for Mermaid: `nix profile install nixpkgs#mermaid-cli nixpkgs#librsvg`
- Obsidian, with the learning directory opened as a vault

## Install

```bash
git clone <this repo> ~/code/learn
cd ~/code/learn && npm install
claude plugin marketplace add ~/code/learn
claude plugin install learn@learn-local
```

## Set up a learning project

```bash
~/code/learn/bin/learn-init ~/Documents/Uni/Algo\ Mathe
```

This writes `.claude/settings.json` (enables the plugin, lets `render-mermaid` run outside the bash sandbox because Chromium needs sockets), a `CLAUDE.md` listing the lecture material, and `lessons/`, `viz/`.

## Use

```
cd ~/Documents/Uni/Algo\ Mathe
claude
/learn:md-log lessons/2026-10-11-grenzwerte.md
Erklär mir Grenzwerte von Folgen.
```

Open the vault in Obsidian and read the lesson there; answer quizzes in the terminal (`→` opens the option list).

## Development

`npm test`, `npm run typecheck`, `claude plugin validate .`. `nix develop` gives a shell with node, mermaid-cli and librsvg.
```

- [ ] **Step 5: Install the plugin and tools**

Run (outside the bash sandbox where nix needs its daemon socket):
```bash
nix profile install nixpkgs#mermaid-cli nixpkgs#librsvg
claude plugin marketplace add ~/code/learn
claude plugin install learn@learn-local
~/code/learn/bin/learn-init "/home/dan/Documents/Uni/Algo Mathe"
```
Expected: no errors; `claude plugin list` shows `learn`. If `marketplace add` rejects the root-level plugin, create `plugins/learn` as a symlink to `.` and set the marketplace source to `./plugins/learn`.

- [ ] **Step 6: Commit**

```bash
git add bin/learn-init README.md test/bin/init.test.ts && git commit -m "Add project init script and README"
```

- [ ] **Step 7: End-to-end check (manual, in a second terminal)**

In `~/Documents/Uni/Algo Mathe`: `claude`, then
1. `/learn:md-log lessons/test.md` → reply names the file.
2. "Stell mir eine Quizfrage zu Grenzwerten." → elicitation dialog appears, options numbered, `Ich weiß es nicht` last; after answering, ✓/✗ with explanation.
3. Open `lessons/test.md`: user line, assistant text, question callout **before** the result callout, no explanation inside the question callout.
4. "Zeichne mir einen Abhängigkeitsgraphen mit 3 Knoten." → `viz/viz-*.png` exists, embed appears in the log, Obsidian renders it.
5. Confirm `/sandbox` shows `render-mermaid *` excluded; if the maker's render fails with a socket error, set `sandbox.enabled: false` in the project settings as the documented fallback.

Record what failed in `docs/superpowers/plans/` as follow-up items, fix in place where small.
