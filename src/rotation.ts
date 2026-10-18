import type { ExtensionAPI, ExtensionCommandContext, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { existsSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { parseConfig, type Config, type ConfigSource } from "./config.ts";
import type { Coordinator } from "./coordinator.ts";
import { settingsText } from "./settings.ts";

export const ROTATION_ENTRY = "maintenance.session-rotation.v1";
const RESTORED_ENTRY = "maintenance.session-rotation-restored.v1";
interface Binding { coordinator: Coordinator; context: ExtensionContext; monitorOpen: boolean }
interface RotationEntry { day: string; timeZone: string; startedAt: string; previousSession?: string; previousName?: string;
  carry?: { config: Config; source: ConfigSource; workspace: string | null; model?: { provider: string; id: string }; thinking: ReturnType<ExtensionAPI["getThinkingLevel"]> } }
export function dateName(at: number, timeZone: string): string {
  if (!Number.isFinite(at)) throw new Error("Cannot determine a valid session date");
  const parts = new Intl.DateTimeFormat("en", { timeZone: timeZone === "local" ? undefined : timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(new Date(at));
  const get = (type: string) => parts.find(p => p.type === type)!.value;
  return `${get("year")}-${get("month")}-${get("day")}`;
}
function entry(ctx: ExtensionContext): RotationEntry | undefined {
  const entries = ctx.sessionManager.getEntries();
  const record = entries.filter(e => e.type === "custom" && e.customType === ROTATION_ENTRY).at(-1);
  return record?.type === "custom" ? record.data as RotationEntry : undefined;
}

/** Native newSession is command-only. A scheduled, token-bound extension command
 * obtains that context without a model request or a source conversation prompt. */
export class DailyRotation {
  private timer?: ReturnType<typeof setInterval>;
  private dispatch?: ReturnType<typeof setTimeout>;
  private pending?: { token: string; id: string; day: string; lease: NonNullable<ReturnType<Coordinator["prepareRotation"]>> };
  private executing = false;
  private retryAt = 0;
  private message?: string;
  constructor(private pi: ExtensionAPI, private binding: () => Binding | undefined, readonly now = Date.now) {}
  start() {
    const b = this.binding();
    if (!b?.coordinator.config.sessionRotation.enabled || this.timer) return;
    this.timer = setInterval(() => this.poll(), b.coordinator.config.pollSeconds * 1000); this.timer.unref?.();
    // Always leave session_start/configuration/agent_settled before dispatching.
    this.dispatch = setTimeout(() => this.poll(), 0); this.dispatch.unref?.();
  }
  reset() { this.close(); this.retryAt = 0; this.start(); }
  close() {
    clearInterval(this.timer); this.timer = undefined;
    clearTimeout(this.dispatch); this.dispatch = undefined;
    this.pending?.lease.release(); this.pending = undefined;
  }
  status() {
    const b = this.binding(); const config = b?.coordinator.config.sessionRotation;
    return { enabled: config?.enabled ?? false, timeZone: config?.timeZone ?? "UTC", pending: Boolean(this.pending), progress: this.message };
  }
  private plan(b: Binding) {
    const config = b.coordinator.config.sessionRotation;
    const record = entry(b.context);
    const header = b.context.sessionManager.getHeader();
    const startedAt = record?.startedAt ?? header?.timestamp;
    const at = startedAt ? Date.parse(startedAt) : NaN;
    const day = dateName(at, config.timeZone), today = dateName(this.now(), config.timeZone);
    return { day, today, startedAt: new Date(at).toISOString(), record };
  }
  poll(): boolean {
    if (this.pending || this.executing) return true;
    const b = this.binding();
    if (!b || !b.coordinator.config.sessionRotation.enabled || this.now() < this.retryAt) return false;
    try {
      const { day, today, startedAt, record } = this.plan(b);
      // With an already adopted name/calendar there is no action to admit.
      // Avoid fresh disk + in-memory transcript hashing on every same-day poll.
      if (record && record.timeZone === b.coordinator.config.sessionRotation.timeZone &&
          b.context.sessionManager.getSessionName() === day && today <= day) {
        this.message = `current daily session: ${day}`; return false;
      }
      const blocked = b.monitorOpen ? "maintenance monitor is open" : b.coordinator.rotationBlocker();
      if (blocked) { this.message = blocked; return false; }
      if (!record || record.timeZone !== b.coordinator.config.sessionRotation.timeZone) {
        const previousName = b.context.sessionManager.getSessionName();
        this.pi.appendEntry(ROTATION_ENTRY, { day, timeZone: b.coordinator.config.sessionRotation.timeZone, startedAt, previousName });
      }
      if (b.context.sessionManager.getSessionName() !== day) this.pi.setSessionName(day);
      if (today <= day) { this.message = `current daily session: ${day}`; return false; } // never rotate backward after a clock correction
      const lease = b.coordinator.prepareRotation();
      if (!lease) { this.message = "waiting for a safe session boundary"; return false; }
      this.pending = { token: randomUUID(), id: b.context.sessionManager.getSessionId(), day: today, lease };
      this.message = `rotation to ${today} queued`;
      this.dispatch = setTimeout(() => {
        this.dispatch = undefined;
        const pending = this.pending; if (!pending) return;
        try { this.pi.sendUserMessage(`/maintenance rotate ${pending.token}`, { expandPromptTemplates: true }); }
        catch (error) { this.failed(error); }
      }, 0);
      this.dispatch.unref?.(); return true;
    } catch (error) { this.failed(error); return false; }
  }
  beforeSwitch(): { cancel: true } | undefined {
    if (this.executing && this.pending?.lease.check()) return { cancel: true };
    return undefined;
  }
  private failed(error: unknown) {
    this.message = `rotation deferred: ${error instanceof Error ? error.message : String(error)}`;
    this.retryAt = this.now() + 60_000;
    this.pending?.lease.release(); this.pending = undefined;
    this.binding()?.context.ui.notify(this.message, "warning");
  }
  async execute(ctx: ExtensionCommandContext, token?: string): Promise<string> {
    const b = this.binding();
    if (!b?.coordinator.config.sessionRotation.enabled) return "Daily session rotation is disabled in settings.";
    if (this.executing) return "A daily session rotation is already running.";
    // A delayed command can only act on the exact session that scheduled it.
    if (token && (!this.pending || this.pending.token !== token || this.pending.id !== ctx.sessionManager.getSessionId())) return "Stale rotation request ignored.";
    if (!token) {
      this.poll();
      if (!this.pending) return this.message ?? "No daily rotation is due.";
      clearTimeout(this.dispatch); this.dispatch = undefined;
    }
    const pending = this.pending!;
    const blocked = b.monitorOpen ? "maintenance monitor is open" : pending.lease.check();
    if (blocked) { pending.lease.release(); this.pending = undefined; this.message = blocked; return `Rotation deferred: ${blocked}.`; }
    const config = b.coordinator.config;
    const day = dateName(this.now(), config.sessionRotation.timeZone);
    if (day !== pending.day) { pending.lease.release(); this.pending = undefined; return "Date changed while rotation was queued; retry at the next idle check."; }
    this.executing = true;
    try {
      const previous = ctx.sessionManager.getSessionFile();
      const previousSession = previous && existsSync(previous) ? previous : undefined;
      const source = b.coordinator.status().configSource;
      const carry: RotationEntry["carry"] = { config, source, workspace: settingsText(ctx.cwd),
        model: ctx.model ? { provider: ctx.model.provider, id: ctx.model.id } : undefined, thinking: this.pi.getThinkingLevel() };
      // Queue the departing conversation before runtime teardown. Backlog remains
      // durable and is not contingent on model/auth/validation/budget success.
      if (previousSession) b.coordinator.enqueue(previousSession);
      const result = await ctx.newSession({ parentSession: previousSession,
        setup: async manager => {
          manager.appendSessionInfo(day);
          manager.appendCustomEntry(ROTATION_ENTRY, { day, timeZone: config.sessionRotation.timeZone, startedAt: new Date(this.now()).toISOString(), previousSession, carry });
        },
        withSession: async replacement => {
          await replacement.sendUserMessage("/maintenance rotation-restore", { expandPromptTemplates: true });
          replacement.ui.notify(`Daily session started: ${day}. Previous conversation retained${previousSession ? ` at ${previousSession}` : ""}.`, "info");
        },
      });
      if (result.cancelled) { pending.lease.release(); this.pending = undefined; this.retryAt = this.now() + 60_000; return "Daily rotation cancelled by a session-switch hook; it will retry automatically."; }
      // Successful replacement invalidates the original pi/ctx/coordinator.
      return `Daily session started: ${day}.`;
    } catch (error) {
      // A replacement may already have happened. Never call captured APIs then.
      if (this.binding()?.coordinator === b.coordinator) this.failed(error);
      return `Daily rotation failed: ${error instanceof Error ? error.message : String(error)}`;
    } finally { this.executing = false; }
  }
  async restore(ctx: ExtensionCommandContext) {
    const b = this.binding(); if (!b) return;
    const record = entry(ctx); const carry = record?.carry;
    if (!record || !carry || ctx.sessionManager.getEntries().some(e => e.type === "custom" && e.customType === RESTORED_ENTRY)) return;
    // A host's fresh session_start configuration, or changed workspace settings,
    // wins over the outgoing session's runtime-local settings snapshot.
    if (b.coordinator.status().configSource.kind !== "host" && settingsText(ctx.cwd) === carry.workspace) {
      await b.coordinator.configure(parseConfig(carry.config, ctx.cwd), carry.source);
    }
    if (carry.model) {
      const model = ctx.modelRegistry.find(carry.model.provider, carry.model.id);
      if (model) await this.pi.setModel(model);
    }
    this.pi.setThinkingLevel(carry.thinking);
    this.pi.setSessionName(record.day);
    this.pi.appendEntry(RESTORED_ENTRY, { day: record.day });
    this.reset();
  }
}
