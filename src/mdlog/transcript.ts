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
