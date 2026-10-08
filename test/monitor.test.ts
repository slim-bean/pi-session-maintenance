import assert from "node:assert/strict";
import { test } from "node:test";
import { EventEmitter } from "node:events";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import maintenance from "../src/index.ts";

test("watch/status typing and monitor navigation do not cancel a live run; ordinary input still does", async () => {
  const dir = mkdtempSync(join(tmpdir(), "maintenance-monitor-"));
  const path = join(dir, "source.jsonl");
  const rawEntries = [{ type: "message", id: "user", parentId: null, message: { role: "user", content: "a decision" } }];
  writeFileSync(path, [{ type: "session", id: "source", cwd: dir }, ...rawEntries].map(e => JSON.stringify(e)).join("\n") + "\n");
  const sourceBefore = readFileSync(path, "utf8");
  mkdirSync(join(dir, ".pi")); writeFileSync(join(dir, ".pi/maintenance.json"), JSON.stringify({ stateDir: join(dir, "state"), idleSeconds: 600, knowledge: false, upgrades: false }));
  const hooks = new Map<string, Function>(); const bus = new EventEmitter(); const notices: string[] = [];
  let command: any; let shortcut: any; let terminal: any; let editor = ""; let component: any; let activeSignal: AbortSignal;
  let finish!: () => void; const done = new Promise<void>(resolve => { finish = resolve; });
  bus.on("pi-session-maintenance:capabilities:v1", r => { r.capabilities.summary = { protocol: 1, channel: "summary" }; });
  bus.on("summary", r => {
    if (r.operation === "status") { r.result = Promise.resolve({ key: "summary:1", complete: false }); return; }
    activeSignal = r.signal; r.onProgress("summary: 0/1 sections");
    r.result = done.then(() => ({ key: "summary:1", complete: true }));
  });
  const pi: any = { on: (name: string, fn: Function) => hooks.set(name, fn), getAllTools: () => [],
    registerCommand(_name: string, value: any) { command = value; }, registerShortcut(_key: string, value: any) { shortcut = value; },
    events: { on: (name: string, fn: any) => bus.on(name, fn), emit: (name: string, r: any) => { bus.emit(name, r); } } };
  const ctx: any = { cwd: dir, mode: "tui", hasUI: true, isProjectTrusted: () => true, isIdle: () => true, hasPendingMessages: () => false,
    sessionManager: { getSessionFile: () => path, getEntries: () => rawEntries },
    ui: { notify: (s: string) => notices.push(s), setStatus() {}, getEditorText: () => editor,
      onTerminalInput(fn: any) { terminal = fn; return () => { terminal = undefined; }; },
      custom(factory: any) { return new Promise<void>(resolve => {
        component = factory({ requestRender() {}, terminal: { rows: 24 } }, { fg: (_c: string, text: string) => text }, {}, resolve);
      }); } } };
  const status = async () => { const r: any = { protocol: 1, operation: "status" }; bus.emit("pi-session-maintenance:control:v1", r); return r.result; };
  try {
    maintenance(pi); await hooks.get("session_start")!({}, ctx);
    await command.handler("run", ctx); assert.match(notices.at(-1)!, /Started summary immediately/);
    await command.handler("retry", ctx); assert.match(notices.at(-1)!, /already running/); assert.equal(activeSignal!.aborted, false);
    const before = await status();
    for (const char of "/maintenance status") { terminal(char); editor += char; }
    terminal("\r"); await command.handler("status", ctx); editor = "";
    assert.equal(activeSignal!.aborted, false);
    const watching = shortcut.handler(ctx); await new Promise(resolve => setTimeout(resolve, 0));
    terminal("k"); component.handleInput("k"); terminal("f"); component.handleInput("f");
    assert.equal(activeSignal!.aborted, false); assert.equal((await status()).control.cancel_seq, before.control.cancel_seq);
    component.handleInput("\x1b"); await watching;
    assert.deepEqual(command.getArgumentCompletions("hi").map((c: any) => c.value), ["history"]);
    assert.equal(command.getArgumentCompletions("logs"), null);
    for (const char of "/maintenance history") { terminal(char); editor += char; }
    terminal("\r"); editor = "";
    const history = command.handler("history", ctx); await new Promise(resolve => setTimeout(resolve, 0));
    component.render(100); component.handleInput("\r"); assert.match(component.render(100).join("\n"), /Session \(read-only\)/);
    component.handleInput("\x1b"); assert.match(component.render(100).join("\n"), /Maintenance history/);
    component.handleInput("\x1b"); await history;
    assert.equal(activeSignal!.aborted, false); assert.equal((await status()).control.cancel_seq, before.control.cancel_seq);
    terminal("ordinary text"); assert.equal(activeSignal!.aborted, true);
    finish(); await hooks.get("session_shutdown")!();
    assert.equal(terminal, undefined); assert.equal(readFileSync(path, "utf8"), sourceBefore);
  } finally { finish(); await hooks.get("session_shutdown")?.(); rmSync(dir, { recursive: true, force: true }); }
});
