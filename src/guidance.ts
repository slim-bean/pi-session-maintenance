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
    case "memory-ownership-adapter": return needed("Deploy an updated pi-okf-agent-memory adapter with ownershipProtocol:1 and reload. Full ownership never silently falls back to a limited adapter.");
    case "memory-recovery-transient": return wait("The recovery worker/provider failed transiently. Its case and checkpoints are retained; automatic retry uses exponential backoff. No human repair approval or foreground handoff is needed.");
    case "memory-recovery-pending": return wait("The full-ownership agent is investigating/repairing this failure. Durable recovery evidence and checkpoints are retained; it continues automatically at the next safe idle/budget opportunity. No human approval or repair handoff is expected.");
    case "memory-upgrade-pending": return wait("The coordinator finishes installed memory contracts before review. Keep the upgrades stage enabled; a host may also request the prerequisite upgrade directly. No human review approval is required in full mode.");
    case "memory-context-capacity": return wait("Recovery will use incremental tool reads rather than truncating evidence. If the selected model cannot support the bounded recovery request, provision a model with sufficient context capacity.");
    case "memory-external": return needed("Autonomous recovery reports an external prerequisite. Provision the specifically missing permission, credential, compatible runtime or unavailable resource through the host; no console answer is awaited. Inspect the recovery case for its evidence. Memory facts/policy ambiguity should be handled by qualification or archival, not human approval.");
    case "memory-repair-pending": return wait("The agent queued validation repair for the next safe idle opportunity. The saved extraction plan is retained; no repeated extraction or human approval is needed.");
    case "memory-repair-conflict": return wait("A foreground writer changed the corpus after repair planning. The stale repair checkpoint is preserved; maintenance will replan against the new content without overwriting it.");
    case "source-changed": return wait("Let the conversation finish changing. Maintenance will take a fresh snapshot; completed work is retained.");
    case "tool-pairing": return wait("Wait for outstanding tools to return. If the turn has already ended, inspect and repair the orphaned tool-call/result pairing before compacting; do not hide missing results.");
    case "stale-context": return needed("Stop any second writer, then reopen this saved session with /resume so in-memory history matches the file. /reload alone does not reread edited JSONL.");
    case "source-unavailable": return needed("Check the saved-session file named above. Restore it if missing/corrupt; if its cwd changed, resume it in its proper workspace. Do not rewrite headers or fabricate history to bypass the scope check.");
    case "okf-binary": return needed("Run /memory-diagnostics to see the loaded extension, selected binary, lookup candidates and resource settings files. Restore that package's host-matched bin/ executable or correct OKF_BIN; then retry. Old failures are archived only after a fresh healthy adapter status.");
    case "model-auth": return needed("Configure credentials for the named provider using pi's normal login/credential setup, or choose an already configured review/summary model in /maintenance settings. Do not paste credentials into the conversation.");
    case "git-identity": return needed("Configure the repository's real Git user.name and user.email. Maintenance does not invent author identity. Retry finalization after configuring them.");
    case "git-upstream": return needed("Attach the knowledge repository to the intended branch and configure its upstream remote/branch, or turn Push off in /maintenance settings. No remote or upstream is created automatically.");
    case "git-auth": return needed("Fix unattended Git access to the configured upstream (SSH key/credential helper permissions). Verify access outside maintenance; no password dialogs are answered automatically.");
    case "git-conflict": return needed("Finish or deliberately resolve the repository's merge/rebase/cherry-pick and unmerged index entries, preserving unrelated work. Maintenance will not reset, stash, or resolve conflicts blindly.");
    case "git-signing": return needed("Fix Git signing/key availability so commits work unattended, or explicitly choose an approved repository signing policy. Maintenance never bypasses signing or hooks.");
    case "git-push-rejected": return needed("Inspect the upstream rejection; reconcile divergent history or satisfy the remote hook/branch policy. No automatic force push or rebase is performed.");
    case "model-output-limit": return needed("The model spent its whole output-token limit (often on reasoning) before answering. Current pi-okf-agent-memory splits a failing review section automatically; this persists when the smallest piece still fails or an older adapter is loaded (update and reload).", "Otherwise choose a model with a larger output limit or a non-thinking/lower-reasoning variant in /maintenance settings.");
    case "model-timeout": return needed("The model call exceeded modelTimeoutSeconds. Current pi-okf-agent-memory splits a timed-out review section automatically; this persists when the smallest piece still times out or an older adapter is loaded (update and reload).", "Otherwise raise the timeout (max 1h) in /maintenance settings, use a faster model/server, or reduce concurrent load on a shared local model server.");
    case "memory-validation": {
      const d = g.detail as { validation?: Record<string, any>; orphanPolicy?: string; repair?: { automatic?: boolean; status?: string; attempts?: number; reason?: string } } | undefined;
      const v = d?.validation;
      const actions = [d?.repair?.automatic
        ? `Automatic index/link repair ${d.repair.status === "retryable" ? "will retry within its bounded proposal allowance" : "could not safely clear the remaining findings"}. ${d.repair.reason ?? "Inspect the recorded repair evidence."} Saved extraction plans remain pending.`
        : "The current OKF maintenance adapter automatically repairs index bookkeeping and evidenced broken link targets. Reload older adapters to enable it. Inspect memory_validate for findings that need factual/governance/policy evidence rather than structural repair."];
      if (v) {
        for (const [key, label] of [["errors", "Schema/provenance/governance"], ["warnings", "Index/drift/staleness warnings"], ["gate_findings", "Gate findings"], ["broken_links", "Broken links"]]) {
          if (!Array.isArray(v[key]) || !v[key].length) continue;
          for (const finding of v[key].slice(0, 3)) actions.push(`${label}: ${typeof finding === "string" ? finding : JSON.stringify(finding)}`);
          if (v[key].length > 3) actions.push(`${v[key].length - 3} more ${label.toLowerCase()} findings remain in memory_validate.`);
        }
        if (v.stale_count > 0) actions.push(`Review ${v.stale_count} stale record(s) against actual facts; do not advance dates without reviewing them.`);
        if (d?.orphanPolicy === "strict" && v.orphans?.length) actions.push("Strict orphan policy is selected. If these topics are intentionally independent, configure OKF_ORPHAN_POLICY=advisory and reload; otherwise add only genuine, evidenced relationships.");
      }
      return d?.repair?.status === "retryable" ? wait(...actions) : needed(...actions);
    }
  }
  if (g.kind === "deferred") return wait("Wait for the reported prerequisite to clear. No work is marked complete or discarded while waiting.");
  const repeated = g.attempts >= 3;
  return { intervention: g.kind === "blocked" ? "needed" : repeated ? "suggested" : "none", actions: [
    g.code === "git-push" ? "Automatic retry can recover a transient network/upstream outage. If it persists, check the remote service and network reachability." :
    g.code === "git-finalization" ? "Inspect the Git diagnostic above, including hooks and repository permissions. Saved extraction is retained while finalization retries." :
    "Inspect the diagnostic above and the configured model/provider or resource. Maintenance has not established a more specific repair, so it will not invent one.",
    ...(repeated ? [g.parked ? "Repeated attempts have not cleared this condition and automatic retries have stopped at the configured limit; investigate or delegate the stated repair."
      : "Repeated attempts have not cleared this condition; investigate or delegate the stated repair. Automatic retries continue until the configured limit."] : []),
  ] };
}
