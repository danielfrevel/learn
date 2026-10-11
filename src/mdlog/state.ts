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
