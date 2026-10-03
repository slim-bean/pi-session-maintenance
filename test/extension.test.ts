import assert from "node:assert/strict";
import { test } from "node:test";
import { EventEmitter } from "node:events";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import maintenance from "../src/index.ts";

test("factory is inert; trusted session binds commands/host config; shutdown cancels timers", async () => {
  const dir = mkdtempSync(join(tmpdir(), "maintenance-extension-"));
  const hooks = new Map<string, Function>(); const bus = new EventEmitter(); let command: any;
  const notices: string[] = [];
  const pi: any = {
    on: (name: string, fn: Function) => hooks.set(name, fn), registerCommand: (_name: string, c: any) => { command = c; }, getAllTools: () => [],
    events: { emit: (name: string, r: any) => bus.emit(name, r), on: (name: string, fn: any) => bus.on(name, fn) },
  };
  const ctx: any = { cwd: dir, isProjectTrusted: () => true, isIdle: () => true, hasPendingMessages: () => false,
    mode: "rpc", sessionManager: { getSessionFile: () => join(dir, "not-saved-yet.jsonl") },
    ui: { notify: (text: string) => notices.push(text), setStatus() {} } };
  try {
    maintenance(pi); assert.deepEqual(readdirSync(dir), []);
    mkdirSync(join(dir, ".pi"));
    writeFileSync(join(dir, ".pi/maintenance.json"), JSON.stringify({ enabled: false, stateDir: join(dir, "state") }));
    await hooks.get("session_start")!({}, ctx);
    assert.deepEqual(command.getArgumentCompletions("su").map((a: any) => a.value), ["suspend"]);
    await command.handler("status", ctx); assert.match(notices.at(-1)!, /"enabled": false/);
    const request: any = { protocol: 1, operation: "configure", settings: { enabled: false, idleSeconds: 30, stateDir: join(dir, "state") } };
    bus.emit("pi-session-maintenance:control:v1", request); assert.ok(request.result);
    const status = await request.result; assert.equal(status.config.idleSeconds, 30);
    await hooks.get("session_shutdown")!();
  } finally { await hooks.get("session_shutdown")?.(); rmSync(dir, { recursive: true, force: true }); }
});

test("old installed dependencies fail visibly rather than silently skipping requested work", async () => {
  const dir = mkdtempSync(join(tmpdir(), "maintenance-old-adapter-"));
  const hooks = new Map<string, Function>(); const notices: string[] = [];
  const pi: any = { on: (name: string, fn: Function) => hooks.set(name, fn), registerCommand() {}, getAllTools: () => [{ name: "session_summarize" }], events: { on() {}, emit() {} } };
  try {
    maintenance(pi);
    await hooks.get("session_start")!({}, { cwd: dir, isProjectTrusted: () => true, ui: { notify: (s: string) => notices.push(s) } });
    assert.match(notices[0]!, /Update pi-session-search/);
    assert.deepEqual(readdirSync(dir), []);
  } finally { await hooks.get("session_shutdown")!(); rmSync(dir, { recursive: true, force: true }); }
});
