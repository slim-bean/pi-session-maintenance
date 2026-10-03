import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { join, resolve } from "node:path";
import { existsSync, realpathSync } from "node:fs";
import { type Config } from "./config.ts";
import { hash, projectEntries, snapshot, type Snapshot } from "./source.ts";
import { discover, invoke, type Bus, type TaskRequest } from "./protocol.ts";
import { Store, type RecordState } from "./store.ts";
import { unresolvedTools } from "./pairing.ts";

type Stage = "upgrade" | "review" | "summary" | "push" | "compact";
export class Coordinator {
  private ctx?: ExtensionContext;
  private current?: string;
  private lastActivity: number;
  private force = false;
  private localHolds = 0;
  private running?: { stage: Stage; path: string; abort: AbortController; promise: Promise<void>; cancelSeq: number };
  private tickRunning = false;
  private generation = 0;
  private closed = false;
  private closing?: Promise<void>;
  private timer?: ReturnType<typeof setInterval>;
  private compactStart?: number;
  private progress = "waiting for idle";
  constructor(readonly bus: Bus, readonly store: Store, public config: Config, readonly now = Date.now) {
    this.lastActivity = now();
  }
  async attach(ctx: ExtensionContext) {
    this.generation++;
    await this.cancel();
    if (this.current) {
      if (existsSync(this.current)) this.store.observe(snapshot(this.current));
      this.store.release("session:" + this.current);
    }
    this.ctx = ctx;
    this.store.presence(ctx.cwd, !ctx.isIdle() || ctx.hasPendingMessages());
    const path = ctx.sessionManager.getSessionFile();
    this.current = path ? (existsSync(path) ? realpathSync(path) : resolve(path)) : undefined;
    this.lastActivity = this.now();
    if (this.current) {
      if (existsSync(this.current)) this.store.observe(snapshot(this.current));
      const previous = this.store.lease("session:" + this.current);
      if (!this.store.claim("session:" + this.current)) ctx.ui.notify("Session maintenance is owned by another pi process. This instance observes only; ordinary pi writes are not locked.", "warning");
      else if (previous && previous.token !== this.store.owner) ctx.ui.notify(`Recovered maintenance ownership from stopped local PID ${previous.pid}. Durable checkpoints retained.`, "warning");
    }
    this.render();
  }
  start() {
    if (this.timer) return;
    this.timer = setInterval(() => { this.poll(); void this.tick().catch((error) => this.report(error)); }, this.config.pollSeconds * 1000);
    this.timer.unref?.();
  }
  poll() {
    if (this.closed || !this.ctx) return;
    this.store.heartbeat();
    this.store.presence(this.ctx.cwd, this.localHolds > 0 || !this.ctx.isIdle() || this.ctx.hasPendingMessages());
    if (this.running && this.store.control(this.ctx.cwd).cancel_seq !== this.running.cancelSeq) {
      this.running.abort.abort(new Error("Foreground activity in another pi window takes priority"));
      if (this.running.stage === "compact") this.ctx.abort();
    }
  }
  activity() {
    this.generation++;
    if (this.ctx && !this.closed) this.store.interrupt(this.ctx.cwd);
    this.lastActivity = this.now(); this.force = false;
    this.running?.abort.abort(new Error("Foreground activity takes priority"));
    if (this.running?.stage === "compact") this.ctx?.abort();
  }
  settled() { this.generation++; this.lastActivity = this.now(); this.render(); }
  private compactKey() {
    const branch = this.ctx!.sessionManager.getBranch?.() ?? this.ctx!.sessionManager.getEntries();
    return `native:1:${hash([this.config.compaction, projectEntries(branch)])}`;
  }
  private report(error: unknown) {
    this.progress = error instanceof Error ? error.message : String(error);
    this.ctx?.ui.setStatus("maintenance", `maintenance · ${this.progress.slice(0, 120)}`);
  }
  private enabled(): boolean {
    if (!this.ctx) return false;
    const c = this.store.control(this.ctx.cwd);
    return this.config.enabled && !c.disabled && c.paused_until <= this.now();
  }
  private idle(): boolean {
    return Boolean(!this.localHolds && this.ctx?.isIdle() && !this.ctx.hasPendingMessages() &&
      !this.store.otherBusy(this.ctx.cwd) &&
      (this.force || this.now() - Math.max(this.lastActivity, this.store.control(this.ctx.cwd).last_activity) >= this.config.idleSeconds * 1000));
  }
  private budgetDue(): boolean {
    const tokens = this.ctx?.getContextUsage()?.tokens;
    return this.config.compaction.enabled && this.config.compaction.budgetTokens !== undefined &&
      tokens !== null && tokens !== undefined && tokens >= this.config.compaction.budgetTokens;
  }
  async tick() {
    if (this.closed || this.tickRunning) return;
    this.tickRunning = true;
    const generation = this.generation;
    const cancelSeq = this.ctx ? this.store.control(this.ctx.cwd).cancel_seq : 0;
    try {
      this.poll();
      if (!this.ctx || !this.current || this.running || !this.enabled()) { this.render(); return; }
      // A previous owner may have exited. No heartbeat-age takeover of a live PID.
      if (!this.store.owns("session:" + this.current)) {
        const previous = this.store.lease("session:" + this.current);
        if (!this.store.claim("session:" + this.current)) { this.progress = "observer · owned by another pi process"; this.render(); return; }
        if (previous) this.ctx.ui.notify(`Maintenance owner PID ${previous.pid} stopped; this instance has taken over.`, "warning");
      }
      if (this.localHolds || !this.ctx.isIdle() || this.ctx.hasPendingMessages() || this.store.otherBusy(this.ctx.cwd) || (!this.idle() && !this.budgetDue())) return;
      if (!existsSync(this.current)) { this.progress = "waiting for a saved conversation"; return; }
      const s = snapshot(this.current); const activeRecord = this.store.observe(s);
      if (!this.store.claim("executor:" + this.ctx.cwd)) { this.progress = "another maintenance executor is active"; this.render(); return; }
      try {
        if (this.budgetDue() && (activeRecord.errors?.compact?.retryAt ?? 0) <= this.now() &&
            (activeRecord.compact?.hash !== s.hash || activeRecord.compact.key !== this.compactKey())) {
          await this.execute("compact", s, undefined, cancelSeq);
          return;
        }
        if (!this.idle()) return;
        const caps = discover(this.bus);
        // Start with current session, then the explicitly observed/backfilled queue.
        const records = this.store.records(this.ctx.cwd).sort((a, b) => Number(b.path === this.current) - Number(a.path === this.current) || a.seen - b.seen);
        for (const record of records) {
          if (this.closed || !this.idle() || !this.enabled()) break;
          let source: Snapshot;
          try {
            source = snapshot(record.path);
            if (source.cwd !== this.ctx.cwd) throw new Error("Saved-session working directory changed; refused out-of-scope maintenance");
          }
          catch (error) {
            record.error = `source unavailable: ${(error as Error).message}`;
            this.store.put(record); this.progress = record.error; continue;
          }
          if (!source.entries.length) continue;
          const current = this.store.observe(source);
          const leaseKey = "session:" + source.path;
          if (!this.store.claim(leaseKey)) continue;
          try {
            const activeModel = this.ctx.model ? `${this.ctx.model.provider}/${this.ctx.model.id}` : undefined;
            current.reviewModel ??= activeModel; current.summaryModel ??= activeModel;
            this.store.put(current);
            let memoryStatus: any;
            let summaryStatus: any;
            const statusRequest = (model?: string) => this.request("status", source, new AbortController().signal, model);
            if (caps.memory && (this.config.knowledge || this.config.upgrades || this.config.push)) {
              try { memoryStatus = await invoke(this.bus, caps.memory.channel, statusRequest(this.config.reviewModel ?? current.reviewModel)); }
              catch (error) { this.fail(current, "upgrade", error); }
            }
            if (generation !== this.generation || this.closed || !this.idle() || this.store.control(this.ctx.cwd).cancel_seq !== cancelSeq) return;
            const due = (stage: Stage) => (current.errors?.[stage]?.retryAt ?? 0) <= this.now();
            if (caps.memory && memoryStatus?.available && !memoryStatus.upgraded && this.config.upgrades && due("upgrade")) {
              await this.execute("upgrade", source, caps.memory.channel, cancelSeq); return;
            }
            if (caps.memory && memoryStatus?.available && current.pushPending && this.config.push && due("push")) {
              await this.execute("push", source, caps.memory.channel, cancelSeq); return;
            }
            if (caps.memory && memoryStatus?.available && memoryStatus.upgraded && this.config.knowledge && due("review") &&
                (current.review?.hash !== source.hash || current.review.key !== memoryStatus.key)) {
              await this.execute("review", source, caps.memory.channel, cancelSeq); return;
            }
            if (caps.summary && this.config.summaries && due("summary")) {
              try { summaryStatus = await invoke(this.bus, caps.summary.channel, statusRequest(this.config.summaryModel ?? current.summaryModel)); }
              catch (error) { this.fail(current, "summary", error); }
              if (generation !== this.generation || this.closed || !this.idle() || this.store.control(this.ctx.cwd).cancel_seq !== cancelSeq) return;
              if (summaryStatus && (current.summary?.hash !== source.hash || current.summary.key !== summaryStatus.key)) {
                await this.execute("summary", source, caps.summary.channel, cancelSeq); return;
              }
            }
            if (source.path === this.current && this.config.compaction.enabled && due("compact") &&
                (current.compact?.hash !== source.hash || current.compact.key !== this.compactKey())) {
              const tokens = this.ctx.getContextUsage()?.tokens;
              if (tokens !== null && tokens !== undefined && tokens >= this.config.compaction.minTokens) {
                await this.execute("compact", source, undefined, cancelSeq); return;
              }
            }
          } finally { if (source.path !== this.current) this.store.release(leaseKey); }
        }
        const blocked = this.store.records(this.ctx.cwd).filter((r) => r.error || Object.keys(r.errors ?? {}).length).length;
        this.progress = blocked ? `${blocked} session(s) have deferred/blocked work · /maintenance status` : "up to date";
        this.force = false;
      } finally { this.store.release("executor:" + this.ctx.cwd); this.render(); }
    } finally { this.tickRunning = false; }
  }
  private request(operation: TaskRequest["operation"], s: Snapshot, signal: AbortSignal, model?: string): TaskRequest {
    let cycleCost = 0;
    return {
      protocol: 1, operation, context: this.ctx!, cwd: s.cwd, path: s.path, sourceHash: s.hash, source: s,
      workDir: join(this.config.stateDir, "work"), model,
      maxCost: Math.min(this.config.maxCostPerCycle, Math.max(0, this.config.dailyBudget - this.store.spent())), signal,
      assertSource: () => {
        signal.throwIfAborted();
        const fresh = snapshot(s.path);
        if (!this.enabled() || (this.running && this.store.control(this.ctx!.cwd).cancel_seq !== this.running.cancelSeq) || !this.store.owns("session:" + s.path) || fresh.hash !== s.hash || fresh.id !== s.id || fresh.cwd !== s.cwd) throw new Error("Source changed, maintenance suspended, or ownership lost; deferred");
      },
      onUsage: (usage) => {
        const cost = usage?.cost?.total ?? 0;
        this.store.account(cost); cycleCost += cost;
        if (cycleCost >= this.config.maxCostPerCycle || this.store.spent() >= this.config.dailyBudget) {
          // Complete the current response/checkpoint; no second model call is admitted.
          this.progress = "cost budget reached; completed work retained";
        }
      },
      onProgress: (text) => {
        this.progress = text;
        const record = this.store.get(s.path);
        if (record?.active?.owner === this.store.owner) { record.active.progress = text; this.store.put(record); }
        this.render();
      },
    };
  }
  private async execute(stage: Stage, source: Snapshot, channel: string | undefined, cancelSeq: number) {
    if (!this.ctx) return;
    if (["upgrade", "review", "summary", "compact"].includes(stage) && this.store.spent() >= this.config.dailyBudget) {
      this.progress = "daily model budget reached"; return;
    }
    const abort = new AbortController();
    this.progress = `${stage} · ${source.path.split("/").at(-1)}`;
    const promise = Promise.resolve().then(async () => {
      try {
        abort.signal.throwIfAborted();
        if (this.closed || this.localHolds || !this.enabled() || this.ctx!.hasPendingMessages() || !this.ctx!.isIdle() || this.store.control(this.ctx!.cwd).cancel_seq !== cancelSeq) return;
        if (stage === "compact") {
          // Never compact a stale in-memory session (e.g. another window wrote it).
          if (source.path !== this.current || hash(projectEntries(this.ctx!.sessionManager.getEntries())) !== source.hash) throw new Error("Compaction deferred: in-memory and saved conversation differ");
          const branch = this.ctx!.sessionManager.getBranch?.() ?? this.ctx!.sessionManager.getEntries();
          if (unresolvedTools(branch)) throw new Error("Compaction deferred: unresolved tool calls on the current context branch");
          if (this.ctx!.hasPendingMessages() || !this.ctx!.isIdle()) return;
          const before = source.hash;
          const key = this.compactKey();
          this.compactStart = this.now();
          let timedOut = false;
          const watchdog = setTimeout(() => { timedOut = true; this.ctx?.abort(); }, 180_000);
          watchdog.unref?.();
          try {
            await new Promise<void>((resolve, reject) => {
              this.ctx!.compact({
                onComplete: (result) => {
                  try { this.store.account(result?.usage?.cost.total ?? 0); resolve(); }
                  catch (error) { reject(error); }
                },
                onError: reject,
              });
            });
          } finally { clearTimeout(watchdog); }
          this.compactStart = undefined;
          if (timedOut) throw new Error("Compaction exceeded its 3-minute maintenance watchdog");
          abort.signal.throwIfAborted();
          const record = this.store.get(source.path)!;
          record.compact = { hash: before, key, at: this.now() };
          delete record.errors?.compact; this.store.put(record);
        } else {
          const operation = stage === "summary" ? "run" : stage;
          const pinned = this.store.get(source.path)!;
          const model = stage === "summary" ? this.config.summaryModel ?? pinned.summaryModel : this.config.reviewModel ?? pinned.reviewModel;
          const request = this.request(operation, source, abort.signal, model);
          request.assertSource();
          const outcome = await invoke(this.bus, channel!, request);
          abort.signal.throwIfAborted();
          // Finalization can succeed for an old snapshot; never label new content reviewed.
          const record = this.store.get(source.path)!;
          if (outcome.complete && (stage === "review" || stage === "summary")) record[stage] = { hash: source.hash, key: outcome.key, at: this.now(), detail: outcome.detail };
          if ((stage === "review" || stage === "upgrade") && this.config.push) record.pushPending = true;
          if (stage === "push") record.pushPending = false;
          delete record.errors?.[stage]; this.store.put(record);
          this.progress = `${stage} ${outcome.complete ? "complete" : "checkpoint saved; more work pending"}`;
        }
      } catch (error) {
        this.compactStart = undefined;
        if (!abort.signal.aborted) this.fail(this.store.get(source.path)!, stage, error);
        else this.progress = "interrupted; pending work retained";
      }
    });
    this.running = { stage, path: source.path, abort, promise, cancelSeq };
    const claimed = this.store.get(source.path)!;
    claimed.active = { stage, owner: this.store.owner, pid: process.pid, started: this.now(), progress: this.progress };
    this.store.put(claimed);
    this.render();
    try { await promise; } finally {
      const record = this.store.get(source.path);
      if (record?.active?.owner === this.store.owner) { delete record.active; this.store.put(record); }
      this.running = undefined; this.render();
    }
  }
  private fail(record: RecordState, stage: Stage, error: unknown) {
    const old = record.errors?.[stage];
    const failures = (old?.failures ?? 0) + 1;
    (record.errors ??= {})[stage] = { failures, retryAt: this.now() + Math.min(3600_000, 30_000 * 2 ** Math.min(failures - 1, 7)), error: (error as Error).message ?? String(error) };
    this.store.put(record); this.progress = `${stage} deferred: ${record.errors[stage]!.error}`;
  }
  holdForSettings(): () => void {
    this.localHolds++;
    this.activity(); this.poll();
    let released = false;
    return () => {
      if (released) return;
      released = true; this.localHolds--;
      if (!this.closed) { this.lastActivity = this.now(); this.poll(); this.render(); }
    };
  }
  requestRun() { this.force = true; }
  async cancel() {
    this.running?.abort.abort(new Error("Maintenance cancelled"));
    if (this.running?.stage === "compact") this.ctx?.abort();
    await this.running?.promise;
  }
  suspend(seconds: number) {
    if (!this.ctx) return;
    const c = this.store.control(this.ctx.cwd);
    this.store.setControl(this.ctx.cwd, this.now() + seconds * 1000, Boolean(c.disabled));
    this.activity(); this.render();
  }
  resume() { if (this.ctx) { this.store.setControl(this.ctx.cwd, 0, false); this.lastActivity = this.now(); this.render(); } }
  off() { if (this.ctx) { this.store.setControl(this.ctx.cwd, 0, true); this.activity(); this.render(); } }
  on() { this.config.enabled = true; this.resume(); }
  retry() {
    if (!this.ctx) return;
    for (const record of this.store.records(this.ctx.cwd)) { record.errors = {}; this.store.put(record); }
    this.requestRun();
  }
  enqueue(path: string) {
    const s = snapshot(path);
    if (!this.ctx || s.cwd !== this.ctx.cwd) throw new Error("Backfill is limited to the current session working directory");
    this.store.observe(s);
  }
  async configure(config: Config) {
    if (config.stateDir !== this.config.stateDir) throw new Error("Changing stateDir requires reload");
    await this.cancel();
    if (this.closed) throw new Error("Maintenance runtime changed while applying settings");
    clearInterval(this.timer); this.timer = undefined;
    this.config = config;
    this.activity(); this.start(); this.render();
  }
  status() {
    const ctx = this.ctx;
    const control = ctx ? this.store.control(ctx.cwd) : null;
    return { enabled: this.enabled(), currentSession: this.current, currentSessionName: ctx?.sessionManager.getSessionName?.(),
      ownsSession: this.current ? this.store.owns("session:" + this.current) : false,
      foregroundBusy: ctx ? this.localHolds > 0 || !ctx.isIdle() || ctx.hasPendingMessages() : false,
      peerBusy: ctx ? this.store.otherBusy(ctx.cwd) : false,
      idleRemainingSeconds: this.force ? 0 : Math.max(0, Math.ceil((Math.max(this.lastActivity, control?.last_activity ?? 0) + this.config.idleSeconds * 1000 - this.now()) / 1000)),
      owner: this.current ? this.store.lease("session:" + this.current) : null,
      running: this.running ? { stage: this.running.stage, path: this.running.path } : null,
      compactStarted: this.compactStart, progress: this.progress,
      control, spentToday: this.store.spent(), config: this.config,
      sessions: ctx ? this.store.records(ctx.cwd) : [] };
  }
  private render() {
    if (!this.ctx || this.closed) return;
    const c = this.store.control(this.ctx.cwd);
    this.ctx.ui.setStatus("maintenance", `maintenance · ${!this.config.enabled || c.disabled ? "off" : c.paused_until > this.now() ? `suspended until ${new Date(c.paused_until).toLocaleTimeString()}` : this.progress.slice(0, 120)}`);
  }
  async close() {
    this.closing ??= this.closeOnce();
    await this.closing;
  }
  private async closeOnce() {
    this.closed = true;
    clearInterval(this.timer); this.timer = undefined;
    await this.cancel();
    // tick can be in a read-only adapter preflight, not yet reflected in running.
    while (this.tickRunning) await new Promise((resolve) => setTimeout(resolve, 5));
    if (this.current && existsSync(this.current)) {
      try { this.store.observe(snapshot(this.current)); }
      catch (error) { this.ctx?.ui.notify(`Could not queue the closing session: ${(error as Error).message}`, "warning"); }
    }
    this.ctx?.ui.setStatus("maintenance", undefined);
    this.store.close();
  }
}
