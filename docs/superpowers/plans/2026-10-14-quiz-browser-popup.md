# Quiz im Browser statt im Terminal-Formular

## Problem

Claude Code 2.1.295 rendert MCP-Elicitation mit festen Grenzen: Die `message` hat höchstens 4 Zeilen (`z2+1` im Bundle), jeder Select-Eintrag eine Zeile. Lange Optionen und Fragen werden abgeschnitten, LaTeX wird nicht gerendert.

## Lösung

Der Quiz-Server zeigt die Frage in einer lokalen Browserseite mit KaTeX. Der Tool-Call wartet, bis die Seite eine Antwort schickt.

- `src/quiz/popup.ts`: HTTP-Server auf `127.0.0.1`, zufälliger Port, startet beim ersten Quiz. Pro Quiz ein zufälliges Token im Pfad (`/q/<token>`).
  - `GET /q/<token>`: HTML-Seite. Die Quizdaten stehen als JSON im Script-Tag und landen per `textContent` im DOM, KaTeX `auto-render` rendert `$...$` und `$$...$$`.
  - `POST /q/<token>`: `{ answers: string[], note?: string }` oder `{ cancel: true }`. Der Server bewertet und antwortet mit Ergebnis und Erklärung, die Seite zeigt beides.
  - `GET /katex/*`: Dateien aus `node_modules/katex/dist`.
- Öffnen per `xdg-open <url>`, überschreibbar mit `LEARN_QUIZ_OPENER`. Fehlt `node_modules/katex` oder startet der Opener nicht, fällt der Server auf das Terminal-Formular zurück.
- `notifications/cancelled` (Esc in Claude Code) beendet ein offenes Quiz als `cancelled`, die Seite meldet das beim Absenden.
- Das Log rendert weiter aus dem Tool-Input, keine Änderung an `mdlog`.

## Tests

`test/quiz/server.test.ts`: Server mit dem Opener-Skript `test/fixtures/answer-quiz.mjs` starten, das die Seite abruft und eine Antwort postet. Geprüft werden Seite, KaTeX-Auslieferung, Bewertung, Tool-Ergebnis, `cancel` und ein zweiter POST (410).
