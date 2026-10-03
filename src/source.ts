import { createHash } from "node:crypto";
import { readFileSync, realpathSync, statSync } from "node:fs";

export interface ConversationEntry {
  index: number; id: string; parentId: string | null; timestampMs: number | null;
  role: "user" | "assistant"; text: string;
}
export interface Snapshot { path: string; cwd: string; id: string; name?: string; hash: string; entries: ConversationEntry[]; activity: number }
export const hash = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
const timestamp = (value: unknown): number | null => {
  const ms = typeof value === "number" ? value : typeof value === "string" ? Date.parse(value) : NaN;
  return Number.isFinite(ms) && Number.isFinite(new Date(ms).getTime()) ? ms : null;
};
/** Same all-branch text projection/fingerprint as pi-session-search. No source writes. */
export function snapshot(path: string): Snapshot {
  path = realpathSync(path);
  if (statSync(path).size > 128 * 1024 * 1024) throw new Error("Session exceeds the 128MiB source budget");
  const raw = readFileSync(path, "utf8");
  const lines = raw.split("\n").filter((line) => line.trim());
  const header = JSON.parse(lines.shift() ?? "");
  if (header?.type !== "session" || typeof header.cwd !== "string" || typeof header.id !== "string") throw new Error("Invalid pi session header");
  const rawEntries = lines.map((line) => {
    try { return JSON.parse(line); } catch { throw new Error("Incomplete/corrupt session JSONL; retry after the writer settles"); }
  });
  const entries = projectEntries(rawEntries);
  let name: string | undefined;
  for (const e of rawEntries) if (e?.type === "session_info") name = typeof e.name === "string" && e.name.trim() ? e.name : undefined;
  return { path, id: header.id, cwd: header.cwd, name, hash: hash(entries), entries,
    activity: entries.reduce((ms, e) => Math.max(ms, e.timestampMs ?? 0), 0) };
}
export function projectEntries(rawEntries: unknown[]): ConversationEntry[] {
  const entries: ConversationEntry[] = [];
  let index = 0;
  for (const e of rawEntries as any[]) {
    index++;
    const msg = e?.type === "message" ? e.message : null;
    if (msg?.role !== "user" && msg?.role !== "assistant") continue;
    const text = typeof msg.content === "string" ? msg.content : Array.isArray(msg.content)
      ? msg.content.filter((b: any) => b?.type === "text" && typeof b.text === "string").map((b: any) => b.text).join("\n") : "";
    if (!text.trim()) continue;
    entries.push({ index, id: typeof e.id === "string" ? e.id : "", parentId: typeof e.parentId === "string" ? e.parentId : null,
      timestampMs: timestamp(e.timestamp) ?? timestamp(msg.timestamp), role: msg.role, text });
  }
  return entries;
}
