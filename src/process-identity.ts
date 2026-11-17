import { readFileSync, readlinkSync } from "node:fs";
import { performance } from "node:perf_hooks";

export interface ProcessIdentity { incarnation?: string; startedAt?: number }
export type ProcessProbe = (pid: number) => ProcessIdentity;

/** Field 22 of Linux proc stat; comm can contain spaces and parentheses. */
export function startTicks(stat: string): string | undefined {
  const end = stat.lastIndexOf(")");
  if (end < 0) return undefined;
  const value = stat.slice(end + 1).trim().split(/\s+/)[19];
  return value && /^[0-9]+$/.test(value) && BigInt(value) > 0n ? value : undefined;
}

/** No shell/ps dependency, no signal beyond the existing liveness probe.
 * Missing/unreadable process metadata is unknown, never proof of death.
 * The hostname still defines the local observation domain (not authentication).
 */
export const processIdentity: ProcessProbe = (pid) => {
  const result: ProcessIdentity = pid === process.pid ? { startedAt: performance.timeOrigin } : {};
  if (process.platform !== "linux" || !Number.isSafeInteger(pid) || pid <= 1) return result;
  try {
    const boot = readFileSync("/proc/sys/kernel/random/boot_id", "utf8").trim();
    const namespace = readlinkSync(`/proc/${pid}/ns/pid`);
    const ticks = startTicks(readFileSync(`/proc/${pid}/stat`, "utf8"));
    if (/^[0-9a-f-]{36}$/i.test(boot) && /^pid:\[[0-9]+\]$/.test(namespace) && ticks) {
      result.incarnation = `linux:${boot}:${namespace}:${ticks}`;
    }
  } catch { /* Conservative PID-only fallback on unsupported/restricted systems. */ }
  return result;
};
