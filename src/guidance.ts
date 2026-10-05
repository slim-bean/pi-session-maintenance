import type { IssueGroup } from "./issues.ts";
export interface Guidance { intervention: "none" | "needed" | "suggested"; actions: string[] }
/** Operational advice only. Never grant authority, invent a repair, or promise retries will fix a prerequisite. */
export function nextSteps(g: IssueGroup): Guidance {
  const needed = (...actions: string[]): Guidance => ({ intervention: "needed", actions });
  const wait = (...actions: string[]): Guidance => ({ intervention: "none", actions });
  switch (g.code) {
    case "orphan-policy-legacy": return needed("Reload the affected pi windows to load the updated OKF adapter. Independent topics need no fabricated relationships; advisory policy is the default. Saved plans will then revalidate and finalize normally.");
    case "validation-policy-changed": return wait("No corpus repair is needed for isolation alone. The saved plan is queued for real validation and Git finalization under the updated policy.");
    case "memory-busy": case "bundle-lock": return wait("Wait for the current memory writer/setup/upgrade to finish. Do not delete a live owner's lock. If ownership is genuinely stale, verify the old runtime stopped before using the documented recovery flow.");
    case "source-changed": return wait("Let the conversation finish changing. Maintenance will take a fresh snapshot; completed work is retained.");
    case "tool-pairing": return wait("Wait for outstanding tools to return. If the turn has already ended, inspect and repair the orphaned tool-call/result pairing before compacting; do not hide missing results.");
    case "stale-context": return needed("Stop any second writer, then reopen this saved session with /resume so in-memory history matches the file. /reload alone does not reread edited JSONL.");
    case "source-unavailable": return needed("Check the saved-session file named above. Restore it if missing/corrupt; if its cwd changed, resume it in its proper workspace. Do not rewrite headers or fabricate history to bypass the scope check.");
    case "model-auth": return needed("Configure credentials for the named provider using pi's normal login/credential setup, or choose an already configured review/summary model in /maintenance settings. Do not paste credentials into the conversation.");
    case "git-identity": return needed("Configure the repository's real Git user.name and user.email. Maintenance does not invent author identity. Retry finalization after configuring them.");
    case "git-upstream": return needed("Attach the knowledge repository to the intended branch and configure its upstream remote/branch, or turn Push off in /maintenance settings. No remote or upstream is created automatically.");
    case "git-auth": return needed("Fix unattended Git access to the configured upstream (SSH key/credential helper permissions). Verify access outside maintenance; no password dialogs are answered automatically.");
    case "git-conflict": return needed("Finish or deliberately resolve the repository's merge/rebase/cherry-pick and unmerged index entries, preserving unrelated work. Maintenance will not reset, stash, or resolve conflicts blindly.");
    case "git-signing": return needed("Fix Git signing/key availability so commits work unattended, or explicitly choose an approved repository signing policy. Maintenance never bypasses signing or hooks.");
    case "git-push-rejected": return needed("Inspect the upstream rejection; reconcile divergent history or satisfy the remote hook/branch policy. No automatic force push or rebase is performed.");
    case "memory-validation": {
      const d = g.detail as { validation?: Record<string, any>; orphanPolicy?: string } | undefined;
      const v = d?.validation;
      const actions = ["Run memory_validate for the knowledge bundle named above; make justified repairs to these reported findings, then validate again. No general corpus-repair workflow is launched solely because the status is blocked."];
      if (v) {
        for (const [key, label] of [["errors", "Schema/provenance/governance"], ["warnings", "Index/drift/staleness warnings"], ["gate_findings", "Gate findings"], ["broken_links", "Broken links"]]) {
          if (!Array.isArray(v[key]) || !v[key].length) continue;
          for (const finding of v[key].slice(0, 3)) actions.push(`${label}: ${typeof finding === "string" ? finding : JSON.stringify(finding)}`);
          if (v[key].length > 3) actions.push(`${v[key].length - 3} more ${label.toLowerCase()} findings remain in memory_validate.`);
        }
        if (v.stale_count > 0) actions.push(`Review ${v.stale_count} stale record(s) against actual facts; do not advance dates without reviewing them.`);
        if (d?.orphanPolicy === "strict" && v.orphans?.length) actions.push("Strict orphan policy is selected. If these topics are intentionally independent, configure OKF_ORPHAN_POLICY=advisory and reload; otherwise add only genuine, evidenced relationships.");
      }
      return needed(...actions);
    }
  }
  if (g.kind === "deferred") return wait("Wait for the reported prerequisite to clear. No work is marked complete or discarded while waiting.");
  const repeated = g.attempts >= 3;
  return { intervention: g.kind === "blocked" ? "needed" : repeated ? "suggested" : "none", actions: [
    g.code === "git-push" ? "Automatic retry can recover a transient network/upstream outage. If it persists, check the remote service and network reachability." :
    g.code === "git-finalization" ? "Inspect the Git diagnostic above, including hooks and repository permissions. Saved extraction is retained while finalization retries." :
    "Inspect the diagnostic above and the configured model/provider or resource. Maintenance has not established a more specific repair, so it will not invent one.",
    ...(repeated ? ["Repeated attempts have not cleared this condition; investigate or delegate the stated repair. Automatic retries remain enabled when scheduling allows."] : []),
  ] };
}
