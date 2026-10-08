import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { loadConfigWithSource, parseConfig, duration } from "./config.ts";
import { Coordinator } from "./coordinator.ts";
import { Store } from "./store.ts";
import { discover } from "./protocol.ts";
import { formatSettings, formatStatus, timeSpan } from "./format.ts";
import { editSettings, saveSettings, settingsText, settingsFile } from "./settings.ts";
import { findRun, listRuns, runText } from "./runs.ts";
import { RunViewer } from "./viewer.ts";
import { HistoryViewer } from "./history.ts";
import { safeText } from "./text.ts";
import { passiveCommand, passiveTerminalInput } from "./passive-input.ts";

export default function maintenance(pi: ExtensionAPI) {
  let coordinator: Coordinator | undefined;
  let ctx: ExtensionContext | undefined;
  let error: string | undefined;
  let terminalInput: (() => void) | undefined;
  let transition: Promise<void> = Promise.resolve();
  let monitorOpen = false;
  let closeMonitor: (() => void) | undefined;
  const close = async () => {
    closeMonitor?.(); closeMonitor = undefined; monitorOpen = false;
    terminalInput?.(); terminalInput = undefined;
    await coordinator?.close(); coordinator = undefined;
  };
  pi.on("session_start", async (_event, nextCtx) => {
    transition = transition.then(async () => {
      await close(); ctx = nextCtx; error = undefined;
      try {
        if (!nextCtx.isProjectTrusted()) throw new Error("Maintenance requires a trusted working directory");
        const loaded = loadConfigWithSource(nextCtx.cwd);
        const config = loaded.config;
        const capabilities = discover(pi.events);
        const installed = new Set(pi.getAllTools().map((tool) => tool.name));
        if (config.summaries && installed.has("session_summarize") && !capabilities.summary) throw new Error("Update pi-session-search and reload: the installed package has no maintenance adapter");
        if ((config.knowledge || config.upgrades) && installed.has("memory_search") && !capabilities.memory) throw new Error("Update pi-okf-agent-memory and reload: the installed package has no maintenance adapter");
        coordinator = new Coordinator(pi.events, new Store(config.stateDir), config);
        await coordinator.attach(nextCtx, loaded.source);
        if (nextCtx.mode === "tui") terminalInput = nextCtx.ui.onTerminalInput((data) => {
          if (!monitorOpen && !passiveTerminalInput(nextCtx.ui.getEditorText(), data)) coordinator?.activity();
          return undefined;
        });
        coordinator.start();
      } catch (e) {
        error = (e as Error).message; await close();
        nextCtx.ui.notify(`Session maintenance setup failed: ${error}`, "error");
      }
    });
    await transition;
  });
  pi.on("input", (event) => { if (!passiveCommand(event.text)) coordinator?.activity(); });
  pi.on("agent_start", () => { coordinator?.activity(); });
  pi.on("agent_settled", () => { coordinator?.settled(); });
  pi.on("session_shutdown", async () => { await transition; await close(); ctx = undefined; });
  const requireCoordinator = () => {
    if (!coordinator) throw new Error(error ?? "Session maintenance is not initialized");
    return coordinator;
  };
  const inspectRun = async (commandCtx: ExtensionContext, history = false, id?: string) => {
    const c = requireCoordinator();
    if (monitorOpen) { commandCtx.ui.notify("Maintenance monitor is already open.", "info"); return; }
    monitorOpen = true;
    try {
      if (coordinator !== c) return;
      if (id && !findRun(c.config.stateDir, commandCtx.cwd, id)) throw new Error("Unknown run ID in this workspace; use /maintenance history.");
      if (commandCtx.mode !== "tui") {
        if (history && !id) {
          const runs = listRuns(c.config.stateDir, commandCtx.cwd);
          commandCtx.ui.notify(safeText(runs.slice(0, 30).map(r => `${r.id} — ${r.stage} ${r.status} — ${new Date(r.started).toLocaleString()}`).join("\n") || "No maintenance history yet."), "info");
        } else {
          const run = findRun(c.config.stateDir, commandCtx.cwd, id);
          commandCtx.ui.notify(run ? safeText(runText(run)).slice(-12000) : "No maintenance transcripts yet.", "info");
        }
        return;
      }
      await commandCtx.ui.custom<void>((tui, theme, _keys, done) => {
        const viewer = history ? new HistoryViewer(tui, theme, () => done(), c.config.stateDir, commandCtx.cwd, id)
          : new RunViewer(tui, theme, () => done(), c.config.stateDir, commandCtx.cwd, id);
        closeMonitor = () => { viewer.dispose(); done(); };
        return viewer;
      });
    } finally { closeMonitor = undefined; monitorOpen = false; }
  };
  pi.registerShortcut("ctrl+alt+m", { description: "Watch maintenance without interrupting it", handler: async commandCtx => {
    const runtimeAtEntry = coordinator;
    try { await inspectRun(commandCtx); } catch (error) { if (coordinator === runtimeAtEntry) commandCtx.ui.notify(safeText((error as Error).message), "error"); }
  } });
  const descriptions: Record<string, string> = {
    status: "Show ownership, work, coverage and blockers", settings: "Edit workspace settings interactively",
    watch: "Passively follow background output (Ctrl+Alt+M)", history: "Browse runs and results in a two-pane TUI; Enter views the session",
    run: "Start now or report the blocker; clear retry backoff", cancel: "Stop local work and suspend the workspace",
    suspend: "Pause for a duration, e.g. 30m", resume: "Clear workspace suspension and begin a fresh idle interval",
    off: "Disable this workspace", on: "Enable maintenance and clear workspace suspension",
    retry: "Alias for run: start now or report the blocker", backfill: "Queue one saved session from this workspace",
    help: "Show commands and examples",
  };
  const values = Object.keys(descriptions);
  const help = () => "Session maintenance commands\n" + values.map((v) => `/maintenance ${v} — ${descriptions[v]}`).join("\n") +
    "\n\nExamples: /maintenance suspend 30m · /maintenance settings · /maintenance backfill /path/to/session.jsonl";
  pi.registerCommand("maintenance", {
    description: "Session maintenance: status/watch/history/settings/run/retry/cancel/suspend/resume/off/on/backfill",
    getArgumentCompletions(prefix) {
      const matches = values.filter((v) => v.startsWith(prefix)).map((value) => ({ value, label: value }));
      return matches.length ? matches.map((m) => ({ ...m, description: descriptions[m.value] })) : null;
    },
    async handler(args, commandCtx) {
      const runtimeAtEntry = coordinator;
      try {
        const c = requireCoordinator();
        const [requested = "status", ...rest] = args.trim().split(/\s+/).filter(Boolean);
        const action = requested === "logs" ? "history" : requested; // compatibility alias, not advertised
        if (action === "status") commandCtx.ui.notify(formatStatus(c.status(), discover(pi.events)), "info");
        else if (action === "watch" || action === "history") await inspectRun(commandCtx, action === "history", rest[0]);
        else if (action === "settings") {
          if (!commandCtx.hasUI || rest[0] === "show") { commandCtx.ui.notify(formatSettings(c.config, commandCtx.cwd), "info"); return; }
          if (rest.length) throw new Error("Use /maintenance settings to edit, or /maintenance settings show to inspect.");
          const baseline = c.config;
          const fingerprint = JSON.stringify(baseline);
          const fileBefore = settingsText(commandCtx.cwd);
          const assertCurrent = () => {
            if (coordinator !== c || c.config !== baseline || JSON.stringify(c.config) !== fingerprint) throw new Error("Maintenance settings/session changed while the menu was open. Reopen settings; nothing was saved.");
          };
          const release = c.holdForSettings();
          try {
            if (c.status().control?.disabled || (c.status().control?.paused_until ?? 0) > Date.now()) {
              commandCtx.ui.notify("A workspace off/suspension override is active. Editing other settings preserves it; /maintenance on or resume clears it.", "info");
            }
            const draft = await editSettings(commandCtx, baseline, assertCurrent);
            if (!draft) { commandCtx.ui.notify("Settings cancelled; no configuration changes saved.", "info"); return; }
            const apply = transition.then(async () => {
              assertCurrent(); await c.cancel(); assertCurrent();
              saveSettings(commandCtx.cwd, draft, fileBefore);
              await c.configure(draft, { kind: "workspace-file", file: settingsFile(commandCtx.cwd) });
              if (!draft.enabled) c.off();
              else if (!baseline.enabled) c.on();
            });
            transition = apply.then(() => {}, () => {});
            await apply;
            commandCtx.ui.notify(`Settings saved to ${settingsFile(commandCtx.cwd)} and applied here. No reload needed in this instance; other open pi instances load them on /reload.`, "info");
          } finally { release(); }
        }
        else if (action === "run" || action === "retry") {
          const admission = await c.runNow();
          if (coordinator === c) commandCtx.ui.notify(safeText(admission), "info");
        }
        else if (action === "cancel") { await c.cancel(); c.suspend(c.config.idleSeconds); commandCtx.ui.notify(`Local work stopped; workspace suspended for ${timeSpan(c.config.idleSeconds)}. Other windows are asked to stop too. Completed checkpoints remain.`, "info"); }
        else if (action === "suspend") {
          const text = rest[0] ?? (commandCtx.hasUI ? await commandCtx.ui.input("Suspend maintenance for how long? (e.g. 30m, 2h)", "30m") : "30m");
          if (text === undefined) return;
          if (coordinator !== c) throw new Error("Session changed; retry suspension in the current session");
          const seconds = duration(text.trim() || "30m"); c.suspend(seconds);
          commandCtx.ui.notify(`Workspace maintenance paused for ${timeSpan(seconds)}. In-flight work is asked to stop; checkpoints remain. /maintenance resume clears the pause.`, "info");
        }
        else if (action === "resume") { c.resume(); commandCtx.ui.notify(`Workspace suspension/off cleared. ${c.config.enabled ? `Maintenance resumes after ${timeSpan(c.config.idleSeconds)} idle.` : "Maintenance is still disabled in settings."}`, "info"); }
        else if (action === "off") { c.off(); commandCtx.ui.notify("Maintenance disabled for this workspace. In-flight work is asked to stop; /maintenance on enables it again.", "info"); }
        else if (action === "on") { c.on(); commandCtx.ui.notify(`Maintenance enabled in this runtime; workspace overrides cleared. Work starts after ${timeSpan(c.config.idleSeconds)} idle.`, "info"); }
        else if (action === "backfill") {
          const path = rest.length ? rest.join(" ") : commandCtx.hasUI ? await commandCtx.ui.input("Saved session JSONL path (current workspace only)", "/path/to/session.jsonl") : undefined;
          if (!path) { if (!commandCtx.hasUI) throw new Error("Provide a path: /maintenance backfill /path/to/session.jsonl"); return; }
          if (coordinator !== c) throw new Error("Session changed; retry backfill in the current session");
          c.enqueue(path.trim()); commandCtx.ui.notify("Saved session queued. Its conversation stays read-only; archives are never compacted.", "info");
        }
        else if (action === "help") commandCtx.ui.notify(help(), "info");
        else throw new Error(`Unknown maintenance action: ${action}\n\n${help()}`);
      } catch (e) { if (coordinator === runtimeAtEntry) commandCtx.ui.notify(safeText((e as Error).message), "error"); }
    },
  });
  // Trusted host configuration (e.g. a future Yono adapter), not an LLM tool.
  pi.events.on("pi-session-maintenance:control:v1", (data) => {
    const r = data as { protocol: number; operation: string; settings?: unknown; seconds?: number; result?: Promise<unknown> };
    r.result = transition.then(async () => {
      if (r.protocol !== 1) throw new Error("Unsupported maintenance control protocol");
      const c = requireCoordinator();
      if (r.operation === "configure") {
        const config = parseConfig(r.settings, ctx!.cwd);
        await c.configure(config);
      } else if (r.operation === "suspend") c.suspend(duration(String(r.seconds ?? 1800)));
      else if (r.operation === "resume") c.resume();
      else if (r.operation === "cancel") await c.cancel();
      else if (r.operation === "run" || r.operation === "retry") {
        const admission = await c.runNow(); return { ...c.status(), admission };
      } else if (r.operation !== "status") throw new Error("Unknown maintenance control operation");
      return coordinator!.status();
    });
    transition = r.result.then(() => {}, () => {});
  });
}
