import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { visibleWidth } from "@earendil-works/pi-tui";
import { HistoryViewer } from "../src/history.ts";
import { RunLog, findRun, sessionText } from "../src/runs.ts";
const theme = { fg: (_c: string, text: string) => text } as any;
function fixture() {
  const dir = mkdtempSync(join(tmpdir(), "maintenance-history-")); let order = 0;
  const add = (name: string, cwd = dir) => {
    const started = Date.now() + ++order * 1000;
    const log = new RunLog(dir, { source: join(cwd, name + ".jsonl"), sourceHash: name, cwd,
      stage: "review", owner: "test", pid: process.pid, started }, () => started);
    log.model({ type: "start", provider: "fake", model: "offline", systemPrompt: "SYSTEM_" + name,
      messages: [{ role: "user", content: "QUESTION_" + name, timestamp: started }] });
    log.model({ type: "end", message: { role: "assistant", provider: "fake", model: "offline", api: "openai-responses",
      timestamp: started, content: [{ type: "thinking", thinking: "THINKING_" + name }, { type: "text", text: "ANSWER_" + name }], stopReason: "stop", usage: { cost: { total: .01 } } } });
    log.progress("RESULT_" + name); log.finish("complete"); return log;
  };
  return { dir, add, close: () => rmSync(dir, { recursive: true, force: true }) };
}
test("history selects runs on the left, previews results on the right, and opens a read-only session with Enter", () => {
  const f = fixture(); let closed = 0;
  try {
    const one = f.add("one"); const two = f.add("two"); f.add("other-workspace", join(f.dir, "other"));
    const originals = [one, two].map(r => readFileSync(r.file, "utf8"));
    const view = new HistoryViewer({ requestRender() {}, terminal: { rows: 24 } }, theme, () => closed++, f.dir, f.dir);
    assert.match(view.render(120).join("\n"), /RESULT_two/); assert.doesNotMatch(view.render(120).join("\n"), /other-workspace/);
    view.handleInput("\x1b[B"); assert.match(view.render(120).join("\n"), /RESULT_one/);
    view.handleInput("\r"); let session = view.render(120).join("\n");
    assert.match(session, /Session \(read-only\)/); assert.match(session, /QUESTION_one/); assert.match(session, /ANSWER_one/);
    assert.doesNotMatch(session, /SYSTEM_one|THINKING_one/);
    view.handleInput("p"); view.handleInput("t"); session = view.render(120).join("\n");
    assert.match(session, /SYSTEM_one/); assert.match(session, /THINKING_one/);
    view.handleInput("r"); assert.match(view.render(120).join("\n"), /"type"/);
    view.handleInput("\x1b"); assert.match(view.render(120).join("\n"), /Maintenance history/); assert.match(view.render(120).join("\n"), /RESULT_one/);
    assert.equal(closed, 0); view.handleInput("\x1b"); assert.equal(closed, 1);
    assert.deepEqual([one, two].map(r => readFileSync(r.file, "utf8")), originals); view.dispose();
  } finally { f.close(); }
});
test("history preserves run-ID selection during incoming records and supports narrow panes/resize/theme invalidation", async () => {
  const f = fixture();
  try {
    f.add("first"); const selected = f.add("selected");
    const view = new HistoryViewer({ requestRender() {}, terminal: { rows: 18 } }, theme, () => {}, f.dir, f.dir, selected.id);
    try {
      f.add("incoming"); await new Promise(resolve => setTimeout(resolve, 550));
      assert.match(view.render(100).join("\n"), /RESULT_selected/); assert.doesNotMatch(view.render(100).join("\n"), /RESULT_incoming/);
      for (const width of [8, 24, 63, 64, 100, 160]) {
        for (const key of ["\x1b[D", "\x1b[C"]) {
          view.handleInput(key); const lines = view.render(width);
          assert.ok(lines.length <= 18); assert.ok(lines.every(line => visibleWidth(line) <= width));
        }
        view.invalidate();
      }
    } finally { view.dispose(); }
    const run = findRun(f.dir, f.dir, selected.id)!;
    assert.match(sessionText(run), /QUESTION_selected/); assert.doesNotMatch(sessionText(run), /SYSTEM_selected/);
  } finally { f.close(); }
});
test("empty history remains usable and Enter does not open anything", () => {
  const f = fixture(); let closed = 0;
  try {
    const view = new HistoryViewer({ requestRender() {} }, theme, () => closed++, f.dir, f.dir);
    view.handleInput("\r"); view.handleInput("\t"); assert.match(view.render(100).join("\n"), /No maintenance history/);
    view.handleInput("q"); assert.equal(closed, 1); view.dispose();
  } finally { f.close(); }
});
