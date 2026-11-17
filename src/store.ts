import { DatabaseSync } from "node:sqlite";
import { mkdirSync, chmodSync } from "node:fs";
import { join } from "node:path";
import { hostname } from "node:os";
import { randomUUID } from "node:crypto";
import type { Snapshot } from "./source.ts";
import { normalizeRecord, type Issue } from "./issues.ts";
import { processIdentity, type ProcessProbe } from "./process-identity.ts";

export interface Receipt { key: string; hash: string; at: number; detail?: unknown }
export interface RecordState {
  path: string; cwd: string; id: string; name?: string; entryCount?: number; hash: string; seen: number;
  review?: Receipt; summary?: Receipt; compact?: Receipt;
  reviewModel?: string; summaryModel?: string;
  pushPending?: boolean;
  active?: { stage: string; owner: string; pid: number; started: number; progress: string };
  errors?: Partial<Record<"upgrade" | "review" | "summary" | "push" | "compact", Issue>>;
  retryAt: number; failures: number; error?: string;
}
export interface ProcessOwner { pid: number; host: string; incarnation?: string | null; heartbeat?: number | null }
export interface Lease extends ProcessOwner { key: string; token: string; heartbeat: number }
export function alive(pid: number): boolean {
  if (!Number.isSafeInteger(pid) || pid <= 1) return true;
  try { process.kill(pid, 0); return true; }
  catch (error) { return (error as NodeJS.ErrnoException).code !== "ESRCH"; }
}
/** Private durable queue/receipts. Dead local owners only; time never steals a live lease. */
export class Store {
  readonly db: DatabaseSync;
  readonly owner = randomUUID();
  constructor(readonly dir: string, readonly now = Date.now, readonly isAlive = alive, readonly probe: ProcessProbe = processIdentity) {
    mkdirSync(dir, { recursive: true, mode: 0o700 }); chmodSync(dir, 0o700);
    const file = join(dir, "state.db");
    this.db = new DatabaseSync(file); chmodSync(file, 0o600);
    this.db.exec(`PRAGMA busy_timeout=5000; PRAGMA journal_mode=WAL;
      CREATE TABLE IF NOT EXISTS sessions(path TEXT PRIMARY KEY, cwd TEXT NOT NULL, data TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS leases(key TEXT PRIMARY KEY, token TEXT NOT NULL, pid INTEGER NOT NULL, host TEXT NOT NULL, heartbeat INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS controls(cwd TEXT PRIMARY KEY, paused_until INTEGER NOT NULL DEFAULT 0, disabled INTEGER NOT NULL DEFAULT 0);
      CREATE TABLE IF NOT EXISTS spend(day TEXT PRIMARY KEY, cost REAL NOT NULL);
      CREATE TABLE IF NOT EXISTS participants(token TEXT PRIMARY KEY, cwd TEXT NOT NULL, pid INTEGER NOT NULL, host TEXT NOT NULL, busy INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS issue_history(id INTEGER PRIMARY KEY, session_path TEXT NOT NULL, cwd TEXT NOT NULL,
        stage TEXT NOT NULL, resolved_at INTEGER NOT NULL, evidence TEXT NOT NULL, issue TEXT NOT NULL);
    `);
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const columns = this.db.prepare("PRAGMA table_info(controls)").all() as { name: string }[];
      if (!columns.some((c) => c.name === "cancel_seq")) this.db.exec("ALTER TABLE controls ADD COLUMN cancel_seq INTEGER NOT NULL DEFAULT 0");
      if (!columns.some((c) => c.name === "last_activity")) this.db.exec("ALTER TABLE controls ADD COLUMN last_activity INTEGER NOT NULL DEFAULT 0");
      for (const table of ["leases", "participants"]) {
        const fields = this.db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[];
        if (!fields.some(c => c.name === "incarnation")) this.db.exec(`ALTER TABLE ${table} ADD COLUMN incarnation TEXT`);
        if (table === "participants" && !fields.some(c => c.name === "heartbeat")) {
          this.db.exec("ALTER TABLE participants ADD COLUMN heartbeat INTEGER");
          // Preserve actual legacy evidence before a reclaimed lease replaces it.
          // No fabricated timestamp for orphan participants without a lease.
          this.db.exec("UPDATE participants SET heartbeat=(SELECT MAX(heartbeat) FROM leases WHERE leases.token=participants.token)");
        }
      }
      this.db.exec("COMMIT");
    } catch (error) { this.db.exec("ROLLBACK"); this.db.close(); throw error; }
  }
  get(path: string): RecordState | undefined {
    const row = this.db.prepare("SELECT data FROM sessions WHERE path=?").get(path) as { data: string } | undefined;
    return row ? normalizeRecord(JSON.parse(row.data)) : undefined;
  }
  put(record: RecordState) {
    this.db.prepare("INSERT OR REPLACE INTO sessions VALUES(?,?,?)").run(record.path, record.cwd, JSON.stringify(record));
  }
  observe(s: Snapshot): RecordState {
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const previous = this.get(s.path);
      const record: RecordState = previous ? { ...previous, name: s.name, entryCount: s.entries.length, hash: s.hash, seen: this.now(), error: undefined,
        ...(previous.hash !== s.hash ? { retryAt: 0, failures: 0, error: undefined, errors: {} } : {}) }
        : { path: s.path, cwd: s.cwd, id: s.id, name: s.name, entryCount: s.entries.length, hash: s.hash, seen: this.now(), retryAt: 0, failures: 0 };
      this.put(record); this.db.exec("COMMIT"); return record;
    } catch (error) { this.db.exec("ROLLBACK"); throw error; }
  }
  records(cwd: string): RecordState[] {
    return (this.db.prepare("SELECT data FROM sessions WHERE cwd=? ORDER BY path").all(cwd) as { data: string }[]).map((r) => normalizeRecord(JSON.parse(r.data)));
  }
  /** Archive an obsolete blocker only after fresh adapter evidence. Keep all counters,
   * messages and unknown legacy timestamps; never manufacture a work receipt. */
  resolveIssue(record: RecordState, stage: "upgrade" | "review" | "summary" | "push" | "compact", evidence: unknown): boolean {
    const expected = record.errors?.[stage];
    if (!expected) return false;
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const fresh = this.get(record.path);
      const issue = fresh?.errors?.[stage];
      if (!fresh || !issue || JSON.stringify(issue) !== JSON.stringify(expected)) { this.db.exec("COMMIT"); return false; }
      this.db.prepare("INSERT INTO issue_history(session_path,cwd,stage,resolved_at,evidence,issue) VALUES(?,?,?,?,?,?)")
        .run(record.path, record.cwd, stage, this.now(), JSON.stringify(evidence), JSON.stringify(issue));
      delete fresh.errors![stage]; this.put(fresh); record.errors = fresh.errors;
      this.db.exec("COMMIT"); return true;
    } catch (error) { this.db.exec("ROLLBACK"); throw error; }
  }
  resolvedIssues(cwd: string) {
    return this.db.prepare("SELECT stage,resolved_at,evidence,issue,session_path FROM issue_history WHERE cwd=? ORDER BY id DESC LIMIT 20").all(cwd)
      .map((row: any) => ({ stage: row.stage, at: row.resolved_at, path: row.session_path, evidence: JSON.parse(row.evidence), issue: JSON.parse(row.issue) }));
  }
  clearBackoff(cwd: string) {
    this.db.exec("BEGIN IMMEDIATE");
    try {
      for (const record of this.records(cwd)) {
        // Manual retry grants one more attempt to parked jobs; counters/history are kept,
        // so an unchanged failure parks again immediately.
        for (const issue of Object.values(record.errors ?? {})) if (issue) { issue.retryAt = 0; delete issue.parked; }
        this.put(record);
      }
      this.db.exec("COMMIT");
    } catch (error) { this.db.exec("ROLLBACK"); throw error; }
  }
  lease(key: string): Lease | undefined { return this.db.prepare("SELECT * FROM leases WHERE key=?").get(key) as unknown as Lease | undefined; }
  /** Shared by claims, peer activity and every coordinator admission/UI guard.
   * No TTL takeover. A foreign or uninspectable live process remains protected.
   */
  isLive(owner: ProcessOwner): boolean {
    if (owner.host !== hostname()) return true;
    if (!this.isAlive(owner.pid)) return false;
    const current = this.probe(owner.pid);
    if (owner.incarnation) return !current.incarnation || current.incarnation === owner.incarnation;
    // Legacy PID-only records can be identified narrowly when they name THIS
    // process but predate its startup. The margin tolerates startup/clock precision;
    // this is not heartbeat expiry. Other ambiguous legacy owners remain held.
    return !(owner.pid === process.pid && Number.isFinite(current.startedAt) &&
      typeof owner.heartbeat === "number" && Number.isFinite(owner.heartbeat) && owner.heartbeat >= 0 &&
      owner.heartbeat < current.startedAt! - 2_000);
  }
  claim(key: string): boolean {
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const existing = this.lease(key);
      if (existing && existing.token !== this.owner && this.isLive(existing)) {
        this.db.exec("COMMIT"); return false;
      }
      this.db.prepare("INSERT OR REPLACE INTO leases(key,token,pid,host,heartbeat,incarnation) VALUES(?,?,?,?,?,?)")
        .run(key, this.owner, process.pid, hostname(), this.now(), this.probe(process.pid).incarnation ?? null);
      this.db.exec("COMMIT"); return true;
    } catch (error) { this.db.exec("ROLLBACK"); throw error; }
  }
  owns(key: string): boolean { return this.lease(key)?.token === this.owner; }
  release(key: string) { this.db.prepare("DELETE FROM leases WHERE key=? AND token=?").run(key, this.owner); }
  heartbeat() { this.db.prepare("UPDATE leases SET heartbeat=? WHERE token=?").run(this.now(), this.owner); }
  control(cwd: string): { paused_until: number; disabled: number; cancel_seq: number; last_activity: number } {
    return this.db.prepare("SELECT paused_until,disabled,cancel_seq,last_activity FROM controls WHERE cwd=?").get(cwd) as any ?? { paused_until: 0, disabled: 0, cancel_seq: 0, last_activity: 0 };
  }
  setControl(cwd: string, pauseUntil: number, disabled: boolean) {
    this.db.prepare("INSERT INTO controls(cwd,paused_until,disabled) VALUES(?,?,?) ON CONFLICT(cwd) DO UPDATE SET paused_until=excluded.paused_until,disabled=excluded.disabled").run(cwd, pauseUntil, disabled ? 1 : 0);
  }
  interrupt(cwd: string) {
    this.db.prepare("INSERT INTO controls(cwd,cancel_seq,last_activity) VALUES(?,1,?) ON CONFLICT(cwd) DO UPDATE SET cancel_seq=cancel_seq+1,last_activity=excluded.last_activity").run(cwd, this.now());
  }
  presence(cwd: string, busy: boolean) {
    this.db.prepare("INSERT OR REPLACE INTO participants(token,cwd,pid,host,busy,incarnation,heartbeat) VALUES(?,?,?,?,?,?,?)")
      .run(this.owner, cwd, process.pid, hostname(), busy ? 1 : 0, this.probe(process.pid).incarnation ?? null, this.now());
  }
  otherBusy(cwd: string): boolean {
    const rows = this.db.prepare("SELECT pid,host,incarnation,heartbeat FROM participants WHERE cwd=? AND token!=? AND busy=1").all(cwd, this.owner) as unknown as ProcessOwner[];
    return rows.some(r => this.isLive(r));
  }
  day() { return new Date(this.now()).toISOString().slice(0, 10); }
  spent(): number { return (this.db.prepare("SELECT cost FROM spend WHERE day=?").get(this.day()) as { cost: number } | undefined)?.cost ?? 0; }
  account(cost: number) {
    if (!Number.isFinite(cost) || cost < 0) throw new Error("Invalid maintenance cost");
    this.db.prepare("INSERT INTO spend VALUES(?,?) ON CONFLICT(day) DO UPDATE SET cost=cost+excluded.cost").run(this.day(), cost);
  }
  close() {
    this.db.prepare("DELETE FROM leases WHERE token=?").run(this.owner);
    this.db.prepare("DELETE FROM participants WHERE token=?").run(this.owner);
    this.db.close();
  }
}
