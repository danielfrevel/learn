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

Open the vault in Obsidian and read the lesson there; answer quizzes in the terminal (`→` opens the option list).

## Development

`npm test`, `npm run typecheck`, `claude plugin validate .`. `nix develop` gives a shell with node, mermaid-cli and librsvg.
