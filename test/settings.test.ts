import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { parseConfig } from "../src/config.ts";
import { editSettings, saveSettings, settingsText, settingsFile } from "../src/settings.ts";

function ui(dir: string, choices: string[], inputs: (string | undefined)[] = [], approvePush = false) {
  const notices: string[] = [];
  const confirmations: string[] = [];
  const ctx: any = { cwd: dir, hasUI: true, modelRegistry: { getAvailable: () => [{ provider: "local", id: "worker" }] },
    ui: {
      async select(_title: string, options: string[]) {
        const wanted = choices.shift(); if (wanted === undefined) return undefined;
        const option = options.find((o) => o.startsWith(wanted));
        assert.ok(option, `No menu option starts with ${wanted}`); return option;
      },
      async input() { return inputs.shift(); },
      async confirm(title: string, body: string) { confirmations.push(title + " " + body); return approvePush; },
      notify(text: string) { notices.push(text); },
    },
  };
  return { ctx, notices, confirmations };
}
test("interactive settings edit a draft and save validated workspace values atomically", async () => {
  const dir = mkdtempSync(join(tmpdir(), "maintenance-settings-"));
  try {
    const cfg = parseConfig({}, dir);
    const h = ui(dir, ["Idle delay:", "Review model:", "local/worker", "Maintenance compaction:", "Between-turn context budget:", "Daily model budget:", "Save & apply"], ["30m", "200k", "$2.50"]);
    const result = await editSettings(h.ctx, cfg, () => {});
    assert.ok(result); assert.equal(result.idleSeconds, 1800); assert.equal(result.reviewModel, "local/worker");
    assert.equal(result.compaction.enabled, true); assert.equal(result.compaction.budgetTokens, 200000); assert.equal(result.dailyBudget, 2.5);
    assert.equal(existsSync(settingsFile(dir)), false); // menu itself never writes
    saveSettings(dir, result, null);
    const persisted = JSON.parse(readFileSync(settingsFile(dir), "utf8"));
    assert.equal(persisted.idleSeconds, 1800); assert.equal(persisted.reviewModel, "local/worker");
    assert.equal(cfg.idleSeconds, 600); assert.equal(cfg.compaction.enabled, false);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
test("cancel, invalid input and declined push do not mutate the original config", async () => {
  const dir = mkdtempSync(join(tmpdir(), "maintenance-settings-cancel-"));
  try {
    const cfg = parseConfig({}, dir);
    const h = ui(dir, ["Idle delay:", "Push committed", "Cancel"], ["invalid"]);
    assert.equal(await editSettings(h.ctx, cfg, () => {}), undefined);
    assert.match(h.notices[0]!, /duration/); assert.equal(h.confirmations.length, 1);
    assert.match(h.confirmations[0]!, /entire existing configured Git branch/);
    assert.equal(cfg.push, false); assert.equal(settingsText(dir), null);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
test("settings abort when session changes and refuse to overwrite external edits", async () => {
  const dir = mkdtempSync(join(tmpdir(), "maintenance-settings-conflict-"));
  try {
    const cfg = parseConfig({}, dir);
    const h = ui(dir, ["Idle delay:"], ["30m"]); let checks = 0;
    await assert.rejects(editSettings(h.ctx, cfg, () => { if (++checks > 1) throw new Error("session changed"); }), /session changed/);
    assert.equal(settingsText(dir), null);
    mkdirSync(join(dir, ".pi")); writeFileSync(settingsFile(dir), '{"idleSeconds":120}\n');
    await assert.rejects(async () => saveSettings(dir, cfg, null), /changed while/);
    assert.equal(readFileSync(settingsFile(dir), "utf8"), '{"idleSeconds":120}\n');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
