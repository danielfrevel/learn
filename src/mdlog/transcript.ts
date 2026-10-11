import { closeSync, fstatSync, openSync, readSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

export type Event =
  | { kind: "user_text"; text: string }
  | { kind: "assistant_text"; text: string }
  | { kind: "tool_use"; id: string; name: string; input: unknown }
  | { kind: "tool_result"; toolUseId: string; text: string; toolUseResult: unknown };

const isText = (b: any): b is { text: string } => b?.type === "text" && typeof b.text === "string";

const blocksOf = (content: unknown): any[] =>
  typeof content === "string" ? [{ type: "text", text: content }] : Array.isArray(content) ? content : [];

function eventsOf(entry: any): Event[] {
  if (!entry || entry.isSidechain || entry.isMeta || (entry.type !== "user" && entry.type !== "assistant")) return [];
  const textKind = entry.type === "user" ? "user_text" : "assistant_text";
  const out: Event[] = [];
  for (const b of blocksOf(entry.message?.content)) {
    if (isText(b)) {
      if (b.text.trim()) out.push({ kind: textKind, text: b.text });
    } else if (b?.type === "tool_use") {
      out.push({ kind: "tool_use", id: b.id, name: b.name, input: b.input });
    } else if (b?.type === "tool_result") {
      const text = blocksOf(b.content).filter(isText).map((t) => t.text).join("\n");
      out.push({ kind: "tool_result", toolUseId: b.tool_use_id, text, toolUseResult: entry.toolUseResult });
    }
  }
  return out;
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

export function readNewEntries(path: string, cursor: number): { events: Event[]; cursor: number } {
  let fd: number;
  try {
    fd = openSync(path, "r");
  } catch {
    return { events: [], cursor };
  }
  try {
    const size = fstatSync(fd).size;
    if (size <= cursor) return { events: [], cursor };
    const tail = Buffer.alloc(size - cursor);
    readSync(fd, tail, 0, tail.length, cursor);
    const parsed = parseTranscript(tail, 0);
    return { events: parsed.events, cursor: cursor + parsed.cursor };
  } finally {
    closeSync(fd);
  }
}

export function transcriptPathFor(cwd: string, sessionId: string): string {
  return join(homedir(), ".claude", "projects", cwd.replace(/[^A-Za-z0-9-]/g, "-"), `${sessionId}.jsonl`);
}
