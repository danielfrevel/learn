# Lektionsseite im Browser: Tabs, Prosa, Rückmeldung

## Absicht

Heute öffnet jeder Quiz-Aufruf einen eigenen Browser-Tab, zeigt die Auflösung und schickt den Lernenden mit "Zurück zum Terminal" weg. Die eigentliche Lehre, also Herleitungen, Definitionen, Überleitungen, steht im Terminal ohne LaTeX. Der Obsidian-Log, der das rendern sollte, entsteht nur nach einem manuellen `/learn:md-log`, den der Lernende nie ausgeführt hat. Außerdem geht der Teacher nach einer einzigen richtigen Antwort zum nächsten Thema weiter.

Ziel: Eine Browserseite pro Session wird die einzige Lesefläche. Alles, was der Teacher dem Lernenden zeigt, kommt als neuer Tab auf diese Seite: Fragen, Text, Bilder. Jeder Tab endet mit einer Rückmeldung des Lernenden (Verständnis 1 bis 5, optionale Notiz), und der Teacher entscheidet daraus, wie es weitergeht. Das Terminal bleibt Eingabe für freie Fragen und zeigt nur noch Einzeiler.

## Ziele

- Ein Browser-Tab pro Claude-Code-Session. Der erste Inhalt öffnet ihn, jeder weitere Inhalt erscheint ohne neues Fenster als In-Page-Tab.
- Tab-Leiste mit Pfeilen links und rechts, Pfeiltasten auf der Tastatur ebenso. Ein neuer Tab springt automatisch in den Vordergrund. Alte Tabs bleiben lesbar, mit Antwort, Auflösung und abgegebener Rückmeldung.
- Zwei Tab-Arten:
  - Frage-Tab: Prosa-Block oben (Markdown mit LaTeX, darf sich auf die vorige Frage beziehen), darunter die Frage wie heute. Nach der Antwort: Bewertung, richtige Antwort, Erklärung, dann der Rückmeldeblock.
  - Text-Tab: Prosa-Block (Markdown mit LaTeX), optional ein Bild aus `viz/`, dann der Rückmeldeblock.
- Rückmeldeblock, in jedem Tab gleich: "Wie gut verstehst du das?" mit 1 bis 5, Textfeld "Was würde dir helfen? (optional)", Button "Weiter". Erst "Weiter" beendet den Tool-Aufruf und gibt die Kontrolle ans Terminal.
- Das Tool-Ergebnis für den Teacher enthält bei Frage-Tabs Ausgang (richtig, falsch, weiß nicht), gewählte Antwort, Rating und Notiz. Bei Text-Tabs Rating und Notiz.
- LaTeX und Markdown rendern auf der Seite. Inline `$...$`, Display `$$...$$`.
- Mehr Beispiele pro Konzept. Der Teacher entscheidet nach jedem Tab aus Rating, Notiz und der Tiefe, die er in diesem Thema schon erreicht hat, ob er eine weitere Aufgabe, eine Visualisierung, mehr Text oder den nächsten Knoten bringt. Keine feste Zahl, keine harte Schwelle am Rating. Ist er unsicher, fragt er im Terminal per `AskUserQuestion`, wie es weitergehen soll.
- Erklärungen nie im Terminal. Die Antwort des Teachers im Terminal ist ein Einzeiler ("Weiter im Browser." oder ähnlich), der Inhalt steht im Tab.

## Nicht-Ziele

- Freitext-Antworten auf Fragen. Fragen bleiben Multiple Choice, bewertet im Server.
- Tabs nachträglich ändern, löschen oder neu beantworten. Ein abgeschlossener Tab ist eingefroren.
- Obsidian-Log ersetzen oder automatisch verlinken. `mdlog` bleibt, wie es ist, und rendert zusätzlich die neuen Inhalte. Die README nennt deutlich, dass `/learn:md-log` pro Session manuell läuft.
- Persistenz über die Session hinaus. Schließt der Lernende den Browser-Tab und öffnet die URL neu, sieht er die bisherigen Tabs der laufenden Session. Endet der MCP-Server, ist die Seite weg.
- Mehrere Lernende, Netzwerkzugriff, Auth jenseits des heutigen Tokens und der Host-Prüfung.
- Ein Ersatz für `AskUserQuestion`. Richtungsfragen bleiben im Terminal.

## Anti-Ziele

- Ein Tab, der nicht blockiert. Wenn der Teacher nach einem Text-Tab sofort den nächsten Tab schiebt, ohne auf "Weiter" zu warten, ist die Rückmeldung wertlos. Jeder Tool-Aufruf wartet auf "Weiter".
- Prosa, die wegen eines Renderfehlers verschwindet. Kaputtes LaTeX wird als Quelltext angezeigt, nie unterdrückt (`throwOnError: false` wie heute).
- Ein Teacher, der weitergeht, weil die Antwort richtig war. Die Entscheidung muss sichtbar aus Rating, Notiz und Tiefe folgen.

## Rahmen

- Claude Code Plugin, MCP-Server in `src/quiz/`, Node 22 mit direktem `.ts`-Start. Keine Build-Stufe.
- Der Browser lädt Assets nur vom lokalen Server (`127.0.0.1`, Host-Prüfung bleibt). Keine CDN-Abhängigkeit.
- Terminal-Fallback bleibt: Lädt innerhalb des Timeouts niemand die Seite, läuft ein Frage-Tab wie heute als Elicitation im Terminal, ein Text-Tab gibt seinen Inhalt als Tool-Ergebnis zurück und der Teacher zeigt ihn im Terminal.
- Esc in Claude Code (`notifications/cancelled`) beendet den wartenden Tab, der Tab zeigt das an und wird eingefroren.
- Geschlossener Browser-Tab: Hängt beim Tool-Aufruf kein Client an der Ereignisverbindung, startet der Server den Opener mit der Session-URL erneut. Lädt dann innerhalb des Timeouts niemand die Seite, läuft nur dieser Aufruf im Terminal-Fallback. Der nächste Aufruf versucht es wieder.
- Tests wie heute: `node --test`, Opener-Skript in `test/fixtures/`, das die Seite abruft und Antworten postet. Typecheck mit `tsc`.

## Entschiedene Teile

### Tools

Zwei MCP-Tools im selben Server. Das heutige `quiz` bleibt, Name und Schema erweitert um `intro`. Neu: `show`.

`quiz`:
- `intro` (string, optional): Markdown mit LaTeX, steht als Prosa-Block über der Frage. Auflösung der vorigen Frage, Herleitung, Überleitung. Fehlt `intro`, hat der Tab keinen Prosa-Block.
- Alles andere wie heute: `question`, `details`, `options`, `multiSelect`, `correctAnswer`, `explanation`, `shuffle`.
- Ergebnis: heutiger Text (✓/✗, richtig wäre, Erklärung, Notiz zur Antwort), plus zwei Zeilen `Verständnis: n/5` und `Hilft mir: <Text>` wenn ausgefüllt. Der Marker-Block (`encodeResult`) trägt `rating` und `feedback` als neue Felder.

`show`:
- `title` (string): kurzer Tab-Titel.
- `body` (string): Markdown mit LaTeX.
- `image` (string, optional): Dateiname einer PNG in `viz/` des Lernprojekts, kein Pfad. Die Seite zeigt es unter dem Text.
- Ergebnis: `Verständnis: n/5` und `Hilft mir: <Text>` wenn ausgefüllt, plus Marker-Block für `mdlog`.

Beide Tools blockieren bis "Weiter", "Abbrechen" oder Esc.

### Seite

- Eine Session-URL `/s/<token>` pro Serverprozess, Token wie heute zufällig. Der Server öffnet sie beim ersten Tool-Aufruf per `xdg-open` bzw. `LEARN_QUIZ_OPENER`. Weitere Aufrufe öffnen nichts, sie schieben nur nach.
- Die Seite hält eine Verbindung zum Server (Server-Sent Events, Pfad `/s/<token>/events`) und bekommt neue Tabs als Ereignis. Bei Verbindungsabbruch verbindet sie neu und holt den Stand per `GET /s/<token>/state`.
- Ein Tab-Objekt: `id`, `kind` (`quiz` oder `show`), Inhalt, Status (`open`, `answered`, `done`, `cancelled`), nach Abschluss Ergebnis, Rating, Notiz.
- Frage-Tab: `POST /s/<token>/tabs/<id>/answer` mit `{answers, note}` bewertet und liefert Ausgang, richtige Werte, Erklärung. Die Seite markiert die Optionen wie heute. Dann `POST .../finish` mit `{rating, feedback}` schließt den Tab und löst den Tool-Aufruf auf. `{cancel: true}` auf einem der beiden Pfade bricht ab.
- Text-Tab: nur `.../finish`.
- Rating ist Pflicht für "Weiter", Notiz optional. "Abbrechen" ohne Rating bleibt möglich.
- Abbruch nach der Bewertung (Button oder Esc auf einem beantworteten Tab) behält die Bewertung. Ausgang und Antwort stehen im Tool-Ergebnis, Rating und Notiz fehlen, der Tab friert mit Hinweis "abgebrochen" ein. Nur ein Abbruch vor der Antwort ergibt wie heute den Ausgang `cancelled`. `cancelled` als Tab-Status ist damit ein Flag neben dem Ausgang, nicht ein Ausgang.
- Tab-Leiste oben: Pfeil links, Titel des aktiven Tabs mit Position ("3 / 7"), Pfeil rechts. Titel eines Frage-Tabs ist der Fragetext, gekürzt. Tastatur: Pfeil links und rechts, wenn kein Eingabefeld den Fokus hat. Ein neuer Tab wird aktiv und scrollt nach oben.
- Markdown rendert im Browser. Die Mathe-Abschnitte werden vor dem Markdown-Parser geschützt und danach durch KaTeX gerendert, damit `_` und `*` in Formeln nicht als Markdown gelesen werden. Markdown-Parser und KaTeX kommen aus `node_modules` und werden wie heute `/katex/*` vom Server ausgeliefert.
- Bilder: `GET /s/<token>/viz/<name>` liefert `viz/<name>` aus dem Projektverzeichnis des MCP-Servers (sein `cwd`). Nur Dateinamen ohne Pfadtrenner, nur `.png` und `.svg`.
- Optik bleibt auf dem heutigen Stand: System-Font, hell/dunkel nach System, schmale Spalte. Keine Framework-Abhängigkeit.

### Skill und Output-Style

`skills/teach/SKILL.md` und `output-styles/learn.md` ändern sich so:
- Jede Erklärung, Herleitung, Definition, Zusammenfassung geht durch `show` oder das `intro` eines `quiz`. Die Terminal-Antwort ist ein Einzeiler.
- Nach jedem Tab entscheidet der Teacher aus Rating, Notiz und erreichter Tiefe. Er bringt zu jedem Knoten mehrere Beispiele mit anderer Oberfläche (andere Zahlen, andere Formulierung, Umkehrung), auch wenn die erste Antwort richtig war. Eine richtige Antwort allein ist kein Grund weiterzugehen. Unsicher heißt `AskUserQuestion` im Terminal mit den Optionen weitere Aufgabe, Visualisierung, mehr Text, nächster Knoten.
- Die Notiz "Was würde dir helfen" hat Vorrang vor der eigenen Einschätzung des Teachers.
- Beim Abtasten in Phase 1 bleibt die Suche nach der Wissenskante wie heute: Eine richtige Antwort erlaubt den Sprung eine Stufe höher. Die Notiz des Lernenden zählt auch dort und kann den Sprung verhindern oder umlenken. Die Regel "richtig allein reicht nicht" gilt für Phase 3.
- Visualisierungen landen über `show` mit `image` auf der Seite, nicht mehr nur als `![[...]]` im Log. `skills/visualize/SKILL.md` ändert sich entsprechend: Der Maker liefert den Dateinamen, der Teacher gibt ihn an `show` weiter statt ihn selbst einzubetten.
- Der Plan aus Phase 2 (Prosa plus Abhängigkeits-DAG) geht ebenfalls durch `show`. Der DAG kommt als PNG über den `mermaid-maker`, kein Mermaid-Renderer auf der Seite. Die Freigabe des Plans bleibt eine Richtungsfrage und damit `AskUserQuestion` im Terminal.

### Log

- `hooks/hooks.json` matcht zusätzlich `mcp__plugin_learn_quiz__show`.
- `src/mdlog/render.ts` rendert `intro` über der Frage, `show` als Text-Block mit `![[viz/<name>]]`, Rating und Notiz unter dem Ergebnis.
- README: Abschnitt "Use" beschreibt die Seite als Lesefläche und nennt `/learn:md-log` als manuellen Schritt pro Session, wenn man zusätzlich eine Obsidian-Mitschrift will.

## Dem Builder überlassen

- Wahl des Markdown-Parsers (Kandidaten: `marked`, `markdown-it`) und wie Mathe vor dem Parser geschützt wird.
- Aufbau des Tab-Zustands im Server (Map pro Session, Reihenfolge).
- Ob die Seite Server-Sent Events oder Long-Polling nutzt, solange Neuverbindung und `state` funktionieren.
- Genaue Aufteilung von `popup.ts` in Server, Seite und Zustand. Die Datei ist heute schon Server plus HTML plus Skript in einem.
- Testaufbau für mehrere Tabs im Opener-Skript.
- Ob der Terminal-Fallback für `show` den Text als Tool-Ergebnis liefert oder einen zweiten Weg nimmt. Fallback ist Notlösung, nicht Zielzustand.
