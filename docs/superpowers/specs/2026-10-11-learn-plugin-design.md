# learn: Claude Code port of amosblomqvist/learn

## Goal

Port the pi learning system (https://github.com/amosblomqvist/learn) to a Claude Code plugin. The original repo is the functional spec. Where Claude Code offers a native equivalent, use it. Where it does not (graded quiz, markdown log), build the smallest faithful replacement.

First learning project: `~/Documents/Uni/Algo Mathe` (Algorithmische Mathematik). Later projects: other university math and CS subjects. Teaching language: German. Skill and agent texts stay English.

## Non-goals

- Headless (`claude -p`) support. The system is interactive.
- Changing the pedagogy. The `teach` skill keeps its content, only tool names, language and addressee change.
- A generic quiz framework. One tool, one UI, the original's semantics.

## Mapping

| Original | Port |
|---|---|
| `skills/teach`, `skills/visualize` | plugin skills, adapted |
| `extensions/ask-user-question.ts` | built-in `AskUserQuestion` |
| `extensions/quiz.ts` | MCP server `quiz` with form elicitation, grading in the server |
| `extensions/md-log.ts` | hook-driven transcript renderer plus `/learn:md-log` skill |
| `extensions/visual-tools` | `bin/render-mermaid`, `bin/render-svg` |
| `agents/*` | plugin subagents |
| `.pi` directory per project | plugin enabled per project via `.claude/settings.json` |

## Verified facts (2026-10-11)

- Claude Code 2.1.295 handles MCP form elicitation by default. Spike confirmed: `string` + `enum` renders as a select (expand with `→`), `array` with `items.enum` renders as multi-select, plain `string` renders as free text. The server receives `{action: "accept", content: {...}}` with the enum values.
- The bundle reads `enumNames` for single-select titles and `items.enum`/`items.anyOf` for multi-select.
- Hooks receive `session_id`, `transcript_path`, `cwd`; `PreToolUse`/`PostToolUse` receive `tool_name`, `tool_input`, `tool_response` and fire for MCP tools. Plugin MCP tools are named `mcp__plugin_learn_quiz__quiz`.
- Plugins bundle skills, agents, hooks, `.mcp.json`, `output-styles/`, `bin/` (on PATH of the Bash tool). `${CLAUDE_PLUGIN_ROOT}` works in `.mcp.json`. `${CLAUDE_PLUGIN_DATA}` exists only for hook, MCP and LSP processes, not for Bash, so the log state lives in an XDG directory instead.
- `sandbox.excludedCommands` is settable in project `.claude/settings.json`, runs the matching command unsandboxed, and applies to subagents (same process, same sandbox config).
- `Read` on a PNG returns the image, so a subagent can inspect its render.
- `mmdc` from nixpkgs `mermaid-cli` renders fine outside the Bash sandbox. Inside the sandbox Chromium fails (`socket() failed: Operation not permitted`). `rsvg-convert` works inside the sandbox.
- LaTeX never renders in the terminal. The log in Obsidian is the reading surface, as in the original.

## Repository layout

```
learn/
  .claude-plugin/plugin.json
  .claude-plugin/marketplace.json
  .mcp.json
  hooks/hooks.json
  skills/teach/SKILL.md
  skills/visualize/SKILL.md
  skills/md-log/SKILL.md
  agents/researcher.md
  agents/mermaid-maker.md
  agents/svg-maker.md
  output-styles/learn.md
  bin/render-mermaid
  bin/render-svg
  bin/learn-init
  src/quiz/server.ts
  src/quiz/grade.ts
  src/quiz/plainmath.ts
  src/mdlog/cli.ts
  src/mdlog/transcript.ts
  src/mdlog/render.ts
  src/mdlog/state.ts
  test/**/*.test.ts
  test/fixtures/transcript.jsonl
  package.json
  tsconfig.json
  flake.nix
  README.md
  docs/superpowers/specs/
```

Runtime: Node 25 runs `.ts` files directly (type stripping), so there is no build step. No runtime dependencies: the quiz server speaks JSON-RPC over stdio directly (about 150 lines, verified in the spike). Dev: `typescript`, `@types/node` for `tsc --noEmit`. Tests: `node --test`. The flake provides `nodejs`, `mermaid-cli`, `librsvg` for development and for `nix profile install`.

Plugin name: `learn`. Marketplace `learn-local` points at the repo directory, so edits apply on the next session without reinstall.

## Quiz MCP server

`src/quiz/server.ts`, stdio, registered in `.mcp.json` as `quiz`:

```json
{ "mcpServers": { "quiz": { "command": "node", "args": ["${CLAUDE_PLUGIN_ROOT}/src/quiz/server.ts"] } } }
```

Tool `quiz`, input schema identical to the original:

| Field | Type | Notes |
|---|---|---|
| `question` | string | required, one question per call |
| `details` | string? | shown under the question |
| `options` | `{label, value?, description?}[]` | min 2, `value` defaults to trimmed label, duplicates by value dropped |
| `multiSelect` | boolean? | user must select the exact set |
| `correctAnswer` | string or string[] | option values, required |
| `explanation` | string | required, revealed after answering |
| `shuffle` | boolean? | default true |

Tool description carries the original's guidance: options only, reference the correct answer by value, keep options even, write LaTeX in questions.

Flow per call:

1. Normalize options (`grade.ts`: `normalizeOptions`). Reject with an error result if fewer than 2 remain or `correctAnswer` references an unknown value.
2. Display order: shuffle unless `shuffle === false`. The shuffle is deterministic (seeded from a hash of question and option values), so the log hook computes the same numbering from `tool_input` without talking to the server. Append the fixed option `Ich weiß es nicht` (value `__dont_know__`) last with index 0. It never shuffles and never counts as correct or wrong.
3. Elicitation request, `mode: "form"`:
   - `message`: question in plain-math form (`plainmath.ts`) plus `details` on a new line.
   - single-select: property `answer`, `type: string`, `oneOf` = `{const: value, title: "<n>. <label>"}` in display order plus `Ich weiß es nicht`, `required`. (Verified in the spike; Claude Code's validator rejects `items` without `type`.)
   - multi-select: property `answer`, `type: array`, `items: {type: "string", enum: ["<n>. <label>", ...]}`; the server maps titles back to values. `Ich weiß es nicht` is a selectable entry.
   - property `note`, `type: string`, optional, title `Notiz (optional)`.
   - Each description includes the hint `→ öffnet die Liste` because the control is not self-explanatory.
4. Grade in the server (`grade.ts`: `grade`): single-select correct when the chosen value equals `correctAnswer`; multi-select correct when the chosen set equals the correct set. If the selection contains `__dont_know__`, the result is `dontKnow: true`, `correct: undefined`. Decline or cancel yields `status: "cancelled"`.
5. Return `content` with two text blocks (human-readable result, then `<!--learn-quiz {json}-->` for the log renderer). No `structuredContent`: Claude Code 2.1.295 replaces the content blocks with the structured JSON when it is present, which drops the readable text and the marker (observed in the headless end-to-end run). The renderer also accepts a bare JSON result for robustness.

Text result formats (German):

```
✓ Richtig: <label>
Erklärung: <explanation>
Notiz: <note>
```
```
✗ Falsch: <chosen labels>
Richtig wäre: <correct labels>
Erklärung: <explanation>
```
```
Weiß nicht.
Richtig wäre: <correct labels>
Erklärung: <explanation>
```

`structuredContent`:

```ts
{
  status: "answered" | "cancelled",
  question: string, details?: string,
  mode: "single-select" | "multi-select",
  options: { index: number, label: string, value: string }[],  // display order, 1-based
  answers: { index: number, label: string, value: string }[],
  correctIndices: number[],
  correct?: boolean, dontKnow?: boolean,
  note?: string, explanation: string
}
```

`plainmath.ts` is a best-effort rewrite for the terminal only: strip `$`/`$$`, `\frac{a}{b}` to `(a)/(b)`, `\sqrt{x}` to `sqrt(x)`, `\to` to `→`, `\infty` to `∞`, `\le`/`\ge`/`\ne` to `≤ ≥ ≠`, `\cdot` to `·`, `^{...}` and `_{...}` keep braces content with `^`/`_`, Greek letters by name to Unicode, remaining backslash commands keep their name without the backslash. The log receives the untouched LaTeX.

## md-log

`src/mdlog/cli.ts` with subcommands `link <file>`, `unlink`, `sync`. All read the hook JSON from stdin (hooks) or take `--session <id> --transcript <path>` (skill invocation via Bash).

State: `${XDG_STATE_HOME:-~/.local/state}/learn/mdlog/<session_id>.json` as `{ logFile: string, cursor: number }`. Hooks and the skill's Bash call resolve the same path. `cursor` is the byte offset into the transcript already rendered. Without a state file every subcommand except `link` exits 0 immediately.

`hooks/hooks.json`:

| Event | Matcher | Command |
|---|---|---|
| `UserPromptSubmit` | | `node ${CLAUDE_PLUGIN_ROOT}/src/mdlog/cli.ts sync` |
| `PreToolUse` | `mcp__plugin_learn_quiz__quiz\|AskUserQuestion` | same |
| `PostToolUse` | same | same |
| `Stop` | | same |

Timeout 10 s each. Any failure logs to stderr and exits 0, so the session never blocks on the log.

`sync`: open the transcript at `cursor`, parse complete lines (`transcript.ts`), render new blocks (`render.ts`), append to `logFile`, store the new cursor. A trailing partial line is not consumed.

`transcript.ts` parses the JSONL defensively: keep entries with `type` `user` or `assistant` that carry `message.content`; skip `isSidechain`, `isMeta`, and unknown types. Output a flat list of events: `user_text`, `assistant_text`, `tool_use {id, name, input}`, `tool_result {tool_use_id, content, structured}`. Tool results from the quiz server are read from the `tool_result` block; when `structuredContent` is absent, fall back to parsing the text.

`render.ts` mirrors the original callouts:

- user: `> [!user]` with the text, skill expansions (`<command-message>`, `<command-name>`, system reminders) stripped.
- assistant: text verbatim, concatenated text blocks separated by blank lines. Tool calls other than quiz and AskUserQuestion produce nothing.
- `tool_use` of quiz: `> [!question] Quiz` with the question, details, numbered options in **display order**. Display order comes from the matching `tool_result.structuredContent.options` when already present, otherwise from `tool_input.options` in given order. Never `correctAnswer`, never `explanation`.
- `tool_use` of AskUserQuestion: `> [!question] Frage` with each question and its options.
- `tool_result` of quiz: `> [!success] ✓ Richtig` / `> [!failure] ✗ Falsch` / `> [!info] Weiß nicht`, chosen answers, correct answers, explanation, note.
- `tool_result` of AskUserQuestion: `> [!info] Antwort` with the chosen answers.

Question blocks for a quiz are rendered at `PreToolUse` time when the `tool_use` is already in the transcript. If the transcript lags, the first `sync` that sees the `tool_use` renders the question; this keeps ordering correct at the cost of the question appearing only after the answer in that case. The plan's first task measures which case holds.

`/learn:md-log <file>` skill: runs `cli.ts link <file>` with the current session id and transcript path (the skill reads them from `$CLAUDE_SESSION_ID`, falling back to the newest transcript for the cwd), creates the file when missing, sets cursor 0 and runs `sync` to backfill. `/learn:md-unlog` deletes the state file.

## Visuals

`bin/render-mermaid <source.mmd> [--save-as <slug>]` and `bin/render-svg <source.svg> [--save-as <slug>]`, bash scripts:

- Preview: render to `$TMPDIR/learn-viz/<pid>/preview.png`, print `preview: <path>`.
- `--save-as`: additionally copy to `<cwd>/viz/viz-<slug>-<unix-ms>.png`, print `filename: <name>` and `path: <abs path>`.
- Mermaid: `mmdc -i src -o out -b white -s 2 -p <puppeteer.json>` with `{"args": ["--no-sandbox", "--disable-gpu"]}`. `mmdc` resolved from PATH, then `~/.nix-profile/bin/mmdc`. Missing binary prints an install hint and exits 2.
- SVG: `rsvg-convert -z 2 -b white -o out src`; fallback `magick src out`.
- Mermaid rendering needs the Bash sandbox lifted for this command. `learn-init` writes `sandbox.excludedCommands: ["render-mermaid *"]` into the project settings. If Claude Code does not honor the setting for subagents, the fallback is `sandbox.enabled: false` in the learning project (documented in README, not the default).

Maker agents (`agents/mermaid-maker.md`, `agents/svg-maker.md`): `tools: Read, Write, Edit, Bash(render-mermaid:*)` (or `render-svg`), `model: sonnet`. Prompt text from the original with the tool names replaced: write the source to `$TMPDIR/learn-viz/<slug>.mmd` with `Write`, change it with `Edit`, render with the bin script, inspect the PNG with `Read`, iterate, publish with `--save-as`, finish with the `RESULT:` block.

`skills/visualize/SKILL.md`: original text, invocation replaced by `Agent(subagent_type: "learn:mermaid-maker", prompt: <brief>)`.

The plan DAG of teach phase 2 stays a fenced `mermaid` block in chat, Obsidian renders it.

## Researcher

`agents/researcher.md`: `tools: WebSearch, WebFetch, Read, Grep, Glob`, `model: sonnet`. Prompt from the original plus one rule: when the task names local sources (paths to lecture notes or PDFs), read them first and cite them as `[Skript, S. n]`; web sources fill gaps and verify.

## Skills

`skills/teach/SKILL.md`: original text with these edits only:

- Addressee: "the learner" / "du" instead of "him".
- Tool names: `quiz` (MCP tool), `AskUserQuestion`, researcher via `Agent(subagent_type: "learn:researcher")`.
- Language: teach in German by default; use the lecture's terminology, English term in parentheses on first use when it helps. Everything else (LaTeX, process, quiz construction) unchanged.
- Sources: if the project `CLAUDE.md` lists lecture material, the phase 2 researcher brief includes those paths.

`output-styles/learn.md`: `keep-coding-instructions: false`, `force-for-plugin: true`. Body: "You are a teacher for university mathematics and computer science. Follow the `teach` skill for every explanation. Write in German. Normal prose, full sentences, no terse mode."

## Learning project setup

`bin/learn-init [dir]` creates, without overwriting existing files:

- `.claude/settings.json`: `enabledPlugins: {"learn@learn-local": true}`, `outputStyle: "learn"`, `sandbox.excludedCommands: ["render-mermaid *"]`.
- `CLAUDE.md`: project is a learning vault, normal mode (no caveman), list of source files found in the directory (`*.pdf`, `*.md`) as lecture material, log directory `lessons/`.
- `lessons/`, `viz/` with `.gitkeep`.

The user opens the directory as an Obsidian vault. A session starts with `claude`, then `/learn:md-log lessons/<date>-<topic>.md`, then the topic.

## Error handling

- Quiz: invalid input returns an `isError` tool result with the reason, no elicitation. Elicitation decline or cancel returns `status: cancelled` and tells Claude to continue without a grade.
- md-log: never fails the hook. Unparseable lines are skipped. A missing transcript ends the sync silently.
- Render scripts: non-zero exit with the renderer's stderr, so the maker can fix the source.

## Testing

- `node --test` units: `normalizeOptions`, `grade` (single, multi, dontKnow, cancelled), `plainmath`, transcript parsing against `test/fixtures/transcript.jsonl` (captured from a real session, secrets scrubbed), `render` snapshot per block type, cursor handling (partial trailing line, repeated sync is idempotent).
- Protocol test: spawn `server.ts`, run `initialize`, `tools/list`, `tools/call`; answer the `elicitation/create` request from the test and assert the result and `structuredContent`.
- Script smoke tests: `render-svg` on a fixture, `render-mermaid` when `mmdc` exists (skipped otherwise).
- `claude plugin validate .`
- Manual end to end in the Algo Mathe project: one session with probe, plan, teach, one visual, log open in Obsidian.
