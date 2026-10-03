import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir, hostname } from "node:os";
import { join } from "node:path";
import { parseConfig, duration } from "../src/config.ts";
import { snapshot } from "../src/source.ts";
import { Store } from "../src/store.ts";

test("settings reject unsafe values and compaction is opt-in", () => {
  const cfg = parseConfig({}, "/workspace");
  assert.equal(cfg.enabled, true); assert.equal(cfg.compaction.enabled, false);
  assert.equal(duration("30m"), 1800);
  for (const raw of [{ idleSeconds: 0 }, { enabled: "yes" }, { typo: 1 }, { compaction: { minTokens: -1 } }, { dailyBudget: NaN }]) {
    assert.throws(() => parseConfig(raw, "/workspace"));
  }
});

test("snapshots include every branch and ignore compaction/metadata changes", () => {
  const dir = mkdtempSync(join(tmpdir(), "maintenance-source-"));
  try {
    const path = join(dir, "s.jsonl");
    const header = { type: "session", id: "fixture", cwd: dir };
    const entries = [
      { type: "message", id: "a", parentId: null, message: { role: "user", content: "question" } },
      { type: "message", id: "b", parentId: "a", message: { role: "assistant", content: [{ type: "text", text: "branch one" }, { type: "thinking", thinking: "private" }] } },
      { type: "message", id: "c", parentId: "a", message: { role: "assistant", content: [{ type: "text", text: "sidequest" }] } },
    ];
    const save = () => writeFileSync(path, [header, ...entries].map((e) => JSON.stringify(e)).join("\n") + "\n");
    save(); const first = snapshot(path);
    assert.deepEqual(first.entries.map((e) => e.text), ["question", "branch one", "sidequest"]);
    writeFileSync(path, JSON.stringify({ type: "compaction", summary: "not evidence" }) + "\n", { flag: "a" });
    assert.equal(snapshot(path).hash, first.hash);
    writeFileSync(path, '{"type":', { flag: "a" });
    assert.throws(() => snapshot(path), /Incomplete/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("ownership is atomic, does not expire live owners, and recovers only dead locals", () => {
  const dir = mkdtempSync(join(tmpdir(), "maintenance-store-"));
  const a = new Store(dir, () => 10, (pid) => pid === process.pid);
  const b = new Store(dir, () => 999999, (pid) => pid === process.pid);
  try {
    assert.equal(a.claim("session:x"), true); assert.equal(b.claim("session:x"), false);
    a.release("session:x"); assert.equal(b.claim("session:x"), true);
    b.release("session:x");
    a.db.prepare("INSERT INTO leases VALUES(?,?,?,?,?)").run("session:x", "dead", 987654, hostname(), 0);
    assert.equal(b.claim("session:x"), true);
    a.db.prepare("INSERT INTO leases VALUES(?,?,?,?,?)").run("foreign", "other", 987654, "another-host", 0);
    assert.equal(b.claim("foreign"), false);
    a.setControl("cwd", 1000, true); assert.equal(b.control("cwd").disabled, 1);
    a.account(0.1); b.account(0.2); assert.ok(Math.abs(a.spent() - 0.3) < 0.0001);
  } finally { a.close(); b.close(); rmSync(dir, { recursive: true, force: true }); }
});
