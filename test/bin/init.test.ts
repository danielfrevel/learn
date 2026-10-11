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
