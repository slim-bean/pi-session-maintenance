import assert from "node:assert/strict";
import { test } from "node:test";
import { nextSteps } from "../src/guidance.ts";
import { formatStatus, type Status } from "../src/format.ts";
import { parseConfig } from "../src/config.ts";
import type { IssueGroup } from "../src/issues.ts";
const now = 100000;
function group(code: string, detail?: unknown): IssueGroup {
  return { kind: "blocked", code, resource: "/workspace/knowledge", message: "test blocker", paths: new Set(["/workspace/session.jsonl"]),
    stages: new Set(["review"]), retryAt: now + 30000, attempts: 4, lastAttemptAt: now - 60000, legacyHistory: false, detail };
}
function status(): Status {
  return { enabled: true, ownsSession: true, foregroundBusy: true, peerBusy: false, idleRemainingSeconds: 120,
    owner: undefined, currentSession: "/workspace/session.jsonl", currentSessionName: undefined, running: null, compactStarted: undefined,
    progress: "waiting for idle", control: { disabled: 0, paused_until: 0, cancel_seq: 0, last_activity: now },
    configSource: { kind: "programmatic" }, resolvedIssues: [],
    spentToday: 0, config: parseConfig({}, "/workspace"), sessions: [{ path: "/workspace/session.jsonl", cwd: "/workspace", id: "s", hash: "source", seen: now, retryAt: 0, failures: 0,
      errors: { review: { kind: "blocked", code: "memory-validation", resource: "/workspace/knowledge", error: "Validation needs repair", failures: 4, attempts: 4, retryAt: now + 30000, lastAttemptAt: now - 60000,
        detail: { validation: { warnings: ["decisions/storage not listed in parent index"], errors: [], gate_findings: [], broken_links: null } } } } }] };
}
test("guidance distinguishes routine waiting from specific prerequisite repairs", () => {
  assert.equal(nextSteps(group("bundle-lock")).intervention, "none");
  assert.match(nextSteps(group("bundle-lock")).actions.join(" "), /Do not delete a live/);
  assert.match(nextSteps(group("git-identity")).actions.join(" "), /user.name and user.email/);
  assert.match(nextSteps(group("git-conflict")).actions.join(" "), /merge\/rebase\/cherry-pick/);
  assert.match(nextSteps(group("model-auth")).actions.join(" "), /normal login\/credential/);
  const validation = nextSteps(group("memory-validation", { validation: { warnings: ["concept x missing parent index listing"] } }));
  assert.equal(validation.intervention, "needed"); assert.match(validation.actions.join(" "), /concept x missing/);
  assert.match(nextSteps(group("stale-context")).actions.join(" "), /\/reload alone does not reread/);
});
test("status states retry history, action, automatic eligibility and safe immediate retry", () => {
  const s = status();
  const caps = { memory: { protocol: 1 as const, channel: "memory" } };
  const text = formatStatus(s, caps, now);
  assert.match(text, /already retried 3 time/); assert.match(text, /Last check 1m ago/);
  assert.match(text, /Action needed before this can pass/); assert.match(text, /decisions\/storage not listed/);
  assert.match(text, /Automatic retry: at a safe idle window after foreground work finishes; normal idle delay is 10m/);
  assert.match(text, /Retrying alone cannot repair/);
  assert.match(text, /Retry now: \/maintenance retry removes backoff immediately/);
  assert.match(text, /Active turns are not interrupted/);
  s.control!.disabled = 1; assert.match(formatStatus(s, caps, now), /Automatic retry: paused while maintenance is off/);
  s.control!.disabled = 0; s.spentToday = 5; assert.match(formatStatus(s, caps, now), /after the UTC daily budget resets/);
});
