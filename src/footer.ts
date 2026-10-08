import { timeSpan } from "./format.ts";

export interface FooterState {
  enabled: boolean; pausedUntil: number; now: number;
  running?: { stage: string; progress: string; stopping: boolean; started?: number };
  frame?: number;
  observerPid?: number; settingsOpen: boolean; foregroundBusy: boolean; peerBusy: boolean;
  executorPid?: number; savedSession: boolean; budgetReached: boolean;
  errors: number; blockers?: number; deferrals?: number; idleRemainingSeconds: number;
}
/** Emoji delimits this extension's block; never render cached progress as live state. */
export function formatFooter(s: FooterState): string {
  if (s.running) {
    if (s.running.stopping) return "🧹 stop… → /maintenance watch";
    const stage = ({ upgrade: "upd", review: "review", summary: "sum", compact: "compact", push: "push" } as Record<string, string>)[s.running.stage] ?? "work";
    const count = /(?:knowledge|summary):\s*(\d{1,4}\/\d{1,4})\b/.exec(s.running.progress)?.[1];
    const frames = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];
    const elapsed = s.running.started === undefined ? "" : ` ${timeSpan(Math.max(0, s.now - s.running.started) / 1000)}`;
    return `🧹 ${frames[(s.frame ?? 0) % frames.length]} ${stage}${count ? ` ${count}` : ""}${elapsed} → /maintenance watch`;
  }
  if (!s.enabled) return "🧹 off";
  if (s.pausedUntil > s.now) return `🧹 pause ${timeSpan((s.pausedUntil - s.now) / 1000)}`;
  if (s.observerPid) return `🧹 obs #${s.observerPid}`;
  if (s.settingsOpen) return "🧹 settings";
  if (s.foregroundBusy) return "🧹 busy";
  if (s.peerBusy) return "🧹 peer";
  if (s.executorPid) return `🧹 slot #${s.executorPid}`;
  if (!s.savedSession) return "🧹 new";
  if (s.budgetReached) return "🧹 budget";
  if (s.errors) return `🧹 err ${s.errors} → status`;
  if (s.blockers) return `🧹 block ${s.blockers} → status`;
  if (s.deferrals) return `🧹 wait ${s.deferrals} auto`;
  if (s.idleRemainingSeconds > 0) return `🧹 idle ${timeSpan(s.idleRemainingSeconds)}`;
  return "🧹 ready";
}
