import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { existsSync, lstatSync, mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { dirname, join } from "node:path";
import { duration, parseConfig, type Config } from "./config.ts";
import { money, prettyPath, timeSpan } from "./format.ts";

export const settingsFile = (cwd: string) => join(cwd, ".pi", "maintenance.json");
export function settingsText(cwd: string): string | null {
  const file = settingsFile(cwd);
  try {
    if (lstatSync(file).isSymbolicLink()) throw new Error("Refusing to replace a symlinked maintenance.json; edit its intended target directly");
    return readFileSync(file, "utf8");
  } catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return null; throw error; }
}
/** Human-authorized workspace save; compare before rename so external edits survive. */
export function saveSettings(cwd: string, config: Config, expected: string | null): void {
  parseConfig(config, cwd);
  if (settingsText(cwd) !== expected) throw new Error("maintenance.json changed while settings were open. Reopen the menu; no external edits were overwritten.");
  const stored: Partial<Config> = { ...config };
  let original: any;
  try { original = expected === null ? {} : JSON.parse(expected); } catch { original = {}; }
  if (typeof original.stateDir === "string" && parseConfig({ stateDir: original.stateDir }, cwd).stateDir === config.stateDir) stored.stateDir = original.stateDir;
  else if (config.stateDir === parseConfig({}, cwd).stateDir) delete stored.stateDir; // don't pin the default to this machine's home
  const file = settingsFile(cwd);
  mkdirSync(dirname(file), { recursive: true });
  const temp = join(dirname(file), `.maintenance-${randomUUID()}.tmp`);
  try {
    writeFileSync(temp, JSON.stringify(stored, null, 2) + "\n", { mode: 0o600, flag: "wx" });
    if (settingsText(cwd) !== expected) throw new Error("maintenance.json changed before saving; no external edits were overwritten");
    renameSync(temp, file);
  } finally { if (existsSync(temp)) unlinkSync(temp); }
}
const enabled = (value: boolean) => value ? "on" : "off";
const automatic = "Automatic — pin the active model when a session is first processed";
async function chooseModel(ctx: ExtensionContext, title: string, assertCurrent: () => void): Promise<string | null | undefined> {
  // Catalogue snapshots only: no key resolution, credential refresh or model call.
  const models = ctx.modelRegistry.getAvailable?.() ?? ctx.modelRegistry.getAll?.() ?? [];
  const ids = [...new Set(models.map((m) => `${m.provider}/${m.id}`))].sort();
  const custom = "Enter a provider/model ID…";
  const selected = await ctx.ui.select(title, [automatic, custom, ...ids]);
  assertCurrent();
  if (selected === undefined) return undefined;
  if (selected === automatic) return null;
  if (selected !== custom) return selected;
  const value = await ctx.ui.input(`${title} (provider/model-id)`, "provider/model-id");
  return value?.trim();
}
function tokenCount(value: string): number {
  const m = /^(\d+(?:\.\d+)?)([km])?$/i.exec(value.trim().replace(/,/g, ""));
  if (!m) throw new Error("Enter a token count such as 50000, 50,000 or 50k");
  return Number(m[1]) * (m[2]?.toLowerCase() === "k" ? 1000 : m[2]?.toLowerCase() === "m" ? 1_000_000 : 1);
}
/** Draft-only menu. Esc/Cancel discards; caller owns guarded persistence/application. */
export async function editSettings(ctx: ExtensionContext, current: Config, assertCurrent: () => void): Promise<Config | undefined> {
  let draft: Config = { ...current, compaction: { ...current.compaction } };
  while (true) {
    assertCurrent();
    const options = [
      { key: "enabled", label: `Configured enablement: ${enabled(draft.enabled)}` },
      { key: "idleSeconds", label: `Idle delay: ${timeSpan(draft.idleSeconds)}` },
      { key: "knowledge", label: `Knowledge review: ${enabled(draft.knowledge)}` },
      { key: "upgrades", label: `OKF upgrades: ${enabled(draft.upgrades)}` },
      { key: "summaries", label: `Search summaries: ${enabled(draft.summaries)}` },
      { key: "reviewModel", label: `Review model: ${draft.reviewModel ?? "automatic (pinned per session)"}` },
      { key: "summaryModel", label: `Summary model: ${draft.summaryModel ?? "automatic (pinned per session)"}` },
      { key: "dailyBudget", label: `Daily model budget: ${money(draft.dailyBudget)} (approx.)` },
      { key: "maxCostPerCycle", label: `Budget per opportunity: ${money(draft.maxCostPerCycle)} (approx.)` },
      { key: "compaction", label: `Maintenance compaction: ${enabled(draft.compaction.enabled)}` },
      { key: "minTokens", label: `Idle compaction floor: ${draft.compaction.minTokens.toLocaleString()} tokens` },
      { key: "budgetTokens", label: `Between-turn context budget: ${draft.compaction.budgetTokens?.toLocaleString() ?? "off"}` },
      { key: "pollSeconds", label: `Check interval: ${timeSpan(draft.pollSeconds)}` },
      { key: "push", label: `Push committed knowledge to upstream: ${enabled(draft.push)}` },
      { key: "modelTranscripts", label: `Save private model prompts/output: ${enabled(draft.modelTranscripts)}` },
      { key: "storage", label: `Private state: ${prettyPath(draft.stateDir)} (read-only here)` },
      { key: "save", label: "Save & apply changes" },
      { key: "cancel", label: "Cancel — discard changes" },
    ];
    const selected = await ctx.ui.select(`Maintenance settings — ${prettyPath(settingsFile(ctx.cwd))}`, options.map((o) => o.label));
    assertCurrent();
    const key = options.find((o) => o.label === selected)?.key;
    if (!key || key === "cancel") return undefined;
    if (key === "save") return parseConfig(draft, ctx.cwd);
    if (key === "storage") { ctx.ui.notify("State location changes require editing maintenance.json and reloading. No files were moved.", "info"); continue; }
    const next: Config = { ...draft, compaction: { ...draft.compaction } };
    try {
      if (["enabled", "knowledge", "upgrades", "summaries", "push", "modelTranscripts"].includes(key)) {
        const flag = key as "enabled" | "knowledge" | "upgrades" | "summaries" | "push" | "modelTranscripts";
        if (flag === "push" && !next.push) {
          const approved = await ctx.ui.confirm("Enable automatic knowledge pushes?", "This publishes the entire existing configured Git branch, not just knowledge files. No force pushes or automatic rebases are performed. Configure the intended upstream and unattended Git credentials first.");
          assertCurrent();
          if (!approved) continue;
        }
        next[flag] = !next[flag];
      } else if (key === "compaction") next.compaction.enabled = !next.compaction.enabled;
      else if (key === "reviewModel" || key === "summaryModel") {
        const choice = await chooseModel(ctx, key === "reviewModel" ? "Knowledge review model" : "Session summary model", assertCurrent);
        assertCurrent();
        if (choice === undefined) continue;
        next[key] = choice === null ? undefined : choice;
      } else {
        const numeric = key as "idleSeconds" | "pollSeconds" | "dailyBudget" | "maxCostPerCycle" | "minTokens" | "budgetTokens";
        const prompt = numeric === "idleSeconds" ? "Idle delay (e.g. 10m, 30m or seconds)" : numeric === "pollSeconds" ? "Check interval (seconds, max 60)" :
          numeric === "minTokens" ? "Idle compaction floor (e.g. 50k; 0 removes the floor)" : numeric === "budgetTokens" ? "Between-turn token budget (e.g. 200k; off disables it)" : "Model budget in USD (approximate; positive number)";
        const previous = numeric === "minTokens" || numeric === "budgetTokens" ? draft.compaction[numeric] : draft[numeric];
        const text = await ctx.ui.input(prompt, previous?.toString() ?? "off");
        assertCurrent();
        if (text === undefined) continue;
        if (numeric === "minTokens") next.compaction.minTokens = tokenCount(text);
        else if (numeric === "budgetTokens") next.compaction.budgetTokens = /^off$/i.test(text.trim()) ? undefined : tokenCount(text);
        else if (numeric === "idleSeconds" || numeric === "pollSeconds") next[numeric] = duration(text.trim());
        else next[numeric] = Number(text.trim().replace(/^\$/, "").replace(/,/g, ""));
      }
      draft = parseConfig(next, ctx.cwd);
    } catch (error) {
      assertCurrent();
      ctx.ui.notify((error as Error).message, "error");
    }
  }
}
