import assert from "node:assert/strict";
import { test } from "node:test";
import { parseConfig } from "../src/config.ts";
import { formatStatus, formatSettings, timeSpan, type Status } from "../src/format.ts";
import type { Capabilities } from "../src/protocol.ts";

const now = Date.UTC(2026, 9, 3, 12);
const caps: Capabilities = { memory: { protocol: 1, channel: "memory" }, summary: { protocol: 1, channel: "summary" } };
function status(): Status {
  return { enabled: true, currentSession: "/workspace/current.jsonl", currentSessionName: "Database comparison",
    ownsSession: true, foregroundBusy: false, peerBusy: false, idleRemainingSeconds: 120,
    owner: { key: "session", token: "private-owner-token", host: "local", pid: 1234, heartbeat: now },
    running: null, compactStarted: undefined, progress: "waiting for idle",
    control: { paused_until: 0, disabled: 0, cancel_seq: 4, last_activity: now }, spentToday: .03,
    configSource: { kind: "programmatic" }, resolvedIssues: [],
    config: parseConfig({}, "/workspace"), sessions: [{ path: "/workspace/current.jsonl", cwd: "/workspace", id: "abc", hash: "new", seen: now, retryAt: 0, failures: 0,
      name: "old title", entryCount: 3, review: { hash: "old", key: "m", at: now - 600_000 }, summary: { hash: "new", key: "s", at: now - 60_000 } }] };
}
test("human status shows ownership, delays, names, coverage and budgets without raw JSON/tokens", () => {
  const text = formatStatus(status(), caps, now);
  assert.match(text, /eligible in 2m/); assert.match(text, /this pi process \(PID 1234\)/);
  assert.match(text, /Database comparison \(current\)/);
  assert.match(text, /new conversation since last pass/); assert.match(text, /Summary: covered 1m ago/);
  assert.match(text, /\$0\.03 \/ \$5\.00 today/);
  assert.doesNotMatch(text, /private-owner-token|cancel_seq|"sessions"|old title/);
});
test("off, suspension, observers, absent packages and errors have clear messages", () => {
  const s = status(); s.control!.paused_until = now + 1800_000; s.enabled = false;
  assert.match(formatStatus(s, caps, now), /Paused for 30m/);
  s.control!.disabled = 1; assert.match(formatStatus(s, caps, now), /Disabled for this workspace/);
  s.control!.disabled = 0; s.control!.paused_until = 0; s.ownsSession = false;
  assert.match(formatStatus(s, {}, now), /Observer/); assert.match(formatStatus(s, {}, now), /package not loaded/);
  s.sessions[0]!.errors = { summary: { failures: 1, retryAt: now + 30_000, error: "provider unavailable\nretry later\u001b[31m" } };
  const text = formatStatus(s, caps, now);
  assert.match(text, /Search summary error, retry in 30s: provider unavailable retry later/);
  assert.equal(text.includes("\u001b"), false);
});
test("coverage list is bounded and disabled compaction is described in settings", () => {
  const s = status();
  for (let i = 0; i < 30; i++) s.sessions.push({ ...s.sessions[0]!, path: `/workspace/archive-${i}.jsonl`, name: `Archive ${i}` });
  const text = formatStatus(s, caps, now);
  assert.equal(text.split("\n").filter((l) => l.startsWith("• ")).length, 8);
  assert.match(text, /23 more observed sessions/);
  const settings = formatSettings(s.config, "/workspace");
  assert.match(settings, /Compaction: off/); assert.match(settings, /Between-turn budget: off/);
  assert.match(settings, /Review model: automatic/);
  assert.equal(timeSpan(1800), "30m"); assert.equal(timeSpan(7200), "2h");
});
