import { SessionManager } from "@earendil-works/pi-coding-agent";
import { chmodSync, existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, statSync, unlinkSync } from "node:fs";
import { basename, join } from "node:path";

export interface RunMeta {
  source: string; sourceHash: string; cwd: string; stage: string; owner: string; pid: number; started: number;
}
export interface RunInfo extends RunMeta { id: string; file: string; ended?: number; status: string; progress?: string; lastEvent?: number; revision?: string }
/** Optional, versioned adapter callback. No provider credentials/options are accepted. */
export type ModelEvent =
  | { type: "start"; provider: string; model: string; systemPrompt: string; messages: any[]; reasoning?: string; maxTokens?: number }
  | { type: "delta"; channel: "text" | "thinking"; delta: string }
  | { type: "end"; message: any };
const MAX_FILE = 32 * 1024 * 1024;
const MAX_VIEW = 2 * 1024 * 1024;
const MAX_RUNS = 200;
const MAX_AGE = 30 * 86400_000;
const infoCache = new Map<string, { stamp: string; info?: RunInfo }>();
export const runsDir = (stateDir: string) => join(stateDir, "runs");
const regular = (file: string) => { const s = lstatSync(file); return s.isFile() && !s.isSymbolicLink(); };
function entries(file: string): any[] {
  if (!regular(file) || statSync(file).size > MAX_FILE) return [];
  const raw = readFileSync(file, "utf8");
  const lines = raw.split("\n");
  return lines.flatMap((line, index) => {
    if (!line.trim()) return [];
    try { return [JSON.parse(line)]; }
    catch {
      if (index === lines.length - 1 && !raw.endsWith("\n")) return []; // concurrent append, not a complete entry
      throw new Error("Corrupt maintenance transcript; refusing to infer a completed run");
    }
  });
}
export function listRuns(stateDir: string, cwd?: string): RunInfo[] {
  const dir = runsDir(stateDir);
  if (!existsSync(dir) || lstatSync(dir).isSymbolicLink()) return [];
  return readdirSync(dir).filter(name => name.endsWith(".jsonl")).flatMap(name => {
    const file = join(dir, name);
    try {
      const stat = lstatSync(file);
      if (!stat.isFile() || stat.isSymbolicLink()) return [];
      const stamp = `${stat.mtimeMs}:${stat.size}`;
      let cached = infoCache.get(file);
      if (cached?.stamp !== stamp) {
        const rows = entries(file);
        const meta = rows.find(e => e.type === "custom" && e.customType === "maintenance.run")?.data;
        const reversed = rows.slice().reverse();
        const ended = reversed.find(e => e.type === "custom" && e.customType === "maintenance.end")?.data;
        const progress = reversed.find(e => e.type === "custom" && e.customType === "maintenance.progress")?.data?.text;
        cached = { stamp, info: meta && typeof meta.source === "string" ? { ...meta, id: rows[0].id, file,
          status: ended?.status ?? "active/unfinished", ended: ended?.at, progress, revision: stamp,
          lastEvent: reversed.find(e => e.type === "custom" && typeof e.data?.at === "number")?.data.at ?? meta.started } : undefined };
        if (infoCache.size >= 512) infoCache.delete(infoCache.keys().next().value!);
        infoCache.set(file, cached);
      }
      return cached.info && (cwd === undefined || cached.info.cwd === cwd) ? [cached.info] : [];
    } catch { return []; }
  }).sort((a, b) => b.started - a.started);
}
export function readRunEntries(run: RunInfo): any[] { return entries(run.file); }
export function runText(run: RunInfo, showRequests = false): string {
  const rows = entries(run.file);
  const lines = [`${run.stage} · ${run.status} · ${run.id}\nSource: ${run.source}\nTranscript: ${run.file}\n`];
  let streamed = false;
  let channel = "";
  for (const e of rows) {
    if (e.type === "message") {
      const m = e.message;
      if (m.role === "system") { streamed = false; channel = ""; }
      if (m.role === "system" || m.role === "user") {
        if (showRequests) lines.push(`\n[${m.role}]\n${typeof m.content === "string" ? m.content : JSON.stringify(m.content)}\n`);
        continue;
      }
      if (m.role === "assistant") {
        lines.push(`\n${m.provider}/${m.model} · ${m.stopReason} · $${(m.usage?.cost?.total ?? 0).toFixed(4)}`);
        // Deltas already display streamed text. Add final content for non-streaming providers/fakes only.
        if (!streamed) for (const b of m.content ?? []) if (b.type === "text" || b.type === "thinking") lines.push("\n" + (b.text ?? b.thinking ?? ""));
      }
    } else if (e.type === "custom") {
      if (e.customType === "maintenance.delta") {
        if (channel !== e.data.channel) lines.push(`\n[${e.data.channel}]\n`);
        channel = e.data.channel; streamed = true; lines.push(e.data.delta);
      }
      else if (e.customType === "maintenance.progress") lines.push(`\n${e.data.text}`);
      else if (e.customType === "maintenance.event") lines.push(`\n${e.data.type}: ${JSON.stringify(e.data.detail ?? "")}`);
      else if (e.customType === "maintenance.end") lines.push(`\n${e.data.status}: ${e.data.error ?? "finished"}`);
    }
  }
  const text = lines.join("");
  return text.length > MAX_VIEW ? `[Earlier output omitted from viewer; full transcript: ${run.file}]\n` + text.slice(-MAX_VIEW) : text;
}
/** Read-only native transcript projection, not an AgentSession/resume operation. */
export function sessionText(run: RunInfo, showSystem = false, showThinking = false, raw = false): string {
  const rows = entries(run.file);
  const parts = [`SESSION ${run.id} — ${run.stage} / ${run.status}\nTranscript: ${run.file}\nSource conversation: ${run.source}\n`];
  let pending = "";
  const messageText = (content: any) => typeof content === "string" ? content : (Array.isArray(content) ? content : []).flatMap((b: any) => {
    if (b.type === "text") return [b.text];
    if (b.type === "thinking") return showThinking ? [`[thinking]\n${b.thinking ?? "(opaque/redacted)"}`] : [];
    if (b.type === "toolCall") return [`[tool call: ${b.name}]\n${JSON.stringify(b.arguments, null, 2)}`];
    if (b.type === "image") return ["[image attachment omitted from text viewer]"];
    return [];
  }).join("\n\n");
  for (const row of rows) {
    if (raw) { parts.push(JSON.stringify(row, null, 2)); continue; }
    if (row.type === "message") {
      const message = row.message;
      if (message.role === "system") { pending = ""; if (!showSystem) continue; }
      if (message.role === "assistant") pending = ""; // final native response supersedes preview deltas
      const title = message.role === "assistant" ? `ASSISTANT — ${message.provider}/${message.model} — ${message.stopReason} — $${(message.usage?.cost?.total ?? 0).toFixed(4)}` : String(message.role).toUpperCase();
      parts.push(`${title}\n${messageText(message.content)}${message.errorMessage ? `\nError: ${message.errorMessage}` : ""}`);
    } else if (row.type === "custom" && row.customType === "maintenance.delta") {
      if (row.data.channel === "text" || showThinking) pending += row.data.delta;
    }
  }
  if (pending && !raw) parts.push(`ASSISTANT — partial/streamed output (not a completed message)\n${pending}`);
  if (!raw) parts.push("Read-only transcript. No session switch, model call, or replay is performed.");
  const text = parts.join("\n\n");
  return text.length > MAX_VIEW ? `[Earlier transcript content omitted from viewer; full JSONL: ${run.file}]\n` + text.slice(-MAX_VIEW) : text;
}

/** Own writer, outside normal session discovery. Never writes the source conversation. */
export class RunLog {
  readonly manager: SessionManager;
  readonly file: string;
  readonly id: string;
  private pending: { channel: string; delta: string }[] = [];
  private pendingChars = 0;
  private lastFlush = 0;
  private lastHeartbeat = 0;
  private closed = false;
  constructor(stateDir: string, readonly meta: RunMeta, readonly now = Date.now, readonly captureModels = true) {
    const dir = runsDir(stateDir);
    if (existsSync(dir) && lstatSync(dir).isSymbolicLink()) throw new Error("Refusing a symlinked maintenance runs directory");
    mkdirSync(dir, { recursive: true, mode: 0o700 }); chmodSync(dir, 0o700);
    this.prune(stateDir);
    this.manager = SessionManager.create(meta.cwd, dir);
    this.id = this.manager.getSessionId(); this.file = this.manager.getSessionFile()!;
    this.manager.appendSessionInfo(`Maintenance ${meta.stage}`);
    this.manager.appendCustomEntry("maintenance.run", meta);
    // SessionManager persists as soon as a conversation begins. This labeled operational
    // message is not a model request; actual requests are appended separately below.
    this.manager.appendMessage({ role: "user", content: `[Maintenance run: ${meta.stage}; operational metadata, not a model request]`, timestamp: now() });
    chmodSync(this.file, 0o600);
  }
  private prune(stateDir: string) {
    const files = listRuns(stateDir).filter(run => run.ended !== undefined).sort((a, b) => b.ended! - a.ended!);
    // Never prune active/unfinished runs, including those left by an interrupted owner.
    for (const [i, run] of files.entries()) if (i >= MAX_RUNS - 1 || this.now() - run.ended! > MAX_AGE) {
      unlinkSync(run.file); infoCache.delete(run.file);
    }
  }
  private check() {
    if (this.closed) throw new Error("Maintenance transcript is closed");
    if (statSync(this.file).size >= MAX_FILE) throw new Error("Maintenance transcript reached its 32 MiB safety limit");
  }
  event(type: string, detail?: unknown) {
    this.check(); this.flush(); this.manager.appendCustomEntry("maintenance.event", { type, detail, at: this.now() });
  }
  progress(text: string) { this.check(); this.flush(); this.manager.appendCustomEntry("maintenance.progress", { text, at: this.now() }); }
  model(event: ModelEvent) {
    this.check();
    if (!this.captureModels) {
      if (event.type === "start") this.event("model", { provider: event.provider, model: event.model, reasoning: event.reasoning, maxTokens: event.maxTokens });
      if (event.type === "end") this.event("model-end", { stopReason: event.message.stopReason, usage: event.message.usage });
      if (event.type === "delta" && this.now() - this.lastHeartbeat >= 1000) {
        this.event("model-progress", { channel: event.channel, characters: event.delta.length }); this.lastHeartbeat = this.now();
      }
      return;
    }
    if (event.type === "delta") {
      const last = this.pending.at(-1);
      if (last?.channel === event.channel) last.delta += event.delta;
      else this.pending.push({ channel: event.channel, delta: event.delta });
      this.pendingChars += event.delta.length;
      if (this.now() - this.lastFlush >= 250 || this.pendingChars >= 8192) this.flush();
    } else if (event.type === "start") {
      this.flush();
      this.event("model", { provider: event.provider, model: event.model, reasoning: event.reasoning, maxTokens: event.maxTokens });
      this.manager.appendModelChange(event.provider, event.model);
      this.manager.appendMessage({ role: "system", content: event.systemPrompt, timestamp: this.now() });
      for (const message of event.messages) this.manager.appendMessage(message);
    } else {
      this.flush(); this.manager.appendMessage(event.message);
    }
  }
  flush() {
    for (const delta of this.pending) this.manager.appendCustomEntry("maintenance.delta", { ...delta, at: this.now() });
    this.pending = []; this.pendingChars = 0; this.lastFlush = this.now();
  }
  finish(status: "complete" | "checkpoint" | "cancelled" | "error", error?: string) {
    if (this.closed) return;
    this.flush(); this.manager.appendCustomEntry("maintenance.end", { status, error, at: this.now() }); this.closed = true;
  }
}
export function findRun(stateDir: string, cwd: string, id?: string): RunInfo | undefined {
  const runs = listRuns(stateDir, cwd);
  return id ? runs.find(r => r.id === id || basename(r.file) === id) : runs[0];
}
