import { DatabaseSync } from "node:sqlite";
import { mkdirSync, chmodSync } from "node:fs";
import { join } from "node:path";
import { hostname } from "node:os";
import { randomUUID } from "node:crypto";
import type { Snapshot } from "./source.ts";

export interface Receipt { key: string; hash: string; at: number; detail?: unknown }
export interface RecordState {
  path: string; cwd: string; id: string; hash: string; seen: number;
  review?: Receipt; summary?: Receipt; compact?: Receipt;
  pushPending?: boolean;
  errors?: Partial<Record<"upgrade" | "review" | "summary" | "push" | "compact", { failures: number; retryAt: number; error: string }>>;
  retryAt: number; failures: number; error?: string;
}
export interface Lease { key: string; token: string; pid: number; host: string; heartbeat: number }
export function alive(pid: number): boolean {
  if (!Number.isSafeInteger(pid) || pid <= 1) return true;
  try { process.kill(pid, 0); return true; }
  catch (error) { return (error as NodeJS.ErrnoException).code !== "ESRCH"; }
}
/** Private durable queue/receipts. Dead local owners only; time never steals a live lease. */
export class Store {
  readonly db: DatabaseSync;
  readonly owner = randomUUID();
  constructor(readonly dir: string, readonly now = Date.now, readonly isAlive = alive) {
    mkdirSync(dir, { recursive: true, mode: 0o700 }); chmodSync(dir, 0o700);
    const file = join(dir, "state.db");
    this.db = new DatabaseSync(file); chmodSync(file, 0o600);
    this.db.exec(`PRAGMA busy_timeout=5000; PRAGMA journal_mode=WAL;
      CREATE TABLE IF NOT EXISTS sessions(path TEXT PRIMARY KEY, cwd TEXT NOT NULL, data TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS leases(key TEXT PRIMARY KEY, token TEXT NOT NULL, pid INTEGER NOT NULL, host TEXT NOT NULL, heartbeat INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS controls(cwd TEXT PRIMARY KEY, paused_until INTEGER NOT NULL DEFAULT 0, disabled INTEGER NOT NULL DEFAULT 0);
      CREATE TABLE IF NOT EXISTS spend(day TEXT PRIMARY KEY, cost REAL NOT NULL);
    `);
  }
  get(path: string): RecordState | undefined {
    const row = this.db.prepare("SELECT data FROM sessions WHERE path=?").get(path) as { data: string } | undefined;
    return row ? JSON.parse(row.data) : undefined;
  }
  put(record: RecordState) {
    this.db.prepare("INSERT OR REPLACE INTO sessions VALUES(?,?,?)").run(record.path, record.cwd, JSON.stringify(record));
  }
  observe(s: Snapshot): RecordState {
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const previous = this.get(s.path);
      const record: RecordState = previous ? { ...previous, hash: s.hash, seen: this.now(), error: undefined,
        ...(previous.hash !== s.hash ? { retryAt: 0, failures: 0, error: undefined, errors: {} } : {}) }
        : { path: s.path, cwd: s.cwd, id: s.id, hash: s.hash, seen: this.now(), retryAt: 0, failures: 0 };
      this.put(record); this.db.exec("COMMIT"); return record;
    } catch (error) { this.db.exec("ROLLBACK"); throw error; }
  }
  records(cwd: string): RecordState[] {
    return (this.db.prepare("SELECT data FROM sessions WHERE cwd=? ORDER BY path").all(cwd) as { data: string }[]).map((r) => JSON.parse(r.data));
  }
  lease(key: string): Lease | undefined { return this.db.prepare("SELECT * FROM leases WHERE key=?").get(key) as unknown as Lease | undefined; }
  claim(key: string): boolean {
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const existing = this.lease(key);
      if (existing && existing.token !== this.owner && (existing.host !== hostname() || this.isAlive(existing.pid))) {
        this.db.exec("COMMIT"); return false;
      }
      this.db.prepare("INSERT OR REPLACE INTO leases VALUES(?,?,?,?,?)").run(key, this.owner, process.pid, hostname(), this.now());
      this.db.exec("COMMIT"); return true;
    } catch (error) { this.db.exec("ROLLBACK"); throw error; }
  }
  owns(key: string): boolean { return this.lease(key)?.token === this.owner; }
  release(key: string) { this.db.prepare("DELETE FROM leases WHERE key=? AND token=?").run(key, this.owner); }
  heartbeat() { this.db.prepare("UPDATE leases SET heartbeat=? WHERE token=?").run(this.now(), this.owner); }
  control(cwd: string): { paused_until: number; disabled: number } {
    return this.db.prepare("SELECT paused_until,disabled FROM controls WHERE cwd=?").get(cwd) as any ?? { paused_until: 0, disabled: 0 };
  }
  setControl(cwd: string, pauseUntil: number, disabled: boolean) {
    this.db.prepare("INSERT OR REPLACE INTO controls VALUES(?,?,?)").run(cwd, pauseUntil, disabled ? 1 : 0);
  }
  day() { return new Date(this.now()).toISOString().slice(0, 10); }
  spent(): number { return (this.db.prepare("SELECT cost FROM spend WHERE day=?").get(this.day()) as { cost: number } | undefined)?.cost ?? 0; }
  account(cost: number) {
    if (!Number.isFinite(cost) || cost < 0) throw new Error("Invalid maintenance cost");
    this.db.prepare("INSERT INTO spend VALUES(?,?) ON CONFLICT(day) DO UPDATE SET cost=cost+excluded.cost").run(this.day(), cost);
  }
  close() {
    this.db.prepare("DELETE FROM leases WHERE token=?").run(this.owner);
    this.db.close();
  }
}
