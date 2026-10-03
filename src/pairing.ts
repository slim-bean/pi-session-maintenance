import type { SessionEntry } from "@earendil-works/pi-coding-agent";

/** Compaction-aware, branch-only pairing guard. Do not hide unresolved tool work. */
export function unresolvedTools(branch: SessionEntry[]): boolean {
  let entries = branch;
  let last = -1;
  for (let i = 0; i < branch.length; i++) if (branch[i]!.type === "compaction") last = i;
  if (last >= 0) {
    const c = branch[last]! as Extract<SessionEntry, { type: "compaction" }>;
    if (typeof c.firstKeptEntryId !== "string") throw new Error("Cannot establish compaction pairing boundary");
    const start = branch.findIndex((e) => e.id === c.firstKeptEntryId);
    if (start < 0 || start > last) throw new Error("Cannot establish compaction pairing boundary");
    entries = branch.slice(start);
  }
  const counts = new Map<string, number>();
  const id = (value: string) => value.split("|")[0]!;
  for (const e of entries) {
    if (e.type !== "message") continue;
    const m = e.message;
    if (m.role === "assistant" && m.stopReason !== "error" && m.stopReason !== "aborted") {
      for (const block of m.content) if (block.type === "toolCall") {
        const key = id(block.id); counts.set(key, (counts.get(key) ?? 0) + 1);
      }
    } else if (m.role === "toolResult") {
      const key = id(m.toolCallId); counts.set(key, Math.max(0, (counts.get(key) ?? 0) - 1));
    }
  }
  return [...counts.values()].some((n) => n > 0);
}
