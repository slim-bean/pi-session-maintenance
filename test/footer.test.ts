import assert from "node:assert/strict";
import { test } from "node:test";
import { formatFooter, type FooterState } from "../src/footer.ts";
const base: FooterState = { enabled: true, pausedUntil: 0, now: 1000, settingsOpen: false,
  foregroundBusy: false, peerBusy: false, savedSession: true, budgetReached: false, errors: 0, idleRemainingSeconds: 480 };
test("idle footer stays terse; active work animates and advertises the passive monitor", () => {
  const cases: [Partial<FooterState>, string][] = [
    [{}, "🧹 idle 8m"], [{ idleRemainingSeconds: 0 }, "🧹 ready"],
    [{ foregroundBusy: true }, "🧹 busy"], [{ peerBusy: true }, "🧹 peer"],
    [{ executorPid: 1234 }, "🧹 slot #1234"], [{ observerPid: 4321 }, "🧹 obs #4321"],
    [{ enabled: false }, "🧹 off"], [{ pausedUntil: 1_801_000 }, "🧹 pause 30m"],
    [{ settingsOpen: true }, "🧹 settings"], [{ savedSession: false }, "🧹 new"],
    [{ budgetReached: true }, "🧹 budget"], [{ errors: 2 }, "🧹 err 2 → status"],
    [{ blockers: 1 }, "🧹 block 1 → status"], [{ deferrals: 1 }, "🧹 wait 1 auto"],
  ];
  for (const [state, expected] of cases) assert.equal(formatFooter({ ...base, ...state }), expected);
  const running = { stage: "summary", progress: "summary: 3/12 sections", stopping: false, started: 0 };
  assert.equal(formatFooter({ ...base, running }), "🧹 ⠋ sum 3/12 1s → /maintenance watch");
  assert.equal(formatFooter({ ...base, running, frame: 1 }), "🧹 ⠙ sum 3/12 1s → /maintenance watch");
  assert.equal(formatFooter({ ...base, running: { ...running, stopping: true }, enabled: false }), "🧹 stop… → /maintenance watch");
  for (const stage of ["review", "upgrade", "compact", "push"]) {
    const result = formatFooter({ ...base, running: { stage, progress: "private-session-file.jsonl", stopping: false } });
    assert.match(result, /→ \/maintenance watch/); assert.doesNotMatch(result, /private-session|·/);
  }
});
