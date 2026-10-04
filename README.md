# pi-session-maintenance

Optional, capability-driven idle maintenance for pi: **OKF upgrades and knowledge
review → session-search summaries → optional compaction**. No permanent daemon,
browser engine, authenticated pi subprocess, or Yono-specific code.

Loading this package authorizes the configured unattended model calls and
agent-owned knowledge maintenance. Normal human approval is not required.
Knowledge changes are validated and committed automatically; upstream push is
opt-in. Models receive private conversation/corpus data: choose appropriate models
and credentials. This is cooperative automation, not a filesystem/security sandbox.

## Install

Node ≥22.18 (node:sqlite), Git, and pi are required.

```bash
cd ~/projects/pi-session-maintenance && npm install
cd ~/projects/discussions/general
pi install -l ~/projects/pi-session-maintenance
# /reload in existing sessions
```

Optional dependencies are separate packages, not bundled or auto-installed:

- Updated **pi-okf-agent-memory**: unattended review/upgrade/commit/push adapter.
- Updated **pi-session-search** (not pi-search): summary adapter and existing cache.
- Native pi compaction needs no extra package.

Missing packages are skipped. Older installed versions without adapters fail with
update advice. Never load local and Git copies of the same extension together.
Prepare the intended OKF bundle/Git identity through existing setup/provisioning;
maintenance never invents author identity, signing, credentials, or a remote.

## Settings

Optional `.pi/maintenance.json` in the current working directory:

```json
{
  "enabled": true,
  "idleSeconds": 600,
  "pollSeconds": 5,
  "upgrades": true,
  "knowledge": true,
  "summaries": true,
  "reviewModel": "provider/model-id",
  "summaryModel": "provider/model-id",
  "maxCostPerCycle": 0.5,
  "dailyBudget": 5,
  "push": false,
  "compaction": {
    "enabled": false,
    "minTokens": 50000,
    "budgetTokens": 200000
  }
}
```

All fields are optional; omit model fields to pin each session's maintenance jobs
to the active model when first processed. Later foreground model switches alone
do not regenerate historical work; explicit model-setting changes do. Default
compaction is **off**, and its between-turn `budgetTokens` trigger is absent.
Idle duration is seconds; token limits are nonnegative safe integers (budget must
be positive). Unknown keys/invalid types fail rather than silently change behavior.
`stateDir` optionally relocates the private ledger; its default is
`~/.pi/agent/session-maintenance` (honors `PI_CODING_AGENT_DIR`). Changing settings
on disk requires reload. `/maintenance settings` opens a human-readable editor
in TUI/RPC: toggle stages, select models, enter durations/token limits/budgets, then
**Save & apply**. Changes are saved to this cwd's `.pi/maintenance.json` and applied
in the current instance without reload; other open instances load them on reload.
Esc/Cancel discards the draft. `/maintenance settings show` (also the non-UI fallback)
prints a readable overview. Storage location is read-only in the menu because
changing the ledger path requires reload. Existing workspace off/suspension overrides
survive other settings edits; explicitly enabling a disabled configuration clears off.

Each scheduling opportunity performs at most one new model-backed section/step,
then yields. Stages and summary calls are sequential (summary concurrency **1**).
Daily spend is recorded separately from the foreground conversation, across
instances sharing the state directory. Cost limits are **approximate**: an admitted
call can exceed a limit, aborted calls may have unreported usage, and model-server
prices of zero are not an inference-capacity limit. No cross-sandbox model-server
scheduler is implemented; configure concurrency on your server.

## Controls and visibility

```text
/maintenance status             # ownership, stages, checkpoints, errors, cost
/maintenance settings           # interactive workspace editor; Save & apply or Cancel
/maintenance settings show      # readable configuration overview without dialogs
/maintenance run                # request work at safe idle, without waiting 10 minutes
/maintenance cancel             # stop and suspend for one idle interval; retain checkpoints
/maintenance suspend 30m        # timed workspace suspension (s/m/h/d accepted)
/maintenance resume             # clear suspension/off; begin a fresh idle interval
/maintenance off                # durable workspace disable
/maintenance on                 # enable this runtime and clear workspace disable
/maintenance retry              # clear stage backoff; queue work
/maintenance backfill /path/to/session.jsonl
/maintenance help               # human-readable commands and examples
```

Tab completion includes action descriptions. Every action reports what it changed;
suspend/backfill can prompt for a missing argument when a UI is available. Status
shows mode, ownership, idle timing, enabled/absent stages, approximate spend, named
sessions' saved coverage and retry blockers—not a raw JSON dump. Coverage is bounded
to eight sessions; the host API remains structured and complete. Footer status
describes running/waiting/suspended work. The settings menu holds local/peer
maintenance while open and does not call a model or resolve credentials. There is
no unsolicited model prompt or maintenance transcript appended to your conversation.
Foreground input/agent starts cancel background calls; TUI typing also takes
priority. Participating windows in the same cwd publish busy state and interruption
counters: peer input preempts owned background work within one polling interval,
without stealing its lease. Peer progress is visible in the shared status ledger. Timers only start at session_start in trusted working directories.
Cancel is cooperative, **not rollback**: validated commits and completed summary
sections remain. Ownership is held until operations actually stop, including push
process exit. Synchronous bounded OKF/Git calls can briefly occupy the event loop.

### Compact footer

The `🧹` prefix marks maintenance as its own block, with no internal dot separators.
Labels are derived from current state on each poll/input, not old progress messages:

| Label | Meaning |
| --- | --- |
| `🧹 idle 8m` / `ready` | Remaining idle wait / eligible to check for work |
| `🧹 busy` / `peer` | Foreground work in this window / another same-cwd window |
| `🧹 slot #1234` | Workspace executor claimed by PID 1234 (possibly another session) |
| `🧹 obs #1234` | This exact session is maintained by PID 1234; this window observes |
| `🧹 upd` / `review 2/6` / `sum 3/8` | Upgrade / knowledge review / search summary |
| `🧹 compact` / `push` / `stop…` | Compaction / Git push / waiting for cancellation to finish |
| `🧹 off` / `pause 30m` / `settings` | Disabled / timed pause / settings editor open |
| `🧹 budget` / `err 2` / `new` | Daily budget reached / recorded blockers / no session path |

`ready` means no worker is currently running here, not that every adapter's work
is proven fresh. `/maintenance status` supplies coverage, blockers and ownership.
No model calls or source-file parsing happen to render the footer.

## Session lifecycle and ownership

- First process to claim the canonical saved-session path owns its maintenance.
  A second window shows an observer warning; it does not maintain that session.
  **This does not lock ordinary pi conversation writes.** Avoid two active writers.
- Live/foreign owners are never displaced merely because their heartbeat is old.
  Proven dead local PIDs can be recovered automatically, with a warning. Ambiguous
  ownership remains visible; no stale-PID kill or force-unlock occurs.
- `/new`, switching and shutdown observe the departing saved session and release
  ownership. Its backlog remains durable. Multiple sessions in the same cwd share
  an executor claim; memory writes also use the OKF bundle's own lock.
- Only previously observed sessions are automatically queued; installation does
  not launch a paid historical backfill. Explicit backfill is restricted to the
  current working directory. Deleted/corrupt sources are reported, never rewritten.
- An idle owner can maintain an open conversation or work on its workspace backlog.
  Closing every participating pi instance stops work; opening pi resumes scheduling.
- Archives get knowledge review and summary only, **never background compaction**.
  Compaction is limited to the current owned, idle session and verifies that its
  in-memory conversation matches the file and no unresolved tool calls remain on
  the compaction-aware active branch. Native threshold/overflow recovery is
  not intercepted. Budget-triggered maintenance compaction has priority over backlog.

All branches are included in both review and summary. Branch alternatives are not
implicitly rejected; model claims, accepted decisions and corrections stay distinct.
Tool results/thinking/images are excluded from the normal text snapshot, so missing
verification must remain uncertain. Metadata/compaction entries alone do not dirty
that snapshot. Checkpoints record content hash and adapter policy/model version,
not just timestamps. Summary caches reuse unchanged sections; review journals reuse
validated/committed sections. A new source revision remains pending even if work
on an older snapshot just finished.

Stages retry independently with exponential backoff capped at one hour. Native
maintenance compaction requests abort after a three-minute watchdog; it never kills
pi or releases a still-running operation early. Failed
pushes/finalization do not cause new extraction calls. A missing/oversized corpus,
unsupported model, governance-sensitive repair, failed validation or unresolved Git
conflict is a visible blocker, not an invented success. Knowledge uses attributed
addenda and automatic bundle-scoped commits, preserving unrelated outer-repository
staging. Push sends the **existing configured Git branch**, not a file-filtered
remote update; configure it only for the repository/upstream you intend to publish.
No force push, auto-rebase/reset, password prompt, fabricated identity or hook bypass.

## Host integration / Yono

Yono integration is left to the host. **Disable its old independent hygiene loop
before enabling this coordinator**; this package cannot prevent an uncooperative
extension from issuing parallel compactions/reviews.

A trusted adapter can use `pi-session-maintenance:control:v1`:

```ts
const request = { protocol: 1, operation: "configure", settings: {
  idleSeconds: 900,
  compaction: { enabled: true, minTokens: 50000, budgetTokens: 250000 }
}, result: undefined };
pi.events.emit("pi-session-maintenance:control:v1", request);
await request.result;
```

The responder assigns `result` synchronously. Operations: `status`, `configure`
(full settings object, defaults fill omissions), `run`, `cancel`, `suspend` with
`seconds`, and `resume`. Configure changes are runtime-local, not written into
Yono/persona files. Runtime replacement invalidates prior contexts. `stateDir`
changes require reload. No frontend/CRD changes are needed in this repository.

Packages advertise `{memory?,summary?}` on
`pi-session-maintenance:capabilities:v1` using `{protocol:1,channel}` descriptors.
Requests carry the active context/registry, original cwd, immutable all-branch
snapshot/hash, source-freshness guard, cancellation signal, progress and usage
callbacks. Package implementations own their formats/validation and return
structured policy-keyed outcomes. These are documented trusted in-process
contracts, **not authentication boundaries or model-callable control tools**.

## Storage and development

`state.db` stores observed sessions, receipts, controls, leases and daily spend.
`work/` stores private review proposals/application checkpoints. These can contain
sensitive rationale and source references; do not publish them. Directories are
owner-only and files owner-readable. Deleting this state loses receipts and can
cause repeat model work; session-search's paid caches live in its own database.

```bash
npm test
npm run typecheck
```

Tests use fake model registries, temporary session files/corpora/Git repositories,
and real bundled OKF CLI validation. Cross-project adapter tests require adjacent
local checkouts. They **never launch authenticated pi, read auth.json, call a real
provider, or access personal browser/history data**. No model calls are needed.
