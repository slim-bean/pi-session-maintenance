import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtempSync, rmSync, readFileSync, existsSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SessionManager } from "@earendil-works/pi-coding-agent";
import { DailyRotation, dateName, ROTATION_ENTRY } from "../src/rotation.ts";
import { parseConfig } from "../src/config.ts";

function fixture() {
  const dir = mkdtempSync(join(tmpdir(), "daily-rotation-"));
  let clock = Date.parse("2026-10-13T23:59:50Z");
  let manager = SessionManager.create(dir, join(dir, "sessions"));
  manager.appendMessage({ role: "user", content: "Keep the original conversation intact.", timestamp: clock });
  // Native header uses wall-clock time. Tests set only their temp header timestamp
  // through the read-only mock so calendar boundaries don't depend on test date.
  let created = clock;
  const context: any = { cwd: dir, mode: "rpc", isIdle: () => true, hasPendingMessages: () => false,
    sessionManager: { getHeader: () => ({ timestamp: new Date(created).toISOString() }), getSessionId: () => manager.getSessionId(),
      getSessionFile: () => manager.getSessionFile(), getSessionName: () => manager.getSessionName(), getEntries: () => manager.getEntries() },
    ui: { notify: (...args: any[]) => notices.push(args) }, model: { provider: "fake", id: "offline" }, modelRegistry: { find: () => ({ provider: "fake", id: "offline" }) } };
  let blocked: string | undefined; let held = false; let cancelled = false; let switches = 0;
  const commands: string[] = [], notices: any[] = [], backlog: string[] = [];
  let source: any = { kind: "host" };
  const coordinator: any = { config: parseConfig({ sessionRotation: { enabled: true }, stateDir: join(dir, "state") }, dir),
    rotationBlocker: () => blocked, prepareRotation: () => {
      if (blocked || held) return undefined; held = true;
      return { check: () => blocked, release: () => { held = false; } };
    }, enqueue: (path: string) => backlog.push(path), status: () => ({ configSource: source }),
    configure: async (config: any, nextSource: any) => { coordinator.config = config; source = nextSource; } };
  const pi: any = { appendEntry: (type: string, data: any) => manager.appendCustomEntry(type, data), setSessionName: (name: string) => manager.appendSessionInfo(name),
    getThinkingLevel: () => "medium", setThinkingLevel() {}, setModel: async () => true,
    sendUserMessage: (command: string, options: any) => { assert.equal(options.expandPromptTemplates, true); commands.push(command); } };
  const rotator = new DailyRotation(pi, () => ({ coordinator, context, monitorOpen: false }), () => clock);
  context.newSession = async (options: any) => {
    if (cancelled) return { cancelled: true };
    switches++; rotator.close();
    manager = SessionManager.create(dir, join(dir, "sessions")); manager.newSession({ parentSession: options.parentSession }); created = clock;
    await options.setup(manager);
    source = { kind: "workspace-file" };
    await options.withSession({ ...context, sendUserMessage: async (command: string, options: any) => {
      assert.equal(command, "/maintenance rotation-restore"); assert.equal(options.expandPromptTemplates, true); await rotator.restore(context);
    } });
    return { cancelled: false };
  };
  return { dir, context, coordinator, pi, rotator, commands, notices, backlog,
    get manager() { return manager; }, get held() { return held; }, get switches() { return switches; },
    set blocked(value: string | undefined) { blocked = value; }, set cancelled(value: boolean) { cancelled = value; },
    advance(ms: number) { clock += ms; }, async dispatch() { await new Promise(resolve => setTimeout(resolve, 5)); const command = commands.pop(); assert.ok(command); return rotator.execute(context, command.split(" ")[2]); },
    close() { rotator.close(); rmSync(dir, { recursive: true, force: true }); } };
}

test("daily dates are stable across UTC, local calendars and DST boundaries", () => {
  assert.equal(dateName(Date.parse("2026-10-14T00:15:00Z"), "UTC"), "2026-10-14");
  assert.equal(dateName(Date.parse("2026-10-14T00:15:00Z"), "America/New_York"), "2026-10-13");
  assert.equal(dateName(Date.parse("2026-03-08T06:59:00Z"), "America/New_York"), "2026-03-08");
  assert.equal(dateName(Date.parse("2026-03-08T07:01:00Z"), "America/New_York"), "2026-03-08");
  assert.throws(() => dateName(NaN, "UTC"), /valid session date/);
});

test("rotation is opt-in and rejects unknown settings/time zones", () => {
  assert.deepEqual(parseConfig({}, "/workspace").sessionRotation, { enabled: false, timeZone: "UTC" });
  for (const sessionRotation of [true, [], { enabled: "yes" }, { timeZone: "not/a-zone" }, { timeZone: "" }, { typo: 1 }]) assert.throws(() => parseConfig({ sessionRotation }, "/workspace"));
  assert.equal(parseConfig({ sessionRotation: { enabled: true, timeZone: "local" } }, "/workspace").sessionRotation.timeZone, "local");
  const f = fixture();
  try { f.coordinator.config.sessionRotation.enabled = false; assert.equal(f.rotator.poll(), false); assert.equal(f.manager.getSessionName(), undefined); assert.deepEqual(f.commands, []); }
  finally { f.close(); }
});

test("adopts the creation-date name and rotates once after midnight without a model call or lost history", async () => {
  const f = fixture();
  try {
    f.rotator.poll(); assert.equal(f.manager.getSessionName(), "2026-10-13");
    const previous = f.manager.getSessionFile()!; const before = readFileSync(previous, "utf8");
    f.advance(20_000); assert.equal(f.rotator.poll(), true); assert.equal(f.held, true);
    assert.equal(f.rotator.poll(), true); assert.equal(await f.dispatch(), "Daily session started: 2026-10-14.");
    assert.equal(f.switches, 1); assert.equal(f.manager.getSessionName(), "2026-10-14");
    assert.equal(f.manager.getHeader()!.parentSession, previous); assert.deepEqual(f.backlog, [previous]);
    assert.equal(readFileSync(previous, "utf8"), before); assert.equal(f.rotator.poll(), false);
    assert.equal(f.manager.getEntries().filter(e => e.type === "custom" && e.customType === ROTATION_ENTRY).length, 1);
    // Metadata alone does not force a fake conversation into the new session.
    assert.equal(existsSync(f.manager.getSessionFile()!), false);
  } finally { f.close(); }
});

test("busy work/drafts/peers delay naming and switching, and input arriving after dispatch admission cancels it", async () => {
  const f = fixture();
  try {
    f.advance(20_000);
    for (const blocker of ["foreground work", "unsent draft", "peer", "unresolved tools", "settings editor"]) {
      f.blocked = blocker; assert.equal(f.rotator.poll(), false); assert.equal(f.manager.getSessionName(), undefined);
    }
    f.blocked = undefined; f.rotator.poll(); f.blocked = "foreground activity changed";
    assert.match(await f.dispatch(), /deferred/); assert.equal(f.switches, 0); assert.equal(f.held, false);
    f.blocked = undefined; f.rotator.poll(); await f.dispatch(); assert.equal(f.switches, 1);
  } finally { f.close(); }
});

test("stale tokens/manual switching cannot act on a replacement session", async () => {
  const f = fixture();
  try {
    f.advance(20_000); f.rotator.poll();
    assert.equal(await f.rotator.execute(f.context, "wrong-token"), "Stale rotation request ignored.");
    f.rotator.close(); assert.equal(f.held, false); assert.deepEqual(f.commands, []);
  } finally { f.close(); }
});

test("switch veto releases ownership and retries with backoff; missed days create only today's session", async () => {
  const f = fixture();
  try {
    f.advance(3 * 86400_000); f.cancelled = true; f.rotator.poll();
    assert.match(await f.dispatch(), /cancelled/); assert.equal(f.held, false); assert.equal(f.switches, 0);
    assert.equal(f.rotator.poll(), false);
    f.cancelled = false; f.advance(60_001); f.rotator.poll(); await f.dispatch();
    assert.equal(f.switches, 1); assert.equal(f.manager.getSessionName(), "2026-10-17");
  } finally { f.close(); }
});

test("runtime-only settings carry forward, but changed workspace settings win", async () => {
  const f = fixture();
  try {
    f.coordinator.config.idleSeconds = 123; f.advance(20_000); f.rotator.poll(); await f.dispatch();
    assert.equal(f.coordinator.config.idleSeconds, 123);
    const record: any = f.manager.getEntries().find(e => e.type === "custom" && e.customType === ROTATION_ENTRY);
    mkdirSync(join(f.dir, ".pi")); writeFileSync(join(f.dir, ".pi/maintenance.json"), JSON.stringify({ idleSeconds: 999 }));
    f.coordinator.config.idleSeconds = 999; await f.rotator.restore(f.context);
    assert.equal(f.coordinator.config.idleSeconds, 999); assert.ok(record.data.carry);
  } finally { f.close(); }
});

test("clock rollback cannot create a backwards rotation", () => {
  const f = fixture();
  try { f.rotator.poll(); f.advance(-86400_000); assert.equal(f.rotator.poll(), false); assert.equal(f.switches, 0); assert.equal(f.manager.getSessionName(), "2026-10-13"); }
  finally { f.close(); }
});
