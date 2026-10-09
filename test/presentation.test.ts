import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { visibleWidth } from "@earendil-works/pi-tui";
import { RunLog, findRun } from "../src/runs.ts";
import { renderRows, runRows, statusStyle } from "../src/presentation.ts";
function fixture(capture = true) {
  const dir = mkdtempSync(join(tmpdir(), "maintenance-present-"));
  const log = new RunLog(dir, { source: join(dir, "source.jsonl"), sourceHash: "hash", cwd: dir,
    stage: "review", owner: "test", pid: process.pid, started: Date.now() }, Date.now, capture);
  return { dir, log, rows: () => runRows(findRun(dir, dir, log.id)!), close: () => rmSync(dir, { recursive: true, force: true }) };
}
const usage = { input: 100, output: 30, cacheRead: 50, cacheWrite: 20, cacheWrite1h: 10, reasoning: 15,
  cost: { input: .001, output: .002, cacheRead: .0001, cacheWrite: .0002, total: .0033 } };
const start = { type: "start" as const, provider: "fake", model: "offline", systemPrompt: "abcd",
  messages: [{ role: "user", content: "abcdefgh", timestamp: Date.now() }], reasoning: "low", maxTokens: 8192 };
const reply = (u: any, text = "abcd") => ({ role: "assistant", provider: "fake", model: "offline", api: "openai-responses", timestamp: Date.now(),
  content: [{ type: "text", text }, { type: "thinking", thinking: "abcdefgh", thinkingSignature: "BASE64".repeat(10000) }], stopReason: "stop", usage: u });
test("provider counts include cache tokens, reasoning is a subset, and duplicated accounting events/stream deltas are not added twice", () => {
  const f = fixture();
  try {
    f.log.model(start); f.log.model({ type: "delta", channel: "text", delta: "large partial preview".repeat(1000) });
    f.log.event("usage", usage); f.log.model({ type: "end", message: reply(usage) }); f.log.finish("complete");
    const before = readFileSync(f.log.file, "utf8"); const rows = f.rows();
    assert.equal(rows.filter(r => r.label === "Input · provider-reported").length, 1);
    assert.equal(rows.find(r => r.label === "Input · provider-reported")!.text, "170 tokens");
    assert.equal(rows.find(r => r.label === "Output · provider-reported")!.text, "30 tokens");
    assert.match(rows.find(r => r.label === "Reasoning output")!.text, /15.*included/);
    assert.match(rows.find(r => r.label === "1-hour cache writes")!.text, /10.*subset/);
    assert.equal(rows.find(r => r.label === "💵 Cost · recorded")!.text, "$0.0033");
    assert.match(rows.find(r => r.label === "Visible input · estimate")!.text, /~3 tokens/);
    assert.match(rows.find(r => r.label === "Visible output · estimate")!.text, /^~3 tokens \+ unknown/);
    assert.equal(readFileSync(f.log.file, "utf8"), before);
  } finally { f.close(); }
});
test("all-zero provider usage is unavailable, disabled content is not estimated as zero, and zero cost is not called free", () => {
  const f = fixture(false);
  try {
    f.log.model(start); f.log.model({ type: "end", message: reply({ input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cost: { total: 0 } }) }); f.log.finish("complete");
    const rows = f.rows(); assert.match(rows.find(r => r.label === "Provider token usage")!.text, /Unavailable/);
    assert.match(rows.find(r => r.label === "Visible input · estimate")!.text, /not recorded/);
    assert.match(rows.find(r => r.label === "Visible output · estimate")!.text, /not recorded/);
    assert.match(rows.find(r => r.label === "💵 Cost · recorded")!.text, /not proof of free/);
  } finally { f.close(); }
});
test("JSON reviews/results become readable rows with source references and validation/commit evidence", () => {
  const f = fixture();
  try {
    f.log.model(start); f.log.model({ type: "end", message: reply(usage, JSON.stringify({ reviewed: true, changes: [
      { concept: "decisions/cache", title: "Cache reuse", description: "Avoid repeated work", body: "Preserve checkpoints.", entries: [1, 5] } ] })) });
    f.log.event("validation", { ok: true, advisories: [{ message: "Independent topic" }] });
    f.log.event("commit", { commit: "abc123" }); f.log.event("outcome", { complete: true, detail: { done: 1, sections: 3, commit: "abc123" } }); f.log.finish("checkpoint");
    const rows = f.rows(); const text = rows.map(r => `${r.label ?? ""} ${r.text}`).join("\n");
    assert.match(text, /Validation passed|Cache reuse/); assert.match(text, /Source entries #1, #5/);
    assert.match(text, /Done 1|Sections 3/); assert.doesNotMatch(text, /\{"reviewed"/);
    assert.ok(rows.some(r => r.tone === "success")); assert.ok(rows.some(r => r.heading));
    assert.match(text, /not proof of application/);
    const tones: string[] = []; const theme: any = { fg: (c: string, s: string) => { tones.push(c); return s; }, bold: (s: string) => s };
    for (const width of [8, 24, 80]) assert.ok(renderRows(rows, theme, width).every(line => visibleWidth(line) <= width));
    assert.ok(tones.includes("success"));
  } finally { f.close(); }
});
test("abort diagnostics and provider errors are visible in history and native-session views, with model capture on or off", () => {
  for (const capture of [true, false]) {
    const f = fixture(capture);
    try {
      f.log.model({ ...start, timeoutMs: 600000 });
      f.log.model({ type: "end", message: { ...reply(usage), stopReason: "aborted", errorMessage: "Request aborted" },
        abortReason: "Model call timed out after 600s", elapsedMs: 600010, timeoutMs: 600000 });
      f.log.finish("error", "Model call timed out after 600s");
      for (const session of [true, false]) {
        const rows = runRows(findRun(f.dir, f.dir, f.log.id)!, { session });
        assert.equal(rows.find(r => r.label === "Abort reason")!.text, "Model call timed out after 600s");
        assert.equal(rows.find(r => r.label === "Provider error")!.text, "Request aborted");
        assert.equal(rows.find(r => r.label === "Call deadline")!.text, "600s");
        assert.equal(rows.find(r => r.label === "Call elapsed")!.text, "600.0s");
      }
    } finally { f.close(); }
  }
});
test("old aborted records show uncertainty and preserve the run termination separately", () => {
  const f = fixture();
  try {
    f.log.model(start); f.log.model({ type: "end", message: { ...reply(usage), stopReason: "aborted" } });
    f.log.finish("cancelled", "Foreground activity takes priority");
    const rows = runRows(findRun(f.dir, f.dir, f.log.id)!, { session: true });
    assert.match(rows.find(r => r.label === "Abort reason")!.text, /Not recorded/);
    assert.equal(rows.find(r => r.label === "Run termination")!.text, "Foreground activity takes priority");
  } finally { f.close(); }
});
test("partial output stays labeled partial; unknown JSON fields are kept, and raw control sequences never execute", () => {
  const f = fixture();
  try {
    f.log.model(start); f.log.model({ type: "delta", channel: "text", delta: "{\"reviewed\":" }); f.log.flush();
    let text = f.rows().map(r => r.text).join("\n"); assert.match(text, /Partial model output/); assert.match(text, /partial stream only/);
    f.log.model({ type: "end", message: reply(undefined, JSON.stringify({ futureField: { nestedValue: "\x1b]52;c;payload\x07" }, accepted: false })) }); f.log.finish("complete");
    const rows = f.rows(); assert.ok(rows.some(r => r.label?.includes("Future Field")));
    const theme: any = { fg: (_c: string, s: string) => s, bold: (s: string) => s };
    assert.doesNotMatch(renderRows(rows, theme, 80).join("\n"), /\x1b\]/);
    assert.equal(statusStyle("unfamiliar").text, "Active / unfinished");
  } finally { f.close(); }
});
