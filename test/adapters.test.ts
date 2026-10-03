import assert from "node:assert/strict";
import { test } from "node:test";
import { EventEmitter } from "node:events";
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, realpathSync } from "node:fs";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { Coordinator } from "../src/coordinator.ts";
import { Store } from "../src/store.ts";
import { parseConfig } from "../src/config.ts";
import { registerMemoryMaintenance } from "../../pi-okf-agent-memory/lib/maintenance.ts";
import { registerSummaryMaintenance } from "../../pi-session-search/extension/maintenance.ts";
import { SessionIndex } from "../../pi-session-search/extension/indexer.ts";

test("real package adapters compose with the coordinator using only a fake provider and temporary data", async () => {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), "maintenance-integration-")));
  const env = { ...process.env };
  process.env.PI_CODING_AGENT_DIR = dir; delete process.env.OKF_KNOWLEDGE_DIR;
  process.env.GIT_CONFIG_GLOBAL = "/dev/null"; process.env.GIT_CONFIG_NOSYSTEM = "1";
  const binary = resolve(import.meta.dirname, "../../pi-okf-agent-memory/bin/okf-" + process.platform + "-" + (process.arch === "x64" ? "amd64" : process.arch));
  const bundle = join(dir, "knowledge");
  execFileSync(binary, ["init", bundle]);
  for (const args of [["init", "--quiet"], ["config", "user.name", "Offline Integration"], ["config", "user.email", "offline@example.invalid"], ["config", "commit.gpgsign", "false"]]) {
    execFileSync("git", ["-C", bundle, ...args]);
  }
  const path = join(dir, "sessions", "fixture", "s.jsonl"); mkdirSync(join(dir, "sessions", "fixture"), { recursive: true });
  const entries: any[] = [
    { type: "message", id: "a", parentId: null, message: { role: "user", content: "a question" } },
    { type: "message", id: "b", parentId: "a", message: { role: "assistant", content: [{ type: "text", text: "main answer" }] } },
    { type: "message", id: "c", parentId: "a", message: { role: "assistant", content: [{ type: "text", text: "valuable branch evidence" }] } },
  ];
  const source = [{ type: "session", id: "fixture", cwd: dir }, ...entries].map((e) => JSON.stringify(e)).join("\n") + "\n";
  writeFileSync(path, source);
  const bus = new EventEmitter(); const hooks = new Map<string, Function[]>();
  const pi: any = { events: { emit: (c: string, r: any) => bus.emit(c, r), on: (c: string, f: any) => bus.on(c, f) },
    on: (name: string, fn: Function) => hooks.set(name, [...(hooks.get(name) ?? []), fn]) };
  const model: any = { provider: "fake", id: "offline", contextWindow: 200000, maxTokens: 8192 };
  let calls = 0;
  const ctx: any = { cwd: dir, model, isIdle: () => true, hasPendingMessages: () => false,
    sessionManager: { getSessionFile: () => path, getEntries: () => entries, getBranch: () => entries },
    getContextUsage: () => ({ tokens: 10 }), ui: { notify() {}, setStatus() {} },
    modelRegistry: { find: () => model, hasConfiguredAuth: () => true, streamSimple(_m: any, input: any) {
      calls++;
      const isSummary = input.systemPrompt.startsWith("Create a search-oriented");
      if (isSummary || input.systemPrompt.includes("Extract only durable WHY")) assert.match(input.messages[0].content, /valuable branch evidence/);
      return { result: async () => ({ stopReason: "stop", content: [{ type: "text", text: JSON.stringify(isSummary
        ? { overview: "all branches", topics: [{ title: "Sidequest", summary: "valuable", keywords: [], entries: [3] }] }
        : { reviewed: true, changes: [] }) }], usage: { cost: { total: 0.01 } } }) };
    } },
  };
  const memory = registerMemoryMaintenance(pi, { packageVersion: "0.2.0", skillsDir: resolve(import.meta.dirname, "../../pi-okf-agent-memory/skills"), getBinary: () => binary, busy: () => false });
  const index = new SessionIndex(join(dir, "summary.db"));
  const summary = registerSummaryMaintenance(pi, () => index);
  bus.on("pi-session-maintenance:capabilities:v1", (r: any) => { r.capabilities.summary = { protocol: 1, channel: "pi-session-search:maintenance:v1" }; });
  let clock = 1000;
  const config = parseConfig({ stateDir: join(dir, "state"), idleSeconds: 1 }, dir);
  const store = new Store(config.stateDir, () => clock);
  const coordinator = new Coordinator(pi.events, store, config, () => clock);
  try {
    await coordinator.attach(ctx); clock += 2000;
    for (let i = 0; i < 6; i++) await coordinator.tick();
    const record = store.get(path)!;
    assert.ok(record.review); assert.ok(record.summary);
    assert.equal(calls, 3); // one upgrade, one review, one summary; never a live provider
    assert.equal(execFileSync("git", ["-C", bundle, "status", "--porcelain"], { encoding: "utf8" }), "");
    await coordinator.tick(); assert.equal(calls, 3);
    const fs = await import("node:fs"); assert.equal(fs.readFileSync(path, "utf8"), source);
  } finally {
    await coordinator.close(); await memory.stop(); await summary.stop(); await index.dispose();
    process.env = env; rmSync(dir, { recursive: true, force: true });
  }
});
