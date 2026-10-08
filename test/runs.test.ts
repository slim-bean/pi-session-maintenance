import assert from "node:assert/strict";
import { test } from "node:test";
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync, symlinkSync, truncateSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SessionManager } from "@earendil-works/pi-coding-agent";
import { RunLog, listRuns, runText, findRun } from "../src/runs.ts";
import { passiveTerminalInput, passiveCommand } from "../src/passive-input.ts";
import { RunViewer, safeText } from "../src/viewer.ts";
import { visibleWidth } from "@earendil-works/pi-tui";
import { snapshot } from "../src/source.ts";
const usage = { input: 2, output: 3, cacheRead: 0, cacheWrite: 0, totalTokens: 5, cost: { input: 0, output: 0.01, cacheRead: 0, cacheWrite: 0, total: 0.01 } };
const message = (text: string, stopReason = "stop") => ({ role: "assistant", api: "openai-responses", provider: "fake", model: "offline", content: [{ type: "text", text }], usage, stopReason, timestamp: Date.now() });
function fixture() {
  const dir = mkdtempSync(join(tmpdir(), "maintenance-runs-"));
  const source = join(dir, "source.jsonl"); writeFileSync(source, "source must stay untouched\n");
  const meta = { source, sourceHash: "hash", cwd: dir, stage: "review", owner: "owner", pid: process.pid, started: Date.now() };
  return { dir, source, meta, close: () => rmSync(dir, { recursive: true, force: true }) };
}
test("native JSONL captures exact requests, streamed output, final usage and outcomes outside the source session", () => {
  const f = fixture();
  try {
    const log = new RunLog(f.dir, f.meta);
    log.model({ type: "start", provider: "fake", model: "offline", systemPrompt: "actual system", messages: [{ role: "user", content: "actual input", timestamp: Date.now() }] });
    log.model({ type: "delta", channel: "text", delta: "hello " });
    log.model({ type: "delta", channel: "text", delta: "world" }); log.flush();
    log.model({ type: "end", message: message("hello world") });
    log.event("commit", { commit: "abc" }); log.finish("complete");
    const native = SessionManager.open(log.file).getEntries();
    assert.ok(native.some((e: any) => e.type === "message" && e.message.role === "assistant" && e.message.usage.cost.total === .01));
    assert.ok(native.some((e: any) => e.type === "message" && e.message.role === "user" && e.message.content === "actual input"));
    const run = listRuns(f.dir, f.dir)[0]; assert.equal(run.status, "complete");
    assert.equal(findRun(f.dir, "another-cwd", log.id), undefined);
    assert.equal(runText(run).match(/hello world/g)?.length, 1);
    assert.equal(statSync(log.file).mode & 0o777, 0o600); assert.equal(statSync(join(f.dir, "runs")).mode & 0o777, 0o700);
    assert.equal(readFileSync(f.source, "utf8"), "source must stay untouched\n");
    assert.throws(() => log.event("late"), /closed/);
    assert.throws(() => snapshot(log.file), /refusing recursive maintenance/);
  } finally { f.close(); }
});
test("cancelled and failed runs retain partial output; disabling model transcripts retains only operational metadata", () => {
  const f = fixture();
  try {
    for (const status of ["cancelled", "error"] as const) {
      const log = new RunLog(f.dir, f.meta);
      log.model({ type: "delta", channel: "thinking", delta: "partial visible reasoning" }); log.finish(status, "interrupted");
      const run = findRun(f.dir, f.dir, log.id)!; assert.equal(run.status, status); assert.match(runText(run), /partial visible reasoning/);
    }
    const log = new RunLog(f.dir, f.meta, Date.now, false);
    log.model({ type: "start", provider: "fake", model: "offline", systemPrompt: "SECRET PROMPT", messages: [{ role: "user", content: "SECRET INPUT" }] });
    log.model({ type: "delta", channel: "text", delta: "SECRET OUTPUT" });
    log.model({ type: "end", message: message("SECRET RESPONSE") }); log.finish("complete");
    const raw = readFileSync(log.file, "utf8"); assert.doesNotMatch(raw, /SECRET/); assert.match(raw, /model-end/);
    symlinkSync(f.source, join(f.dir, "runs", "escape.jsonl")); assert.equal(listRuns(f.dir, f.dir).length, 3);
  } finally { f.close(); }
});
test("retention prunes only completed old runs; oversized transcripts stop further writes", () => {
  const f = fixture();
  try {
    const old = new RunLog(f.dir, { ...f.meta, started: 1000 }, () => 1000); old.finish("complete");
    const active = new RunLog(f.dir, { ...f.meta, started: 1000 }, () => 1000);
    const latest = new RunLog(f.dir, f.meta);
    assert.equal(existsSync(old.file), false); assert.equal(existsSync(active.file), true);
    truncateSync(latest.file, 32 * 1024 * 1024);
    assert.throws(() => latest.model({ type: "delta", channel: "text", delta: "too large" }), /32 MiB/);
    active.finish("cancelled");
  } finally { f.close(); }
});

test("passive inspection/admission commands do not preempt work; normal input and mutation commands do", () => {
  for (const command of ["watch", "history", "logs", "status", "help", "run", "retry"]) {
    const text = `/maintenance ${command}`;
    for (let i = 0; i < text.length; i++) assert.equal(passiveTerminalInput(text.slice(0, i), text[i]), true, text.slice(0, i + 1));
    assert.equal(passiveTerminalInput(text, "\r"), true); assert.equal(passiveCommand(text), true);
    for (let i = 0; i < text.length; i++) assert.equal(passiveTerminalInput(text.slice(0, i), `\x1b[${text.charCodeAt(i)};1u`), true);
  }
  for (const text of ["hello", "/other", "/maintenance off", "/maintenance settings", "/maintenance cancel", "/maintenance run\nuser input"]) assert.equal(passiveCommand(text), false);
  assert.equal(passiveTerminalInput("", "hello"), false);
  assert.equal(passiveTerminalInput("/maintenance ", "o"), false);
  assert.equal(passiveTerminalInput("", "\x1b[27;1:3u"), true); // releasing Esc after the monitor closes
  assert.equal(passiveTerminalInput("", "\x1b[200~/maintenance watch\x1b[201~"), true);
  assert.equal(passiveTerminalInput("", "\x1b[200~ordinary text\x1b[201~"), false);
  assert.equal(passiveTerminalInput("", "\x1b[200~/maintenance watch\nuser text\x1b[201~"), false);
});
test("viewer is width-safe, escapes controls, follows output, scrolls and disposes its timer", () => {
  const f = fixture(); let renders = 0; let closed = 0;
  try {
    const log = new RunLog(f.dir, f.meta); log.progress("progress\x1b]52;c;clipboard\x07");
    const viewer = new RunViewer({ requestRender() { renders++; }, terminal: { rows: 12 } }, { fg: (_c: string, s: string) => s } as any,
      () => closed++, f.dir, f.dir);
    for (const width of [8, 24, 80]) {
      const lines = viewer.render(width); assert.ok(lines.length <= 9); assert.ok(lines.every(line => visibleWidth(line) <= width));
      assert.doesNotMatch(lines.join("\n"), /\x1b\]/);
    }
    viewer.handleInput("k"); viewer.handleInput("\x1b[102;1u"); viewer.handleInput("\x1b[112;1u"); viewer.handleInput("\x1b");
    assert.equal(closed, 1); assert.ok(renders > 0); viewer.dispose(); log.finish("complete");
    assert.equal(safeText("abc\x1b[31m"), "abc[31m");
  } finally { f.close(); }
});
