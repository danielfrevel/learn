# learn

Claude Code port of [amosblomqvist/learn](https://github.com/amosblomqvist/learn) by Amos Blomqvist: a teaching system built on two principles (unconditional truths first, "how could I have discovered this") and a probe → plan → teach loop. The teaching philosophy, the quiz semantics and the log format come from the original, which was built as a [pi](https://github.com/earendil-works/pi) configuration. This repo replaces the pi extensions with Claude Code plugin parts: an MCP server for the quiz, hooks for the log, bash scripts and subagents for the visuals. The `teach` skill is a close copy of the original text, adapted to Claude Code tool names and German teaching language.

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
- `rsvg-convert` (librsvg) for SVG, `mmdc` for Mermaid: `nix profile add nixpkgs#mermaid-cli nixpkgs#librsvg`
- Obsidian, with the learning directory opened as a vault

## Install

```bash
git clone <this repo> ~/code/learn
cd ~/code/learn && npm install
claude plugin marketplace add ~/code/learn
claude plugin install learn@learn-local
```

Inside Claude Code the same install is `/plugin install learn --marketplace learn-local`.

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

Open the vault in Obsidian and read the lesson there. A quiz opens in the browser with rendered LaTeX; the terminal waits for the answer. `LEARN_QUIZ_OPENER` replaces `xdg-open`. If no browser starts, the quiz falls back to the terminal form, where Claude Code cuts each option to one line.

## Development

`npm test`, `npm run typecheck`, `claude plugin validate .`. `nix develop` gives a shell with node, mermaid-cli and librsvg.

## Open todos

- `learn-init` lists only top-level `*.pdf` and `*.md` as lecture material. PDFs in subfolders go into `CLAUDE.md` by hand.
- The output style relies on `force-for-plugin`. If a session answers in terse mode, run `/output-style learn`.
- Maker agents have unrestricted `Bash`; only the prompt limits them to `render-mermaid` / `render-svg`.
- `learn-mdlog link` derives the transcript path from cwd and session id. Hooks correct it on the first sync, so a wrong guess only costs the backfill.
- The quiz tool name appears in `hooks/hooks.json`, `src/mdlog/render.ts` and `src/quiz/server.ts`. Renaming the MCP server means editing all three.
- `render-mermaid` needs Chromium sockets. Inside the Claude Code bash sandbox it only works through `sandbox.excludedCommands`, which `learn-init` writes. If it still fails, set `"sandbox": {"enabled": false}` in the learning project.
- Multi-select elicitation and the `AskUserQuestion` log callouts were verified by tests and the headless run, not yet in a full interactive lesson.
- No `ask_user_question` popup replacement: Claude Code's built-in `AskUserQuestion` is limited to 4 options per question.
