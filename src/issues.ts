import type { RecordState } from "./store.ts";
export type IssueKind = "deferred" | "blocked" | "error";
export interface Issue {
  failures: number; retryAt: number; error: string;
  kind?: IssueKind; code?: string; resource?: string; detail?: unknown; message?: string;
}
export interface Classified { kind: IssueKind; code: string; resource?: string; message: string; detail?: unknown }
export function maintenanceIssue(kind: IssueKind, code: string, resource: string, message: string): Error {
  return Object.assign(new Error(message), { maintenanceIssue: 1, kind, code, resource });
}
/** Narrow compatibility reader for our old serialized validation errors, not fuzzy error suppression. */
function legacyValidation(message: string): Classified | undefined {
  const prefix = "Memory validation failed; planned changes retained for retry: ";
  if (!message.startsWith(prefix)) return;
  try {
    const result = JSON.parse(message.slice(prefix.length));
    const v = result.validation;
    if (result.ok !== false || !v || typeof v.bundle_path !== "string" || typeof v.is_conformant !== "boolean" || typeof v.gate_passed !== "boolean" ||
      ![v.errors, v.warnings, v.gate_findings].every(Array.isArray) ||
      ![v.orphans, v.broken_links].every((a) => a === null || Array.isArray(a))) return;
    const isolationOnly = result.exitCode === 1 && v.is_conformant && !v.gate_passed &&
      !v.errors.length && !v.warnings.length && !v.gate_findings.length && !v.broken_links?.length &&
      Array.isArray(v.orphans) && v.orphans.length > 0 && (v.stale_count === undefined || v.stale_count === 0);
    return { kind: "blocked", code: isolationOnly ? "orphan-policy-legacy" : "memory-validation", resource: v.bundle_path,
      message: isolationOnly ? "Knowledge review was blocked by the previous strict orphan policy; its saved plan remains pending." : "Knowledge-bundle validation is blocked; saved plans remain pending.", detail: result };
  } catch { return; }
}
export function classify(error: unknown): Classified {
  const e = error as { maintenanceIssue?: unknown; kind?: unknown; code?: unknown; resource?: unknown; message?: unknown; detail?: unknown } | null;
  const message = typeof e?.message === "string" ? e.message : String(error);
  if (e?.maintenanceIssue === 1 && ["deferred", "blocked", "error"].includes(e.kind as string) && typeof e.code === "string") {
    return { kind: e.kind as IssueKind, code: e.code, resource: typeof e.resource === "string" ? e.resource : undefined, message, detail: e.detail };
  }
  return legacyValidation(message) ?? { kind: "error", code: "operation-failed", message };
}
export function normalizeRecord(record: RecordState): RecordState {
  for (const issue of Object.values(record.errors ?? {})) {
    if (!issue || (issue.kind && ["deferred", "blocked", "error"].includes(issue.kind))) continue;
    const result = classify(new Error(issue.error));
    issue.kind = result.kind; issue.code = result.code; issue.resource = result.resource; issue.detail = result.detail; issue.message = result.message;
    // Keep the original error/counters/backoff; classification never completes or drops work.
  }
  return record;
}
export interface IssueGroup { kind: IssueKind; code: string; resource: string; message: string; paths: Set<string>; retryAt: number; detail?: unknown }
export function groupedIssues(records: RecordState[], enabled: (stage: string, r: RecordState) => boolean = () => true): IssueGroup[] {
  const groups = new Map<string, IssueGroup>();
  const add = (record: RecordState, issue: Issue) => {
    const info = issue.kind ? { kind: issue.kind, code: issue.code ?? "operation-failed", resource: issue.resource, message: issue.message ?? issue.error, detail: issue.detail } : classify(new Error(issue.error));
    const resource = info.resource ?? record.path;
    const key = JSON.stringify([info.kind, info.code, resource]);
    let group = groups.get(key);
    if (!group) { group = { kind: info.kind, code: info.code, resource, message: info.message, paths: new Set(), retryAt: issue.retryAt, detail: info.detail }; groups.set(key, group); }
    group.paths.add(record.path); group.retryAt = Math.min(group.retryAt, issue.retryAt);
  };
  for (const record of records) {
    if (record.error) add(record, { failures: 0, retryAt: 0, error: record.error, kind: "blocked", code: "source-unavailable", resource: record.path });
    for (const [stage, issue] of Object.entries(record.errors ?? {})) if (issue && enabled(stage, record)) add(record, issue);
  }
  return [...groups.values()];
}
