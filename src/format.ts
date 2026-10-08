import { basename } from "node:path";
import { homedir } from "node:os";
import { describeConfigSource, type Config } from "./config.ts";
import type { Coordinator } from "./coordinator.ts";
import type { Capabilities } from "./protocol.ts";
import type { RecordState, Receipt } from "./store.ts";
import { groupedIssues } from "./issues.ts";
import { nextSteps } from "./guidance.ts";

export type Status = ReturnType<Coordinator["status"]>;
const clean = (text: string, max = 200) => {
  const value = text.replace(/[\u0000-\u001f\u007f-\u009f]/g, " ").replace(/\s+/g, " ").trim();
  return value.length > max ? value.slice(0, max - 1) + "…" : value;
};
export const prettyPath = (path: string) => path === homedir() ? "~" : path.startsWith(homedir() + "/") ? "~" + path.slice(homedir().length) : path;
export function timeSpan(seconds: number): string {
  if (seconds < 60) return `${Math.max(0, Math.ceil(seconds))}s`;
  if (seconds < 3600) return `${Math.ceil(seconds / 60)}m`;
  if (seconds < 86400) return `${Math.round(seconds / 360) / 10}h`;
  return `${Math.round(seconds / 8640) / 10}d`;
}
export const money = (n: number) => `$${n.toFixed(n > 0 && n < 0.01 ? 4 : 2)}`;
const onOff = (value: boolean) => value ? "on" : "off";
const names: Record<string, string> = { upgrade: "OKF upgrade", review: "Knowledge review", summary: "Search summary", run: "Search summary", push: "Knowledge push", compact: "Compaction" };
export const stageName = (stage: string) => names[stage] ?? clean(stage);
export function sessionLabel(record: Pick<RecordState, "name" | "path" | "id">): string {
  if (record.name) return clean(record.name, 100);
  const date = /^(\d{4}-\d{2}-\d{2})T(\d{2})-(\d{2})/.exec(basename(record.path));
  const id = record.id.length > 12 ? record.id.slice(0, 8) : record.id;
  return date ? `${date[1]} ${date[2]}:${date[3]} · ${clean(id, 30)}` : clean(basename(record.path), 100);
}
function coverage(receipt: Receipt | undefined, record: RecordState, enabled: boolean, available: boolean, now: number): string {
  if (!enabled) return "off";
  if (!available) return "package not loaded";
  if (record.entryCount === 0) return "no conversation yet";
  if (!receipt) return "pending";
  if (receipt.hash !== record.hash) return "new conversation since last pass";
  return `covered ${timeSpan(Math.max(0, now - receipt.at) / 1000)} ago`;
}
function relevantErrors(record: RecordState, status: Status, caps: Capabilities) {
  return Object.entries(record.errors ?? {}).filter(([stage]) =>
    stage === "upgrade" ? status.config.upgrades && caps.memory :
    stage === "review" ? status.config.knowledge && caps.memory :
    stage === "summary" ? status.config.summaries && caps.summary :
    stage === "push" ? status.config.push && caps.memory :
    status.config.compaction.enabled && record.path === status.currentSession);
}
export function formatStatus(status: Status, caps: Capabilities, now = Date.now()): string {
  const cfg = status.config;
  const suspended = (status.control?.paused_until ?? 0) > now;
  const off = !cfg.enabled || Boolean(status.control?.disabled);
  const mode = off ? "off" : suspended ? "suspended" : "enabled";
  const records = status.sessions.map((r) => r.path === status.currentSession && status.currentSessionName ? { ...r, name: status.currentSessionName } : r).sort((a, b) => Number(b.path === status.currentSession) - Number(a.path === status.currentSession) || Number(Boolean(b.active)) - Number(Boolean(a.active)) || b.seen - a.seen);
  const label = (path: string) => {
    const record = records.find((r) => r.path === path);
    return record ? sessionLabel(record) : clean(basename(path), 100);
  };
  const active = status.running ?? records.find((r) => r.active)?.active;
  let state: string;
  if (status.running) state = `${stageName(status.running.stage)} in progress — ${label(status.running.path)}`;
  else if (active) state = `Recorded worker in another window: ${stageName(active.stage)}`;
  else if (off) state = status.control?.disabled ? "Disabled for this workspace (/maintenance on to resume)" : "Disabled in settings";
  else if (suspended) state = `Paused for ${timeSpan((status.control!.paused_until - now) / 1000)} (until ${new Date(status.control!.paused_until).toLocaleTimeString()})`;
  else if (!status.ownsSession && status.owner) state = "Observer — another pi process handles this session";
  else if (status.foregroundBusy || status.peerBusy) state = "Waiting for foreground work to finish";
  else if (status.spentToday >= cfg.dailyBudget) state = "Daily model budget reached; retries resume when the UTC day changes";
  else if (status.idleRemainingSeconds > 0) state = `Waiting for idle — eligible in ${timeSpan(status.idleRemainingSeconds)}`;
  else state = "Ready for maintenance";
  const stages = [
    `upgrades ${!cfg.upgrades ? "off" : caps.memory ? "on" : "not loaded"}`,
    `knowledge ${!cfg.knowledge ? "off" : caps.memory ? "on" : "not loaded"}`,
    `summaries ${!cfg.summaries ? "off" : caps.summary ? "on" : "not loaded"}`,
    `compaction ${onOff(cfg.compaction.enabled)}`, `push ${!cfg.push ? "off" : caps.memory ? "on" : "not loaded"}`,
  ];
  const owner = status.owner ? status.ownsSession ? `this pi process (PID ${status.owner.pid})` : `PID ${status.owner.pid} on ${clean(status.owner.host)}` : "not claimed yet";
  const needsCoverage = (r: RecordState) => r.entryCount !== 0 && (
    (cfg.knowledge && caps.memory && r.review?.hash !== r.hash) ||
    (cfg.summaries && caps.summary && r.summary?.hash !== r.hash) ||
    (cfg.push && r.pushPending));
  const pending = records.filter(needsCoverage).length;
  const groups = groupedIssues(records, (stage, r) => relevantErrors(r, status, caps).some(([s]) => s === stage));
  const advisoryNotes = new Map<string, { at: number; message: string }>();
  for (const r of records) {
    const detail = r.review?.detail as { bundle?: string; advisories?: { code: string; message: string }[] } | undefined;
    if (!r.review || !Array.isArray(detail?.advisories)) continue;
    for (const note of detail.advisories) {
      if (typeof note?.message !== "string" || typeof note.code !== "string") continue;
      const key = JSON.stringify([detail.bundle ?? r.cwd, note.code]);
      if ((advisoryNotes.get(key)?.at ?? -1) <= r.review.at) advisoryNotes.set(key, { at: r.review.at, message: note.message });
    }
  }
  const lines = [
    `Session maintenance · ${mode}`, `State: ${state}`, `Owner: ${owner}`,
    `Stages: ${stages.join(" · ")}`,
    `Schedule: after ${timeSpan(cfg.idleSeconds)} idle · check every ${timeSpan(cfg.pollSeconds)}`,
    `Budget: ${money(status.spentToday)} / ${money(cfg.dailyBudget)} today · ${money(cfg.maxCostPerCycle)} per opportunity (approx.)`,
    `Sessions: ${records.length} observed · ${pending} need saved coverage`,
    `Issues: ${groups.filter((g) => g.kind === "error").length} errors · ${groups.filter((g) => g.kind === "blocked").length} blockers · ${groups.filter((g) => g.kind === "deferred").length} waiting`,
  ];
  if (status.configSource) lines.push(`Configuration: ${clean(describeConfigSource(status.configSource), 500)}`);
  if (status.resolvedIssues?.length) lines.push(`Resolved issues: ${status.resolvedIssues.length} recent archived record(s); original errors/counters retained in state.db.`);
  if (status.progress && status.progress !== "waiting for idle") lines.push(`Latest: ${clean(status.progress, 240)}`);
  if (status.running?.transcript) lines.push(`Transcript: ${clean(prettyPath(status.running.transcript), 500)}`,
    `Inspect: /maintenance watch · last event ${timeSpan(Math.max(0, now - status.running.lastEvent) / 1000)} ago`);
  if (groups.length) {
    lines.push("", "Maintenance issues (shared resources counted once)");
    for (const g of groups.slice(0, 8)) {
      const kind = g.kind === "deferred" ? "Waiting" : g.kind === "blocked" ? "Blocked" : "Error";
      const retry = g.retryAt > now ? `retry in ${timeSpan((g.retryAt - now) / 1000)}` : "retry eligible";
      lines.push(`• ${kind}: ${clean(g.message, 240)}`);
      lines.push(`  ${prettyPath(g.resource)} · affects ${g.paths.size} session(s) · ${retry}`);
      if (g.attempts > 0) {
        const history = g.legacyHistory ? `Recorded unsuccessful checks: up to ${g.attempts} for an affected job (legacy history).` :
          g.attempts === 1 ? "First unsuccessful check; no retry recorded yet." : `${g.attempts} unsuccessful checks for an affected job; already retried ${g.attempts - 1} time(s).`;
        lines.push(`  History: ${history}${g.lastAttemptAt ? ` Last check ${timeSpan(Math.max(0, now - g.lastAttemptAt) / 1000)} ago.` : ""}`);
      } else lines.push("  History: no attempt history recorded for this condition.");
      const guidance = nextSteps(g);
      lines.push(`  Next: ${guidance.intervention === "needed" ? "Action needed before this can pass." : guidance.intervention === "suggested" ? "Investigation recommended; repeated retries have not resolved it." : "No intervention required yet."}`);
      for (const action of guidance.actions.slice(0, 6)) lines.push(`    ${clean(action, 400)}`);
      if (guidance.actions.length > 6) lines.push("    More findings remain in memory_validate.");
      const modelWork = [...g.stages].some((stage) => stage !== "push" && stage !== "source");
      if (off) lines.push("  Automatic retry: paused while maintenance is off; /maintenance on enables it.");
      else if (suspended) lines.push(`  Automatic retry: after the pause ends (${timeSpan((status.control!.paused_until - now) / 1000)}), at a safe idle window.`);
      else if (modelWork && status.spentToday >= cfg.dailyBudget) lines.push("  Automatic retry: after the UTC daily budget resets (or an approved budget increase), at safe idle.");
      else if (status.foregroundBusy || status.peerBusy) {
        lines.push(`  Automatic retry: at a safe idle window after foreground work finishes; normal idle delay is ${timeSpan(cfg.idleSeconds)} (${retry}).${guidance.intervention === "needed" ? " Retrying alone cannot repair this prerequisite." : ""}`);
      } else {
        const wait = Math.max(0, (g.retryAt - now) / 1000, status.idleRemainingSeconds);
        lines.push(`  Automatic retry: ${wait > 0 ? `eligible in ${timeSpan(wait)}, then at` : "at the next"} safe idle window.${guidance.intervention === "needed" ? " Retrying alone cannot repair this prerequisite." : ""}`);
      }
      lines.push(`  Retry now: /maintenance retry removes backoff immediately and attempts the earliest safe idle window${status.owner && !status.ownsSession ? `; run it in owner PID ${status.owner.pid}'s window` : ""}. Active turns are not interrupted.`);
    }
    if (groups.length > 8) lines.push(`… ${groups.length - 8} more distinct issues`);
  }
  if (advisoryNotes.size) {
    lines.push("", "Last validation advisories (do not block commits)");
    for (const note of [...advisoryNotes.values()].slice(0, 4)) lines.push(`• ${clean(note.message, 240)}`);
  }
  if (records.length) {
    lines.push("", "Recorded coverage");
    for (const r of records.slice(0, 8)) {
      lines.push(`• ${sessionLabel(r)}${r.path === status.currentSession ? " (current)" : ""}`);
      lines.push(`  Knowledge: ${coverage(r.review, r, cfg.knowledge, Boolean(caps.memory), now)} · Summary: ${coverage(r.summary, r, cfg.summaries, Boolean(caps.summary), now)}`);
      if (r.active) lines.push(`  ${stageName(r.active.stage)} · PID ${r.active.pid}: ${clean(r.active.progress, 160)}`);
      if (r.path === status.currentSession && cfg.compaction.enabled && r.compact) lines.push(`  Last compaction: ${timeSpan(Math.max(0, now - r.compact.at) / 1000)} ago`);
      if (r.pushPending && cfg.push) lines.push("  Push pending (review will not be repeated just to retry Git)");
      if (r.error) lines.push(`  Source: ${clean(r.error, 240)}`);
      for (const [stage, issue] of relevantErrors(r, status, caps)) {
        if (!issue) continue;
        const retry = issue.retryAt > now ? `retry in ${timeSpan((issue.retryAt - now) / 1000)}` : "retry eligible";
        const state = issue.kind === "deferred" ? "waiting" : issue.kind === "blocked" ? "blocked" : "error";
        lines.push(`  ${stageName(stage)} ${state}, ${retry}${issue.resource ? " (see shared issue above)" : `: ${clean(issue.message ?? issue.error, 240)}`}`);
      }
    }
    if (records.length > 8) lines.push(`… ${records.length - 8} more observed sessions`);
    lines.push("Coverage is for saved content; model/policy changes are checked when work runs.");
  }
  lines.push("", "/maintenance settings · suspend 30m · run · retry");
  return lines.join("\n");
}
export function formatSettings(cfg: Config, cwd: string): string {
  return [
    "Maintenance settings", `File: ${prettyPath(cwd + "/.pi/maintenance.json")}`,
    `Enabled: ${onOff(cfg.enabled)} · Idle delay: ${timeSpan(cfg.idleSeconds)} · Poll interval: ${timeSpan(cfg.pollSeconds)}`,
    `OKF upgrades: ${onOff(cfg.upgrades)} · Knowledge review: ${onOff(cfg.knowledge)} · Search summaries: ${onOff(cfg.summaries)}`,
    `Review model: ${cfg.reviewModel ? clean(cfg.reviewModel) : "automatic (pinned per session)"}`,
    `Summary model: ${cfg.summaryModel ? clean(cfg.summaryModel) : "automatic (pinned per session)"}`,
    `Model budget: ${money(cfg.maxCostPerCycle)} per opportunity · ${money(cfg.dailyBudget)} per UTC day (approx.)`,
    `Compaction: ${onOff(cfg.compaction.enabled)} · Idle floor: ${cfg.compaction.minTokens.toLocaleString()} tokens · Between-turn budget: ${cfg.compaction.budgetTokens?.toLocaleString() ?? "off"}`,
    `Push to configured upstream: ${onOff(cfg.push)}`,
    `Private model transcripts: ${onOff(cfg.modelTranscripts)} · /maintenance watch · /maintenance history`,
    `Private state: ${prettyPath(cfg.stateDir)} (change requires reload)`,
  ].join("\n");
}
