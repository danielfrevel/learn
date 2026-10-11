import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { copyFileSync, existsSync, mkdtempSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const BIN = fileURLToPath(new URL("../../bin/", import.meta.url));
const FIX = fileURLToPath(new URL("../fixtures/", import.meta.url));

test("render-svg previews next to the source and publishes", () => {
  const cwd = mkdtempSync(join(tmpdir(), "learn-viz-"));
  const srcDir = mkdtempSync(join(tmpdir(), "learn-viz-src-"));
  const src = join(srcDir, "source.svg");
  copyFileSync(join(FIX, "sample.svg"), src);
  const out = execFileSync(join(BIN, "render-svg"), [src], { cwd, encoding: "utf8" });
  const preview = out.match(/^preview: (.+)$/m)![1];
  assert.equal(preview, join(srcDir, "preview.png"));
  assert.ok(existsSync(preview));
  const pub = execFileSync(join(BIN, "render-svg"), [src, "--save-as", "Number Line!"], { cwd, encoding: "utf8" });
  const filename = pub.match(/^filename: (.+)$/m)![1];
  assert.match(filename, /^viz-number-line-\d+\.png$/);
  assert.deepEqual(readdirSync(join(cwd, "viz")), [filename]);
});

test("render-mermaid fails with exit 2 and a hint when mmdc is missing", () => {
  const r = spawnSync(join(BIN, "render-mermaid"), [join(FIX, "sample.mmd")], { encoding: "utf8", env: { PATH: "/usr/bin:/bin", HOME: "/nonexistent" } });
  assert.equal(r.status, 2);
  assert.match(r.stderr, /mermaid-cli/);
});

test("render-mermaid renders when mmdc exists", { skip: spawnSync("bash", ["-c", "command -v mmdc || test -x \"$HOME/.nix-profile/bin/mmdc\""]).status !== 0 }, () => {
  const cwd = mkdtempSync(join(tmpdir(), "learn-viz-"));
  const src = join(cwd, "source.mmd");
  copyFileSync(join(FIX, "sample.mmd"), src);
  const out = execFileSync(join(BIN, "render-mermaid"), [src], { cwd, encoding: "utf8" });
  assert.ok(existsSync(out.match(/^preview: (.+)$/m)![1]));
});
