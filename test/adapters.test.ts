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
// @ts-expect-error The sibling's JavaScript test loader supplies pi's runtime aliases.
const { jiti } = await import("../../pi-okf-agent-memory/test/loader.mjs");
const { registerMemoryMaintenance } = await jiti.import(resolve(import.meta.dirname, "../../pi-okf-agent-memory/lib/maintenance.ts")) as typeof import("../../pi-okf-agent-memory/lib/maintenance.ts");
import { registerSummaryMaintenance } from "../../pi-session-search/extension/maintenance.ts";
import { SessionIndex } from "../../pi-session-search/extension/indexer.ts";

for (const memoryOwnership of ["limited", "full"] as const) test(`real package adapters compose with the coordinator (${memoryOwnership} ownership) using only a fake provider`, async () => {
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
  // Existing validation failures must repair automatically, even before the
  // first upgrade: no /maintenance retry, foreground delegation or live model.
  execFileSync(binary, ["create", "target", bundle, "--title", "Target", "--desc", "Target rationale.", "--body", "Existing evidence."]);
  execFileSync(binary, ["create", "source", bundle, "--title", "Source", "--desc", "Uses the target.", "--body", "See [target](wrong.md) for the rationale."]);
  writeFileSync(join(bundle, "index.md"), "# Knowledge\n");
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
      const isRepair = input.systemPrompt.includes('"repairs"');
      if (isSummary || input.systemPrompt.includes("Extract only durable WHY")) assert.match(input.messages[0].content, /valuable branch evidence/);
      const fullRepair = input.tools?.length && !input.messages.some((m: any) => m.role === "toolResult" && m.toolCallId === "full-repair");
      return { result: async () => ({ role: "assistant", api: "openai-responses", provider: "fake", model: "offline", timestamp: Date.now(),
        stopReason: fullRepair ? "toolUse" : "stop", content: fullRepair
          ? [{ type: "toolCall", id: "full-repair", name: "edit", arguments: { path: "source.md", edits: [{ oldText: "[target](wrong.md)", newText: "[target](target.md)" }] } }]
          : [{ type: "text", text: JSON.stringify(isSummary
            ? { overview: "all branches", topics: [{ title: "Sidequest", summary: "valuable", keywords: [], entries: [3] }] }
            : isRepair ? { repairs: [{ file: "source.md", from: "[target](wrong.md)", target: "target.md", reason: "The existing target is named in the source rationale." }] }
            : { reviewed: true, changes: [] }) }], usage: { cost: { total: 0.01 } } }) };
    } },
  };
  const memory = registerMemoryMaintenance(pi, { packageVersion: "0.2.0", skillsDir: resolve(import.meta.dirname, "../../pi-okf-agent-memory/skills"), getBinary: () => binary, busy: () => false });
  const index = new SessionIndex(join(dir, "summary.db"));
  const summary = registerSummaryMaintenance(pi, () => index);
  bus.on("pi-session-maintenance:capabilities:v1", (r: any) => { r.capabilities.summary = { protocol: 1, channel: "pi-session-search:maintenance:v1" }; });
  let clock = 1000;
  const config = parseConfig({ stateDir: join(dir, "state"), idleSeconds: 1, memoryOwnership }, dir);
  const store = new Store(config.stateDir, () => clock);
  const coordinator = new Coordinator(pi.events, store, config, () => clock);
  try {
    await coordinator.attach(ctx); clock += 2000;
    for (let i = 0; i < 6; i++) await coordinator.tick();
    const record = store.get(path)!;
    assert.ok(record.review); assert.ok(record.summary);
    const expected = memoryOwnership === "full" ? 5 : 4; // full repair uses a tool turn + host-verified completion
    assert.equal(calls, expected);
    assert.match((await import("node:fs")).readFileSync(join(bundle, "source.md"), "utf8"), /\[target\]\(target.md\)/);
    assert.equal(execFileSync("git", ["-C", bundle, "status", "--porcelain"], { encoding: "utf8" }), "");
    await coordinator.tick(); assert.equal(calls, expected);
    if (memoryOwnership === "full") {
      // An independently broken corpus must heal even when source coverage is
      // already fresh; corpus fingerprints re-admit validation without re-extraction.
      execFileSync(binary, ["update", "source", bundle, "--body", "See [target](wrong.md) for the rationale."]);
      // External corpus changes are rediscovered at the bounded idle inspection interval.
      clock += 61_000; await coordinator.tick(); await coordinator.tick();
      assert.equal(calls, expected + 2);
      assert.match((await import("node:fs")).readFileSync(join(bundle, "source.md"), "utf8"), /\[target\]\(target.md\)/);
      assert.ok(store.get(path)!.review); assert.equal(execFileSync("git", ["-C", bundle, "status", "--porcelain"], { encoding: "utf8" }), "");
    }
    const fs = await import("node:fs"); assert.equal(fs.readFileSync(path, "utf8"), source);
  } finally {
    await coordinator.close(); await memory.stop(); await summary.stop(); await index.dispose();
    process.env = env; rmSync(dir, { recursive: true, force: true });
  }
});
