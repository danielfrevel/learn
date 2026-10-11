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
