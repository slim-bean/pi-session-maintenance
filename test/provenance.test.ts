import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadConfigWithSource, describeConfigSource } from "../src/config.ts";
import { Store } from "../src/store.ts";
import { normalizeRecord, groupedIssues } from "../src/issues.ts";

test("configuration provenance distinguishes loaded files, absent defaults and host overrides", () => {
  const dir = mkdtempSync(join(tmpdir(), "maintenance-provenance-"));
  try {
    const file = join(dir, ".pi/maintenance.json");
    const defaults = loadConfigWithSource(dir); assert.equal(defaults.source.kind, "defaults"); assert.match(describeConfigSource(defaults.source), /no workspace config loaded/);
    mkdirSync(join(dir, ".pi")); writeFileSync(file, JSON.stringify({ idleSeconds: 3, stateDir: join(dir, "state") }));
    const loaded = loadConfigWithSource(dir); assert.equal(loaded.source.file, file); assert.equal(loaded.source.kind, "workspace-file"); assert.equal(loaded.config.idleSeconds, 3);
    assert.match(describeConfigSource({ kind: "host" }), /not a settings file/);
    writeFileSync(file, "{broken"); assert.throws(() => loadConfigWithSource(dir), error => (error as Error).message.includes(file));
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
test("legacy binary errors group by workspace and resolution archives original counters without clobbering a newer error", () => {
  const dir = mkdtempSync(join(tmpdir(), "maintenance-resolution-")); const store = new Store(dir);
  try {
    const issue = { failures: 5529, retryAt: 0, kind: "error", code: "operation-failed", error: "okf binary not found. Set OKF_BIN, restore this package's bin/ directory, or put okf on PATH." };
    const records = ["one", "two"].map(path => normalizeRecord({ path, cwd: dir, id: path, hash: "hash", seen: 0, failures: 0, retryAt: 0, errors: { upgrade: { ...issue } as any } }));
    assert.equal(groupedIssues(records).length, 1); assert.equal(records[0].errors!.upgrade!.failures, 5529);
    for (const record of records) store.put(record);
    const stale = store.get("one")!; const newer = store.get("one")!; newer.errors!.upgrade!.error = "new prerequisite"; store.put(newer);
    assert.equal(store.resolveIssue(stale, "upgrade", { available: true }), false); assert.equal(store.resolvedIssues(dir).length, 0);
    assert.equal(store.resolveIssue(records[1], "upgrade", { available: true }), true);
    assert.equal(store.resolvedIssues(dir)[0].issue.failures, 5529); assert.equal(store.get("two")!.errors!.upgrade, undefined);
  } finally { store.close(); rmSync(dir, { recursive: true, force: true }); }
});
