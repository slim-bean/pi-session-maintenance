import assert from "node:assert/strict";
import { test } from "node:test";
import { classify, groupedIssues, normalizeRecord, maintenanceIssue } from "../src/issues.ts";
import { formatStatus } from "../src/format.ts";
import { parseConfig } from "../src/config.ts";
import type { RecordState } from "../src/store.ts";

export const legacyOrphanError = "Memory validation failed; planned changes retained for retry: " + JSON.stringify({ ok: false, exitCode: 1, validation: {
  bundle_path: "/workspace/knowledge", concept_count: 2, is_conformant: true, gate_passed: false,
  errors: [], warnings: [], gate_findings: [], broken_links: null, orphans: ["one", "two"], stale_count: 0,
} });
function record(path: string): RecordState {
  return { path, cwd: "/workspace", id: path, hash: "source", seen: 1, retryAt: 0, failures: 0,
    errors: { review: { failures: 27, retryAt: 10000, error: legacyOrphanError } } };
}
test("old orphan-only validation failures become one shared blocker, not six errors or successful receipts", () => {
  const records = Array.from({ length: 6 }, (_, i) => normalizeRecord(record(`/workspace/${i}.jsonl`)));
  const groups = groupedIssues(records);
  assert.equal(groups.length, 1); assert.equal(groups[0]!.kind, "blocked"); assert.equal(groups[0]!.paths.size, 6);
  assert.equal(groups[0]!.code, "orphan-policy-legacy");
  assert.equal(records[0]!.review, undefined); assert.equal(records[0]!.errors!.review!.failures, 27);
  assert.equal(records[0]!.errors!.review!.retryAt, 10000);
  const cfg = parseConfig({}, "/workspace");
  const text = formatStatus({ enabled: true, currentSession: records[0]!.path, ownsSession: true, foregroundBusy: false, peerBusy: false,
    idleRemainingSeconds: 0, owner: undefined, running: null, compactStarted: undefined, progress: "waiting for idle", control: null,
    spentToday: 0, config: cfg, sessions: records } as any, { memory: { protocol: 1, channel: "memory" } }, 1);
  assert.match(text, /0 errors · 1 blockers · 0 waiting/); assert.match(text, /affects 6 session\(s\)/);
});
test("typed deferrals are routine waiting; unrelated failures remain errors", () => {
  assert.equal(classify(maintenanceIssue("deferred", "bundle-lock", "/bundle", "another writer owns the bundle")).kind, "deferred");
  assert.equal(classify(new Error("provider unavailable")).kind, "error");
  assert.equal(classify(new Error(legacyOrphanError + "garbage")).kind, "error");
  const mixed = JSON.parse(legacyOrphanError.slice(legacyOrphanError.indexOf("{")));
  mixed.validation.warnings.push("not listed in parent index");
  const issue = classify(new Error("Memory validation failed; planned changes retained for retry: " + JSON.stringify(mixed)));
  assert.equal(issue.code, "memory-validation"); // no policy-change retry bypass for index findings
  assert.equal(issue.kind, "blocked");
});
