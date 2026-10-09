import type { Theme } from "@earendil-works/pi-coding-agent";
import { wrapTextWithAnsi, truncateToWidth } from "@earendil-works/pi-tui";
import { basename } from "node:path";
import { readRunEntries, type RunInfo } from "./runs.ts";
import { safeText } from "./text.ts";
export type Tone = "accent" | "success" | "warning" | "error" | "muted" | "text";
export interface Row { label?: string; text: string; tone?: Tone; heading?: boolean }
export const estimateNote = "~tokens = visible characters / 4, rounded per block. Not a tokenizer or billing count; images/opaque content and provider framing are unknown.";
const object = (v: any) => v && typeof v === "object" && !Array.isArray(v) ? v : {};
const number = (n: any) => typeof n === "number" && Number.isFinite(n) && n >= 0;
const count = (n: number) => n.toLocaleString();
const cost = (n: number) => `$${n.toFixed(4)}`;
const name = (s: string) => s.replace(/([a-z])([A-Z])/g, "$1 $2").replace(/[_-]/g, " ").replace(/^./, c => c.toUpperCase());
export function statusStyle(status: string): { icon: string; tone: Tone; text: string } {
  return ({ complete: { icon: "✓", tone: "success", text: "Complete" }, checkpoint: { icon: "◐", tone: "accent", text: "Checkpoint saved" },
    error: { icon: "✗", tone: "error", text: "Failed" }, cancelled: { icon: "■", tone: "warning", text: "Cancelled" } } as Record<string, { icon: string; tone: Tone; text: string }>)[status]
    ?? { icon: "◌", tone: "warning", text: "Active / unfinished" };
}
export function renderRows(rows: Row[], theme: Theme, width: number): string[] {
  return rows.flatMap(row => {
    const label = row.label ? `${safeText(row.label)}${row.heading ? "" : ": "}` : "";
    const styled = label ? theme.fg(row.tone ?? "accent", theme.bold?.(label) ?? label) : "";
    const value = safeText(row.text);
    const text = row.heading ? theme.fg(row.tone ?? "accent", theme.bold?.(label + value) ?? (label + value))
      : styled + (row.tone === "error" || row.tone === "warning" ? theme.fg(row.tone, value) : value);
    return wrapTextWithAnsi(text, Math.max(1, width)).map(line => truncateToWidth(line, width));
  });
}
/** Same local heuristic as pi-context; signatures/base64/storage wrappers are not text. */
function size(content: any): { tokens: number; unknown: boolean } {
  if (typeof content === "string") return { tokens: Math.ceil(content.length / 4), unknown: false };
  if (Array.isArray(content)) return content.map(size).reduce((a, b) => ({ tokens: a.tokens + b.tokens, unknown: a.unknown || b.unknown }), { tokens: 0, unknown: false });
  const b = object(content);
  if (b.type === "text") return size(b.text ?? "");
  if (b.type === "thinking") return { ...size(b.thinking ?? ""), unknown: Boolean(b.thinkingSignature || b.redacted) };
  if (b.type === "toolCall") return { tokens: size(b.name ?? "").tokens + size(JSON.stringify(b.arguments ?? {})).tokens, unknown: Boolean(b.thoughtSignature) };
  return { tokens: 0, unknown: Boolean(content) };
}
interface Call { model?: string; actualModel?: string; reasoning?: string; maxTokens?: number; inputs: any[]; systems: any[]; users: any[]; output?: any; text: string; thinking: string; streamRecorded: boolean; usage?: any; stop?: string; abortReason?: string; errorMessage?: string; elapsedMs?: number; timeoutMs?: number }
function calls(entries: any[]): Call[] {
  const result: Call[] = []; let current: Call | undefined;
  const begin = (d: any = {}) => { current = { model: d.provider && d.model ? `${d.provider}/${d.model}` : undefined,
    reasoning: d.reasoning, maxTokens: d.maxTokens, timeoutMs: d.timeoutMs, inputs: [], systems: [], users: [], text: "", thinking: "", streamRecorded: false }; result.push(current); return current; };
  for (const e of entries) {
    const d = object(e.data);
    if (e.type === "custom" && e.customType === "maintenance.event" && d.type === "model") begin(object(d.detail));
    else if (e.type === "message") {
      const m = object(e.message);
      if (m.role === "system") { if (!current || current.output || current.inputs.length) begin(); current!.inputs.push(m.content); current!.systems.push(m.content); }
      else if (m.role === "user" && !String(m.content).startsWith("[Maintenance run:")) {
        const c = current ?? begin(); c.inputs.push(m.content); c.users.push(m.content);
      }
      else if (m.role === "assistant") {
        const c = current ?? begin(); c.model = `${m.provider}/${m.model}`; c.actualModel = m.responseModel;
        c.output = m.content; c.usage = m.usage ?? c.usage; c.stop = m.stopReason; c.errorMessage = m.errorMessage;
      }
    } else if (e.type === "custom" && e.customType === "maintenance.delta") {
      const c = current ?? begin(); c.streamRecorded = true; if (d.channel === "text") c.text += d.delta ?? ""; else if (d.channel === "thinking") c.thinking += d.delta ?? "";
    } else if (e.type === "custom" && e.customType === "maintenance.event" && ["usage", "model-end"].includes(d.type)) {
      const c = current ?? begin(); c.usage = (d.type === "usage" ? d.detail : d.detail?.usage) ?? c.usage; c.stop = d.detail?.stopReason ?? c.stop;
      if (d.type === "model-end") {
        c.abortReason = d.detail?.abortReason; c.errorMessage = d.detail?.errorMessage ?? c.errorMessage;
        c.elapsedMs = d.detail?.elapsedMs; c.timeoutMs = d.detail?.timeoutMs ?? c.timeoutMs;
      }
    }
  }
  return result;
}
function usageRows(call: Call, index: number): Row[] {
  const rows: Row[] = [{ heading: true, text: `🤖 Model${index > 0 ? ` ${index + 1}` : ""}: ${call.model ?? "not recorded"}` }];
  if (call.actualModel) rows.push({ label: "Actual response model", text: call.actualModel });
  if (call.reasoning) rows.push({ label: "Reasoning level", text: call.reasoning });
  if (call.maxTokens !== undefined) rows.push({ label: "Output limit", text: `${count(call.maxTokens)} tokens (not usage)` });
  if (number(call.timeoutMs)) rows.push({ label: "Call deadline", text: `${call.timeoutMs! / 1000}s` });
  if (number(call.elapsedMs)) rows.push({ label: "Call elapsed", text: `${(call.elapsedMs! / 1000).toFixed(1)}s` });
  const u = object(call.usage);
  const reported = [u.input, u.output, u.cacheRead, u.cacheWrite].every(number) && u.input + u.output + u.cacheRead + u.cacheWrite > 0;
  if (reported) {
    rows.push({ label: "Input · provider-reported", text: `${count(u.input + u.cacheRead + u.cacheWrite)} tokens`, tone: "success" },
      { label: "Input breakdown", text: `uncached ${count(u.input)} · cache read ${count(u.cacheRead)} · cache write ${count(u.cacheWrite)}` },
      { label: "Output · provider-reported", text: `${count(u.output)} tokens`, tone: "success" });
    if (number(u.reasoning)) rows.push({ label: "Reasoning output", text: `${count(u.reasoning)} tokens (included in output, not added again)` });
    if (number(u.cacheWrite1h)) rows.push({ label: "1-hour cache writes", text: `${count(u.cacheWrite1h)} tokens (subset of cache writes)` });
  } else rows.push({ label: "Provider token usage", text: "Unavailable (missing or all-zero report)", tone: "muted" });
  if (number(u.cost?.total)) rows.push({ label: "💵 Cost · recorded", text: cost(u.cost.total) + (u.cost.total === 0 ? " (recorded zero; not proof of free inference)" : ""), tone: "success" });
  else rows.push({ label: "Cost", text: "Unavailable; not inferred from token estimates", tone: "muted" });
  if ([u.cost?.input, u.cost?.output, u.cost?.cacheRead, u.cost?.cacheWrite].every(number)) rows.push({ label: "Cost breakdown",
    text: `input ${cost(u.cost.input)} · output ${cost(u.cost.output)} · cache read ${cost(u.cost.cacheRead)} · cache write ${cost(u.cost.cacheWrite)}`, tone: "muted" });
  const input = call.inputs.length ? size(call.inputs) : undefined;
  const output = call.output !== undefined ? size(call.output) : call.streamRecorded
    ? size([{ type: "text", text: call.text }, { type: "thinking", thinking: call.thinking }]) : undefined;
  const estimate = (value: { tokens: number; unknown: boolean }) => `~${count(value.tokens)} tokens${value.unknown ? " + unknown non-text/opaque content" : ""}`;
  rows.push({ label: "Visible input · estimate", text: input ? estimate(input) : "Unavailable (prompts not recorded)", tone: "muted" },
    { label: "Visible output · estimate", text: output ? estimate(output) + (call.output === undefined ? " (partial stream only)" : "") : "Unavailable (output not recorded)", tone: "muted" });
  if (call.stop) rows.push({ label: "Stop reason", text: call.stop, tone: ["error", "aborted", "length"].includes(call.stop) ? "warning" : "muted" });
  if (call.abortReason) rows.push({ label: "Abort reason", text: call.abortReason, tone: "warning" });
  if (call.errorMessage) rows.push({ label: "Provider error", text: call.errorMessage, tone: "warning" });
  if (call.stop === "aborted" && !call.abortReason && !call.errorMessage) rows.push({ label: "Abort reason",
    text: "Not recorded in this transcript; check the run termination details below. Older records cannot distinguish timeout from cancellation.", tone: "muted" });
  return rows;
}
function parse(text: string): any | undefined {
  try { const v = JSON.parse(text.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "")); return typeof v === "object" && v !== null ? v : undefined; } catch { return; }
}
/** Bounded fallback: preserve unknown fields in readable rows, never infer successful work. */
function details(value: any, prefix = "", depth = 0): Row[] {
  if (value === undefined) return [];
  if (depth > 5) return [{ label: prefix, text: "[Nested detail omitted; use r for raw JSON]", tone: "muted" }];
  if (Array.isArray(value) && /(?:Entries|Source refs)$/i.test(prefix) && value.every(Number.isInteger)) return [{ label: "Source entries", text: value.map(n => `#${n}`).join(", ") || "None" }];
  if (Array.isArray(value)) return value.slice(0, 50).flatMap((v, i) => details(v, `${prefix} ${i + 1}`, depth + 1))
    .concat(value.length > 50 ? [{ text: `[${value.length - 50} more entries; use r for raw JSON]`, tone: "muted" as Tone }] : []);
  if (value && typeof value === "object") return Object.entries(value).flatMap(([k, v]) => details(v, prefix ? `${prefix} · ${name(k)}` : name(k), depth + 1));
  const text = String(value); return [{ label: prefix || "Value", text: text.length > 12000 ? text.slice(0, 12000) + "\n[Truncated; use r for raw JSON]" : text }];
}
function responseRows(text: string): Row[] {
  const data = parse(text);
  if (!data) return [{ text }];
  if (typeof data.reviewed === "boolean" && Array.isArray(data.changes)) {
    const rows: Row[] = [{ label: "Review decision", text: data.reviewed ? "Reviewed" : "Not reviewed" }];
    if (!data.changes.length) rows.push({ text: "○ No durable changes proposed.", tone: "muted" });
    for (const c of data.changes.slice(0, 50)) rows.push({ heading: true, text: `📝 ${c.title ?? c.concept ?? "Proposed change"}` },
      ...details(c));
    return rows;
  }
  if (typeof data.overview === "string" && Array.isArray(data.topics)) return [{ label: "Overview", text: data.overview },
    ...data.topics.slice(0, 50).flatMap((topic: any) => [{ heading: true, text: `📌 ${topic.title ?? "Topic"}` } as Row, ...details(topic)])];
  return details(data);
}
export function runRows(run: RunInfo, options: { prompts?: boolean; thinking?: boolean; session?: boolean } = {}): Row[] {
  const entries = readRunEntries(run); const status = statusStyle(run.status); const modelCalls = calls(entries);
  const rows: Row[] = [{ heading: true, text: `${status.icon} ${name(run.stage)} — ${status.text}`, tone: status.tone },
    { label: "Source", text: basename(run.source), tone: "muted" }];
  if (run.progress) rows.push({ label: "Progress", text: run.progress });
  if (modelCalls.length > 1) {
    const priced = modelCalls.filter(call => number(call.usage?.cost?.total));
    const amount = priced.reduce((sum, call) => sum + call.usage.cost.total, 0);
    rows.push({ label: priced.length === modelCalls.length ? "💵 Run cost · recorded total" : "💵 Known cost subtotal",
      text: priced.length ? `${cost(amount)} · ${priced.length}/${modelCalls.length} calls have recorded costs` : "Unavailable", tone: "accent" });
  }
  if (options.session) {
    for (const [i, call] of modelCalls.entries()) {
      if (options.prompts) call.systems.forEach(input => rows.push({ heading: true, text: "⚙ System prompt" }, { text: typeof input === "string" ? input : JSON.stringify(input, null, 2) }));
      call.users.forEach(input => rows.push({ heading: true, text: "👤 Recorded user/input" }, ...responseRows(typeof input === "string" ? input : JSON.stringify(input))));
      const blocks = Array.isArray(call.output) ? call.output : [];
      const output = call.output !== undefined ? blocks.filter(b => b.type === "text").map(b => b.text).join("\n") : call.text;
      rows.push({ heading: true, text: `🤖 Assistant · ${call.model ?? "not recorded"}${call.output === undefined ? " · partial stream" : ""}` }, ...responseRows(output));
      const thinking = call.output !== undefined ? blocks.filter(b => b.type === "thinking").map(b => b.thinking ?? "").join("\n") : call.thinking;
      if (options.thinking && thinking) rows.push({ heading: true, text: "💭 Visible thinking" }, { text: thinking, tone: "muted" });
      rows.push(...usageRows(call, i));
    }
    const end = entries.filter(e => e.type === "custom" && e.customType === "maintenance.end").at(-1)?.data;
    if (end?.error) rows.push({ label: "Run termination", text: end.error, tone: "warning" });
    rows.push({ text: estimateNote, tone: "muted" }); return rows.slice(0, 4096);
  }
  // Outcomes first: let users see the actual result without wading through model JSON.
  for (const e of entries) if (e.type === "custom" && e.customType === "maintenance.event") {
    const { type, detail: d } = object(e.data);
    if (type === "outcome") rows.push({ heading: true, text: `📋 Result${d?.complete === true ? " · completed" : " · checkpoint/pending"}` }, ...details(d?.detail ?? d));
    else if (type === "validation") rows.push({ heading: true, text: d?.ok === true ? "✓ Validation passed" : "⚠ Validation not confirmed", tone: d?.ok === true ? "success" : "warning" }, ...details(d?.advisories));
    else if (type === "commit") rows.push({ label: "🔗 Commit", text: d?.commit ?? "No new commit", tone: d?.commit ? "success" : "muted" });
    else if (type === "error" || type === "cancelled") rows.push({ heading: true, text: type === "error" ? "✗ Error / blocker" : "■ Cancelled", tone: type === "error" ? "error" : "warning" }, ...details(d));
    else if (!["model", "usage", "model-end", "model-progress"].includes(type)) rows.push({ heading: true, text: `◇ ${name(String(type))}` }, ...details(d));
  }
  const end = entries.filter(e => e.type === "custom" && e.customType === "maintenance.end").at(-1)?.data;
  if (end?.error) rows.push({ label: "Reason", text: end.error, tone: end.status === "cancelled" ? "warning" : "error" });
  modelCalls.forEach((call, i) => rows.push(...usageRows(call, i)));
  if (modelCalls.length) rows.push({ text: estimateNote, tone: "muted" });
  for (const call of modelCalls) {
    if (options.prompts) {
      rows.push({ heading: true, text: "📥 Recorded request" });
      call.inputs.forEach((input, i) => rows.push({ label: i === 0 ? "Prompt / input" : "Input", text: typeof input === "string" ? input : JSON.stringify(input, null, 2) }));
    }
    const content = Array.isArray(call.output) ? call.output : [];
    const text = call.output !== undefined ? content.filter(b => b.type === "text").map(b => b.text).join("\n") : call.text;
    if (text) rows.push({ heading: true, text: call.output !== undefined ? "💬 Model response / proposal (not proof of application)" : "◌ Partial model output" }, ...responseRows(text));
    const thinking = call.output !== undefined ? content.filter(b => b.type === "thinking").map(b => b.thinking ?? "").join("\n") : call.thinking;
    if (options.thinking && thinking) rows.push({ heading: true, text: "💭 Visible thinking" }, { text: thinking, tone: "muted" });
    else if (thinking) rows.push({ text: "💭 Thinking hidden · t to show", tone: "muted" });
  }
  return rows.slice(0, 4096);
}
