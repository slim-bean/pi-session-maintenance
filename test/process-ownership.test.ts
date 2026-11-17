import assert from "node:assert/strict";
import { test } from "node:test";
import { DatabaseSync } from "node:sqlite";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdtempSync, rmSync } from "node:fs";
import { hostname, tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { processIdentity, startTicks } from "../src/process-identity.ts";
import { Store } from "../src/store.ts";

function fixture(incarnation: string | undefined = "current") {
  const dir = mkdtempSync(join(tmpdir(), "maintenance-pid-reuse-"));
  const store = new Store(dir, () => 100_000, () => true, () => ({ incarnation, startedAt: 50_000 }));
  const seed = (key: string, identity: string | null, heartbeat = 10, host = hostname(), pid = process.pid) => {
    store.db.prepare("INSERT OR REPLACE INTO leases(key,token,pid,host,heartbeat,incarnation) VALUES(?,?,?,?,?,?)")
      .run(key, "previous", pid, host, heartbeat, identity);
  };
  return { store, seed, close() { store.close(); rmSync(dir, { recursive: true, force: true }); } };
}

test("PID reuse recovers both session and executor leases; delayed old cleanup cannot erase the successor", () => {
  const f = fixture();
  try {
    for (const key of ["session:fixture", "executor:cwd"]) {
      f.seed(key, "previous-incarnation");
      assert.equal(f.store.claim(key), true);
      assert.equal(f.store.lease(key)!.incarnation, "current");
      // The old process's token-scoped release/close cannot remove the new owner.
      f.store.db.prepare("DELETE FROM leases WHERE key=? AND token=?").run(key, "previous");
      assert.equal(f.store.owns(key), true);
    }
  } finally { f.close(); }
});

test("live matching, foreign and unreadable owners are protected regardless of heartbeat age", () => {
  const f = fixture();
  try {
    f.seed("matching", "current", 0); assert.equal(f.store.claim("matching"), false);
    f.seed("foreign", "old", 0, "other-host"); assert.equal(f.store.claim("foreign"), false);
    f.seed("foreign-dead", "old", 0, "other-host", 987654); assert.equal(f.store.claim("foreign-dead"), false);
    const unknown = new Store(f.store.dir, () => 999_999_999, () => true, () => ({}));
    try { assert.equal(unknown.claim("matching"), false); } finally { unknown.close(); }
  } finally { f.close(); }
});

test("legacy own-PID leases predating process birth recover, not recently written or ambiguous legacy rows", () => {
  const f = fixture();
  try {
    f.seed("old", null, 10); assert.equal(f.store.claim("old"), true);
    f.seed("recent", null, 50_001); assert.equal(f.store.claim("recent"), false);
    f.seed("precision", null, 49_000); assert.equal(f.store.claim("precision"), false);
    f.seed("other-pid", null, 10, hostname(), process.pid + 100); assert.equal(f.store.claim("other-pid"), false);
    const unknown = new Store(f.store.dir, () => 100_000, () => true, () => ({}));
    try { f.seed("unknown", null, 10); assert.equal(unknown.claim("unknown"), false); } finally { unknown.close(); }
  } finally { f.close(); }
});

test("busy participants use incarnation checks too; live, foreign and unknown participants still block", () => {
  const f = fixture();
  const seed = (identity: string | null, host = hostname(), heartbeat: number | null = 10) => {
    f.store.db.prepare("INSERT OR REPLACE INTO participants(token,cwd,pid,host,busy,incarnation,heartbeat) VALUES(?,?,?,?,?,?,?)")
      .run("peer", "cwd", process.pid, host, 1, identity, heartbeat);
  };
  try {
    seed("previous"); assert.equal(f.store.otherBusy("cwd"), false);
    seed("current"); assert.equal(f.store.otherBusy("cwd"), true);
    seed("previous", "other-host"); assert.equal(f.store.otherBusy("cwd"), true);
    seed(null); assert.equal(f.store.otherBusy("cwd"), false);
    seed(null, hostname(), null); assert.equal(f.store.otherBusy("cwd"), true);
    f.store.presence("cwd", true);
    const row = f.store.db.prepare("SELECT incarnation,heartbeat FROM participants WHERE token=?").get(f.store.owner);
    assert.deepEqual({ ...row }, { incarnation: "current", heartbeat: 100_000 });
  } finally { f.close(); }
});

test("old database migration preserves receipts/controls/spend and derives only evidenced legacy participant timestamps", () => {
  const dir = mkdtempSync(join(tmpdir(), "maintenance-old-schema-"));
  const old = new DatabaseSync(join(dir, "state.db"));
  old.exec(`CREATE TABLE leases(key TEXT PRIMARY KEY,token TEXT NOT NULL,pid INTEGER NOT NULL,host TEXT NOT NULL,heartbeat INTEGER NOT NULL);
    CREATE TABLE participants(token TEXT PRIMARY KEY,cwd TEXT NOT NULL,pid INTEGER NOT NULL,host TEXT NOT NULL,busy INTEGER NOT NULL);
    CREATE TABLE controls(cwd TEXT PRIMARY KEY,paused_until INTEGER NOT NULL DEFAULT 0,disabled INTEGER NOT NULL DEFAULT 0);
    CREATE TABLE spend(day TEXT PRIMARY KEY,cost REAL NOT NULL);
    CREATE TABLE sessions(path TEXT PRIMARY KEY,cwd TEXT NOT NULL,data TEXT NOT NULL);`);
  old.prepare("INSERT INTO leases VALUES(?,?,?,?,?)").run("session:x", "previous", process.pid, hostname(), 10);
  old.prepare("INSERT INTO participants VALUES(?,?,?,?,?)").run("previous", "cwd", process.pid, hostname(), 1);
  old.prepare("INSERT INTO participants VALUES(?,?,?,?,?)").run("orphan", "orphan-cwd", process.pid, hostname(), 1);
  old.exec("INSERT INTO controls VALUES('cwd',123,1); INSERT INTO spend VALUES('2026-01-01',0.5)");
  const record = { path: "x", cwd: "cwd", id: "x", hash: "hash", seen: 1, retryAt: 0, failures: 0, review: { key: "review", hash: "hash", at: 1 } };
  old.prepare("INSERT INTO sessions VALUES(?,?,?)").run("x", "cwd", JSON.stringify(record)); old.close();
  const store = new Store(dir, () => 100_000, () => true, () => ({ incarnation: "current", startedAt: 50_000 }));
  try {
    assert.equal(store.otherBusy("cwd"), false);
    assert.equal(store.otherBusy("orphan-cwd"), true);
    assert.equal(store.claim("session:x"), true);
    assert.deepEqual(store.get("x")!.review, record.review);
    assert.deepEqual({ ...store.control("cwd") }, { paused_until: 123, disabled: 1, cancel_seq: 0, last_activity: 0 });
    assert.equal(store.db.prepare("SELECT cost FROM spend").get()!.cost, 0.5);
    const reopened = new Store(dir); reopened.close(); // migration is idempotent
  } finally { store.close(); rmSync(dir, { recursive: true, force: true }); }
});

test("real Linux child owner survives ancient heartbeats and recovers only after process exit", { skip: process.platform !== "linux", timeout: 10_000 }, async () => {
  const dir = mkdtempSync(join(tmpdir(), "maintenance-live-owner-"));
  const child = spawn(process.execPath, ["--import", "tsx", "--input-type=module", "-e",
    `import {Store} from './src/store.ts'; const s=new Store(${JSON.stringify(dir)}); s.claim('session:x'); console.log('ready'); setInterval(()=>{},1000);`],
    { cwd: resolve(import.meta.dirname, ".."), stdio: ["ignore", "pipe", "pipe"] });
  const exited = once(child, "exit");
  let store: Store | undefined;
  try {
    const ready = await Promise.race([
      once(child.stdout!, "data", { signal: AbortSignal.timeout(5_000) }),
      exited.then(() => { throw new Error("Owner fixture exited before readiness"); }),
    ]);
    assert.match(String(ready[0]), /ready/);
    store = new Store(dir);
    store.db.prepare("UPDATE leases SET heartbeat=0").run();
    assert.equal(store.claim("session:x"), false);
    child.kill("SIGKILL"); await exited;
    assert.equal(store.claim("session:x"), true);
  } finally {
    if (child.exitCode === null && child.signalCode === null) { child.kill("SIGKILL"); await exited; }
    store?.close(); rmSync(dir, { recursive: true, force: true });
  }
});

test("proc stat parsing tolerates complex command names and rejects missing/invalid birth identifiers", () => {
  const stat = (comm: string, ticks: string) => `73 (${comm}) S ${Array(18).fill("0").join(" ")} ${ticks} 0 0`;
  for (const comm of ["pi", "pi worker", "pi (worker) )"]) assert.equal(startTicks(stat(comm, "987654321")), "987654321");
  for (const value of ["", "no stat", stat("pi", "0"), stat("pi", "oops"), "73 (pi) S"]) assert.equal(startTicks(value), undefined);
  const identity = processIdentity(process.pid);
  assert.ok(identity.startedAt! > 0 && identity.startedAt! <= Date.now());
  if (process.platform === "linux") assert.match(identity.incarnation!, /^linux:.*:pid:\[[0-9]+\]:[0-9]+$/);
  assert.equal(processIdentity(0).incarnation, undefined);
});
