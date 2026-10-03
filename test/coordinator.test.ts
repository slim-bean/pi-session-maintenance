import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtempSync, writeFileSync, rmSync, readFileSync, realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Coordinator } from "../src/coordinator.ts";
import { parseConfig } from "../src/config.ts";
import { Store } from "../src/store.ts";

async function fixture(options: any = {}) {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), "maintenance-flow-")));
  let clock = 1000; let idle = true; let pending = false; let upgraded = false; let tokens = 60000;
  const path = join(dir, "session.jsonl");
  const entries: any[] = [{ type: "message", id: "a", parentId: null, message: { role: "user", content: "a useful decision" } }];
  const save = (target = path) => writeFileSync(target, [{ type: "session", id: target, cwd: dir }, ...entries].map((e) => JSON.stringify(e)).join("\n") + "\n");
  save();
  const calls: string[] = [];
  const notifications: string[] = [];
  const ctx: any = { cwd: dir, isIdle: () => idle, hasPendingMessages: () => pending,
    getContextUsage: () => ({ tokens }), abort() {},
    sessionManager: { getSessionFile: () => path, getEntries: () => entries },
    ui: { setStatus() {}, notify(text: string) { notifications.push(text); } },
    compact({ onComplete }: any) { calls.push("compact"); writeFileSync(path, JSON.stringify({ type: "compaction", summary: "metadata" }) + "\n", { flag: "a" }); onComplete(); },
  };
  const bus = { emit(channel: string, r: any) {
    if (channel === "pi-session-maintenance:capabilities:v1") {
      if (options.memory !== false) r.capabilities.memory = { protocol: 1, channel: "memory" };
      if (options.summary !== false) r.capabilities.summary = { protocol: 1, channel: "summary" };
      return;
    }
    if (r.operation === "status") {
      r.result = Promise.resolve(channel === "memory" ? { available: true, upgraded, key: "memory:1" } : { key: "summary:1", complete: false }); return;
    }
    calls.push(r.operation);
    r.assertSource();
    r.result = Promise.resolve().then(() => {
      if (options.fail === r.operation) throw new Error("synthetic failure");
      if (r.operation === "upgrade") upgraded = true;
      r.onUsage({ cost: { total: options.cost ?? 0.01 } });
      return { key: channel === "memory" ? "memory:1" : "summary:1", complete: true };
    });
  } };
  const config = parseConfig({ idleSeconds: 1, stateDir: join(dir, "state"), compaction: { enabled: true, minTokens: 0 }, ...options.config }, dir);
  const store = new Store(config.stateDir, () => clock);
  const c = new Coordinator(bus, store, config, () => clock);
  await c.attach(ctx);
  return { c, ctx, store, calls, dir, path, entries, save, notifications, bus,
    set idle(v: boolean) { idle = v; }, set pending(v: boolean) { pending = v; }, set tokens(v: number) { tokens = v; },
    advance(ms = 2000) { clock += ms; }, async close() { await c.close(); rmSync(dir, { recursive: true, force: true }); } };
}

test("idle flow upgrades, reviews, summarizes, compacts once; resumed conversation becomes dirty", async () => {
  const f = await fixture();
  try {
    await f.c.tick(); assert.deepEqual(f.calls, []);
    f.advance();
    for (let i = 0; i < 5; i++) await f.c.tick();
    assert.deepEqual(f.calls, ["upgrade", "review", "run", "compact"]);
    const before = readFileSync(f.path, "utf8");
    await f.c.tick(); assert.equal(readFileSync(f.path, "utf8"), before);
    f.entries.push({ type: "compaction", summary: "metadata" });
    f.entries.push({ type: "message", id: "b", parentId: "a", message: { role: "user", content: "a correction" } });
    f.save(); f.c.activity(); await f.c.tick(); assert.equal(f.calls.length, 4);
    f.advance(); await f.c.tick(); assert.equal(f.calls.at(-1), "review");
  } finally { await f.close(); }
});

test("missing optional packages skip their stages; archives never compact", async () => {
  const f = await fixture({ memory: false });
  try {
    const archive = join(f.dir, "archive.jsonl"); f.save(archive); f.c.enqueue(archive);
    f.advance(); for (let i = 0; i < 5; i++) await f.c.tick();
    assert.deepEqual(f.calls, ["run", "compact", "run"]);
    assert.equal(readFileSync(archive, "utf8").includes("compaction"), false);
  } finally { await f.close(); }
});

test("pending input, suspension, off and ownership observers never run work", async () => {
  const f = await fixture();
  const otherStore = new Store(f.c.config.stateDir);
  const other = new Coordinator(f.bus, otherStore, f.c.config);
  try {
    await other.attach(f.ctx); other.requestRun(); await other.tick(); assert.deepEqual(f.calls, []);
    assert.ok(f.notifications.some((text) => text.includes("another pi")));
    f.advance(); f.pending = true; await f.c.tick(); assert.deepEqual(f.calls, []);
    f.pending = false; f.c.suspend(100); f.advance(); await f.c.tick(); assert.deepEqual(f.calls, []);
    f.c.resume(); f.advance(); f.c.off(); await f.c.tick(); assert.deepEqual(f.calls, []);
    f.c.on(); f.advance(); await f.c.tick(); assert.equal(f.calls[0], "upgrade");
  } finally { await other.close(); await f.close(); }
});

test("failed knowledge does not prevent summaries; daily budget bounds further model work", async () => {
  const f = await fixture({ fail: "review", config: { dailyBudget: 0.02, compaction: { enabled: false } } });
  try {
    f.advance(); await f.c.tick(); await f.c.tick(); await f.c.tick();
    assert.deepEqual(f.calls, ["upgrade", "review", "run"]);
    assert.match(f.store.get(f.path)!.errors!.review!.error, /synthetic/);
    await f.c.tick(); assert.equal(f.calls.length, 3);
  } finally { await f.close(); }
});

test("foreground cancellation retains ownership until the actual background operation exits", async () => {
  const f = await fixture({ memory: false, config: { compaction: { enabled: false } } });
  let started!: () => void; let finish!: () => void;
  const ready = new Promise<void>((r) => { started = r; });
  const done = new Promise<void>((r) => { finish = r; });
  const original = f.bus.emit;
  f.bus.emit = (channel, r) => {
    if (channel === "summary" && r.operation === "run") {
      r.result = (async () => { started(); await done; r.signal.throwIfAborted(); return { key: "summary:1", complete: true }; })();
    } else original(channel, r);
  };
  try {
    f.advance(); const tick = f.c.tick(); await ready; f.c.activity();
    assert.equal(f.store.owns("executor:" + f.dir), true);
    assert.equal(f.store.get(f.path)!.summary, undefined);
    finish(); await tick;
    assert.equal(f.store.owns("executor:" + f.dir), false);
    assert.equal(f.store.get(f.path)!.summary, undefined);
  } finally { finish(); await f.close(); }
});

test("default maintenance models are pinned, rather than changing with foreground model switches", async () => {
  const f = await fixture({ memory: false, config: { compaction: { enabled: false } } });
  try {
    f.ctx.model = { provider: "fake", id: "first" };
    f.advance(); await f.c.tick();
    assert.equal(f.store.get(f.path)!.summaryModel, "fake/first");
    f.ctx.model = { provider: "fake", id: "second" };
    await f.c.tick();
    assert.equal(f.store.get(f.path)!.summaryModel, "fake/first");
    assert.deepEqual(f.calls, ["run"]);
  } finally { await f.close(); }
});

test("another window can preempt owned background work and see its progress", async () => {
  const f = await fixture({ memory: false, config: { compaction: { enabled: false } } });
  const peerStore = new Store(f.c.config.stateDir, f.c.now);
  const peer = new Coordinator(f.bus, peerStore, f.c.config, f.c.now);
  let started!: () => void; let finish!: () => void;
  const ready = new Promise<void>((r) => { started = r; });
  const done = new Promise<void>((r) => { finish = r; });
  const original = f.bus.emit;
  f.bus.emit = (channel, r) => {
    if (channel === "summary" && r.operation === "run") {
      r.result = (async () => { r.onProgress("summary in progress"); started(); await done; r.signal.throwIfAborted(); return { key: "summary:1", complete: true }; })();
    } else original(channel, r);
  };
  try {
    await peer.attach(f.ctx);
    f.advance(); const tick = f.c.tick(); await ready;
    assert.equal(peerStore.get(f.path)!.active!.progress, "summary in progress");
    peer.activity(); f.c.poll();
    assert.equal(f.store.owns("executor:" + f.dir), true);
    finish(); await tick;
    assert.equal(f.store.get(f.path)!.summary, undefined);
    assert.equal(peerStore.get(f.path)!.active, undefined);
  } finally { finish(); await peer.close(); await f.close(); }
});

test("leaving a session queues content written since its last maintenance tick", async () => {
  const f = await fixture();
  try {
    const before = f.store.get(f.path)!.hash;
    f.entries.push({ type: "message", id: "new", message: { role: "user", content: "last topic before /new" } });
    f.save();
    await f.c.close();
    const reopened = new Store(f.c.config.stateDir);
    assert.notEqual(reopened.get(f.path)!.hash, before);
    assert.equal(reopened.records(f.dir).length, 1);
    assert.equal(reopened.lease("session:" + f.path), undefined);
    reopened.close();
    assert.deepEqual(f.calls, []);
  } finally { rmSync(f.dir, { recursive: true, force: true }); }
});

test("compaction refuses a stale in-memory view and budget compaction takes priority", async () => {
  const f = await fixture({ config: { compaction: { enabled: true, minTokens: 0, budgetTokens: 50000 } } });
  try {
    await f.c.tick(); assert.deepEqual(f.calls, ["compact"]);
    f.entries.push({ type: "message", id: "extra", message: { role: "user", content: "unflushed" } });
    await f.c.tick(); assert.equal(f.calls.length, 1);
    assert.match(f.store.get(f.path)!.errors!.compact!.error, /in-memory/);
  } finally { await f.close(); }
});
