import { timeSpan } from "./format.ts";

export interface FooterState {
  enabled: boolean; pausedUntil: number; now: number;
  running?: { stage: string; progress: string; stopping: boolean };
  observerPid?: number; settingsOpen: boolean; foregroundBusy: boolean; peerBusy: boolean;
  executorPid?: number; savedSession: boolean; budgetReached: boolean;
  errors: number; blockers?: number; deferrals?: number; idleRemainingSeconds: number;
}
/** Emoji delimits this extension's block; never render cached progress as live state. */
export function formatFooter(s: FooterState): string {
  if (s.running) {
    if (s.running.stopping) return "🧹 stop…";
    const stage = ({ upgrade: "upd", review: "review", summary: "sum", compact: "compact", push: "push" } as Record<string, string>)[s.running.stage] ?? "work";
    const count = /(?:knowledge|summary):\s*(\d{1,4}\/\d{1,4})\b/.exec(s.running.progress)?.[1];
    return `🧹 ${stage}${count ? ` ${count}` : ""}`;
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
  if (s.errors) return `🧹 err ${s.errors}`;
  if (s.blockers) return `🧹 block ${s.blockers}`;
  if (s.deferrals) return `🧹 wait ${s.deferrals}`;
  if (s.idleRemainingSeconds > 0) return `🧹 idle ${timeSpan(s.idleRemainingSeconds)}`;
  return "🧹 ready";
}
