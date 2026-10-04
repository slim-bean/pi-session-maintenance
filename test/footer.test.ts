import assert from "node:assert/strict";
import { test } from "node:test";
import { formatFooter, type FooterState } from "../src/footer.ts";
const base: FooterState = {
  enabled: true, pausedUntil: 0, now: 1000, settingsOpen: false,
  foregroundBusy: false, peerBusy: false, savedSession: true,
  budgetReached: false, errors: 0, idleRemainingSeconds: 480,
};
test("footer blocks are emoji-led, terse and have no internal dot separator", () => {
  const cases: [Partial<FooterState>, string][] = [
    [{}, "🧹 idle 8m"], [{ idleRemainingSeconds: 0 }, "🧹 ready"],
    [{ foregroundBusy: true }, "🧹 busy"], [{ peerBusy: true }, "🧹 peer"],
    [{ executorPid: 1234 }, "🧹 slot #1234"], [{ observerPid: 4321 }, "🧹 obs #4321"],
    [{ enabled: false }, "🧹 off"], [{ pausedUntil: 1_801_000 }, "🧹 pause 30m"],
    [{ settingsOpen: true }, "🧹 settings"], [{ savedSession: false }, "🧹 new"],
    [{ budgetReached: true }, "🧹 budget"], [{ errors: 2 }, "🧹 err 2"],
    [{ blockers: 1 }, "🧹 block 1"], [{ deferrals: 1 }, "🧹 wait 1"],
    [{ running: { stage: "summary", progress: "summary: 3/12 sections", stopping: false } }, "🧹 sum 3/12"],
    [{ running: { stage: "review", progress: "knowledge: 2/6 sections validated and committed", stopping: false } }, "🧹 review 2/6"],
    [{ running: { stage: "upgrade", progress: "upgrade · private-session-file.jsonl", stopping: false } }, "🧹 upd"],
    [{ running: { stage: "compact", progress: "", stopping: false } }, "🧹 compact"],
    [{ running: { stage: "push", progress: "", stopping: false } }, "🧹 push"],
    [{ running: { stage: "review", progress: "", stopping: true }, enabled: false }, "🧹 stop…"],
  ];
  for (const [state, expected] of cases) {
    const result = formatFooter({ ...base, ...state });
    assert.equal(result, expected); assert.equal(result.includes("·"), false);
    assert.ok(result.length < 24); assert.equal(result.includes("private-session"), false);
  }
});
