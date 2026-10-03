import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { loadConfig, parseConfig, duration } from "./config.ts";
import { Coordinator } from "./coordinator.ts";
import { Store } from "./store.ts";
import { discover } from "./protocol.ts";

export default function maintenance(pi: ExtensionAPI) {
  let coordinator: Coordinator | undefined;
  let ctx: ExtensionContext | undefined;
  let error: string | undefined;
  let terminalInput: (() => void) | undefined;
  let transition: Promise<void> = Promise.resolve();
  const close = async () => {
    terminalInput?.(); terminalInput = undefined;
    await coordinator?.close(); coordinator = undefined;
  };
  pi.on("session_start", async (_event, nextCtx) => {
    transition = transition.then(async () => {
      await close(); ctx = nextCtx; error = undefined;
      try {
        if (!nextCtx.isProjectTrusted()) throw new Error("Maintenance requires a trusted working directory");
        const config = loadConfig(nextCtx.cwd);
        const capabilities = discover(pi.events);
        const installed = new Set(pi.getAllTools().map((tool) => tool.name));
        if (config.summaries && installed.has("session_summarize") && !capabilities.summary) throw new Error("Update pi-session-search and reload: the installed package has no maintenance adapter");
        if ((config.knowledge || config.upgrades) && installed.has("memory_search") && !capabilities.memory) throw new Error("Update pi-okf-agent-memory and reload: the installed package has no maintenance adapter");
        coordinator = new Coordinator(pi.events, new Store(config.stateDir), config);
        await coordinator.attach(nextCtx);
        if (nextCtx.mode === "tui") terminalInput = nextCtx.ui.onTerminalInput(() => { coordinator?.activity(); return undefined; });
        coordinator.start();
      } catch (e) {
        error = (e as Error).message; await close();
        nextCtx.ui.notify(`Session maintenance setup failed: ${error}`, "error");
      }
    });
    await transition;
  });
  pi.on("input", () => { coordinator?.activity(); });
  pi.on("agent_start", () => { coordinator?.activity(); });
  pi.on("agent_settled", () => { coordinator?.settled(); });
  pi.on("session_shutdown", async () => { await transition; await close(); ctx = undefined; });
  const requireCoordinator = () => {
    if (!coordinator) throw new Error(error ?? "Session maintenance is not initialized");
    return coordinator;
  };
  const values = ["status", "settings", "run", "cancel", "suspend", "resume", "off", "on", "retry", "backfill"];
  pi.registerCommand("maintenance", {
    description: "Session maintenance: status/settings/run/cancel/suspend/resume/off/on/retry/backfill",
    getArgumentCompletions(prefix) {
      const matches = values.filter((v) => v.startsWith(prefix)).map((value) => ({ value, label: value }));
      return matches.length ? matches : null;
    },
    async handler(args, commandCtx) {
      try {
        const c = requireCoordinator();
        const [action = "status", ...rest] = args.trim().split(/\s+/).filter(Boolean);
        if (action === "status") {
          const status = c.status();
          commandCtx.ui.notify(JSON.stringify({ ...status, sessions: status.sessions.slice(0, 20), additionalSessions: Math.max(0, status.sessions.length - 20), capabilities: discover(pi.events) }, null, 2), "info");
        }
        else if (action === "settings") commandCtx.ui.notify(`Settings: ${commandCtx.cwd}/.pi/maintenance.json\n${JSON.stringify(c.config, null, 2)}`, "info");
        else if (action === "run") { c.requestRun(); commandCtx.ui.notify("Maintenance queued; it waits for safe idle. No active agent turn is interrupted.", "info"); }
        else if (action === "cancel") { await c.cancel(); c.suspend(c.config.idleSeconds); commandCtx.ui.notify("Maintenance stopped; checkpoints retained. Retry after the suspension or /maintenance resume.", "info"); }
        else if (action === "suspend") c.suspend(duration(rest[0] ?? "30m"));
        else if (action === "resume") c.resume();
        else if (action === "off") c.off();
        else if (action === "on") c.on();
        else if (action === "retry") c.retry();
        else if (action === "backfill" && rest.length) { c.enqueue(rest.join(" ")); commandCtx.ui.notify("Saved session queued. Source stays read-only; no compaction of archives.", "info"); }
        else throw new Error(`Usage: /maintenance [${values.join("|")}]`);
      } catch (e) { commandCtx.ui.notify((e as Error).message, "error"); }
    },
  });
  // Trusted host configuration (e.g. a future Yono adapter), not an LLM tool.
  pi.events.on("pi-session-maintenance:control:v1", (data) => {
    const r = data as { protocol: number; operation: string; settings?: unknown; seconds?: number; result?: Promise<unknown> };
    r.result = transition.then(async () => {
      if (r.protocol !== 1) throw new Error("Unsupported maintenance control protocol");
      const c = requireCoordinator();
      if (r.operation === "configure") {
        await c.cancel();
        const config = parseConfig(r.settings, ctx!.cwd);
        // Durable state location is a startup setting; never move a live queue silently.
        if (config.stateDir !== c.config.stateDir) throw new Error("Changing stateDir requires reload");
        await c.close();
        coordinator = new Coordinator(pi.events, new Store(config.stateDir), config);
        await coordinator.attach(ctx!); coordinator.start();
      } else if (r.operation === "suspend") c.suspend(duration(String(r.seconds ?? 1800)));
      else if (r.operation === "resume") c.resume();
      else if (r.operation === "cancel") await c.cancel();
      else if (r.operation === "run") c.requestRun();
      else if (r.operation !== "status") throw new Error("Unknown maintenance control operation");
      return coordinator!.status();
    });
    transition = r.result.then(() => {}, () => {});
  });
}
