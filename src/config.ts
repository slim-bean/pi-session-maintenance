import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";

export interface Config {
  enabled: boolean; idleSeconds: number; pollSeconds: number;
  knowledge: boolean; summaries: boolean; upgrades: boolean;
  reviewModel?: string; summaryModel?: string;
  maxCostPerCycle: number; dailyBudget: number; modelTimeoutSeconds: number;
  compaction: { enabled: boolean; minTokens: number; budgetTokens?: number };
  push: boolean;
  modelTranscripts: boolean;
  memoryOwnership: "limited" | "full";
  memoryGitIdentity?: { name: string; email: string };
  stateDir: string;
}
const positive = (v: unknown, name: string, max: number): number => {
  if (typeof v !== "number" || !Number.isFinite(v) || v <= 0 || v > max) throw new Error(`${name} must be >0 and <=${max}`);
  return v;
};
const nonnegative = (v: unknown, name: string): number => {
  if (!Number.isSafeInteger(v) || (v as number) < 0) throw new Error(`${name} must be a nonnegative safe integer`);
  return v as number;
};
function keys(raw: Record<string, unknown>, allowed: string[], name: string) {
  for (const key of Object.keys(raw)) if (!allowed.includes(key)) throw new Error(`Unknown ${name} setting: ${key}`);
}
export function parseConfig(raw: unknown, cwd: string): Config {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new Error("maintenance config must be an object");
  const r = raw as Record<string, any>;
  keys(r, ["enabled", "idleSeconds", "pollSeconds", "knowledge", "summaries", "upgrades", "reviewModel", "summaryModel", "maxCostPerCycle", "dailyBudget", "compaction", "push", "modelTranscripts", "modelTimeoutSeconds", "memoryOwnership", "memoryGitIdentity", "stateDir"], "maintenance");
  for (const key of ["enabled", "knowledge", "summaries", "upgrades", "push", "modelTranscripts"]) {
    if (r[key] !== undefined && typeof r[key] !== "boolean") throw new Error(`${key} must be boolean`);
  }
  for (const key of ["reviewModel", "summaryModel"]) {
    if (r[key] !== undefined && (typeof r[key] !== "string" || !r[key].includes("/") || !r[key].trim())) throw new Error(`${key} must be provider/model-id`);
  }
  // Hosts opt into broader authority through the same generic settings as users.
  const ownership = r.memoryOwnership ?? process.env.PI_MEMORY_OWNERSHIP ?? "limited";
  if (ownership !== "limited" && ownership !== "full") throw new Error("memoryOwnership / PI_MEMORY_OWNERSHIP must be limited or full");
  if (r.memoryGitIdentity !== undefined) {
    if (!r.memoryGitIdentity || typeof r.memoryGitIdentity !== "object" || Array.isArray(r.memoryGitIdentity)) throw new Error("memoryGitIdentity must be {name,email}");
    keys(r.memoryGitIdentity, ["name", "email"], "memoryGitIdentity");
    for (const key of ["name", "email"]) if (typeof r.memoryGitIdentity[key] !== "string" || !r.memoryGitIdentity[key].trim() || /[\r\n\0]/.test(r.memoryGitIdentity[key])) throw new Error(`memoryGitIdentity.${key} must be a nonempty single-line string`);
  }
  const c = r.compaction ?? {};
  if (!c || typeof c !== "object" || Array.isArray(c)) throw new Error("compaction must be an object");
  keys(c, ["enabled", "minTokens", "budgetTokens"], "compaction");
  if (c.enabled !== undefined && typeof c.enabled !== "boolean") throw new Error("compaction.enabled must be boolean");
  if (r.stateDir !== undefined && (typeof r.stateDir !== "string" || !r.stateDir.trim())) throw new Error("stateDir must be a path");
  return {
    memoryOwnership: ownership, memoryGitIdentity: r.memoryGitIdentity ? { ...r.memoryGitIdentity } : undefined,
    enabled: r.enabled ?? true, knowledge: r.knowledge ?? true, summaries: r.summaries ?? true, upgrades: r.upgrades ?? true,
    idleSeconds: positive(r.idleSeconds ?? 600, "idleSeconds", 2_147_483),
    pollSeconds: positive(r.pollSeconds ?? 5, "pollSeconds", 60),
    reviewModel: r.reviewModel, summaryModel: r.summaryModel,
    modelTimeoutSeconds: positive(nonnegative(r.modelTimeoutSeconds ?? 600, "modelTimeoutSeconds"), "modelTimeoutSeconds", 3600),
    maxCostPerCycle: positive(r.maxCostPerCycle ?? 0.5, "maxCostPerCycle", 1000),
    dailyBudget: positive(r.dailyBudget ?? 5, "dailyBudget", 10000), push: r.push ?? false, modelTranscripts: r.modelTranscripts ?? true,
    compaction: { enabled: c.enabled ?? false, minTokens: nonnegative(c.minTokens ?? 50_000, "minTokens"),
      budgetTokens: c.budgetTokens === undefined ? undefined : positive(nonnegative(c.budgetTokens, "budgetTokens"), "budgetTokens", Number.MAX_SAFE_INTEGER) },
    stateDir: resolve(cwd, (r.stateDir ?? join(process.env.PI_CODING_AGENT_DIR ?? join(homedir(), ".pi", "agent"), "session-maintenance")).replace(/^~(?=\/|$)/, homedir())),
  };
}
export interface ConfigSource { kind: "workspace-file" | "defaults" | "host" | "programmatic"; file?: string; ownershipDefault?: "PI_MEMORY_OWNERSHIP" }
export function describeConfigSource(source: ConfigSource): string {
  const description = source.kind === "workspace-file" ? source.file! : source.kind === "defaults"
    ? `built-in defaults (no workspace config loaded from ${source.file})`
    : source.kind === "host" ? "runtime host override (not a settings file)" : "programmatic configuration";
  return description + (source.ownershipDefault ? `; memory ownership default from ${source.ownershipDefault}` : "");
}
export function loadConfigWithSource(cwd: string): { config: Config; source: ConfigSource } {
  const file = join(cwd, ".pi", "maintenance.json");
  const present = existsSync(file);
  try {
    const raw = present ? JSON.parse(readFileSync(file, "utf8")) : {};
    const ownershipDefault = raw?.memoryOwnership === undefined && process.env.PI_MEMORY_OWNERSHIP !== undefined ? "PI_MEMORY_OWNERSHIP" : undefined;
    return { config: parseConfig(raw, cwd), source: { kind: present ? "workspace-file" : "defaults", file, ownershipDefault } };
  } catch (error) { throw new Error(`Maintenance configuration ${file}: ${(error as Error).message}`); }
}
export function loadConfig(cwd: string): Config { return loadConfigWithSource(cwd).config; }
export function duration(text: string): number {
  const m = /^(\d+(?:\.\d+)?)(s|m|h|d)?$/.exec(text);
  if (!m) throw new Error("Use a duration such as 30m, 2h, or seconds");
  return positive(Number(m[1]) * ({ s: 1, m: 60, h: 3600, d: 86400 }[m[2] ?? "s"]!), "duration", 2_147_483);
}
