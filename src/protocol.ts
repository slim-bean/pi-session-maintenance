import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { Snapshot } from "./source.ts";
export interface Capability { protocol: 1; channel: string }
export interface Capabilities { memory?: Capability; summary?: Capability }
export interface Outcome { key: string; complete?: boolean; available?: boolean; upgraded?: boolean; detail?: unknown; bundle?: string }
export interface TaskRequest {
  protocol: 1; operation: "status" | "upgrade" | "review" | "push" | "run";
  context: ExtensionContext; cwd: string; path: string; sourceHash: string; source: Snapshot;
  model?: string; workDir: string; maxCost: number; signal: AbortSignal;
  assertSource(): void; onUsage(usage: any): void; onProgress(text: string): void;
  result?: Promise<Outcome>;
}
export interface Bus { emit(channel: string, request: unknown): void }
export function discover(bus: Bus): Capabilities {
  const request: { capabilities: Capabilities } = { capabilities: {} };
  bus.emit("pi-session-maintenance:capabilities:v1", request);
  for (const capability of Object.values(request.capabilities)) {
    if (capability?.protocol !== 1 || typeof capability.channel !== "string") throw new Error("Installed maintenance adapter has an unsupported protocol");
  }
  return request.capabilities;
}
export async function invoke(bus: Bus, channel: string, request: TaskRequest): Promise<Outcome> {
  bus.emit(channel, request);
  if (!request.result) throw new Error(`Installed maintenance adapter did not respond: ${channel}`);
  return request.result;
}
