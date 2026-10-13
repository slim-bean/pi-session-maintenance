# pi-session-maintenance

Optional, capability-driven idle maintenance for pi: **OKF upgrades and knowledge
review → session-search summaries → optional compaction**. No permanent daemon,
browser engine, authenticated pi subprocess, or host-platform dependency.

Loading this package authorizes the configured unattended model calls and
agent-owned knowledge maintenance. Normal human approval is not required.
Knowledge changes are validated and committed automatically; upstream push is
opt-in. Models receive private conversation/corpus data: choose appropriate models
and credentials. This is cooperative automation, not a filesystem/security sandbox.

## Install

Node ≥22.18 (node:sqlite), Git, and pi are required.

```bash
cd ~/projects/pi-extensions/pi-session-maintenance && npm install
cd ~/projects/discussions/general
pi install -l ~/projects/pi-extensions/pi-session-maintenance
# /reload in existing sessions
```

Optional dependencies are separate packages, not bundled or auto-installed:

- Updated **pi-okf-agent-memory**: unattended review/upgrade/commit/push adapter.
- Updated **pi-session-search** (not pi-search): summary adapter and existing cache.
- Native pi compaction needs no extra package.

**Release 0.4.0** adds configurable model-call/compaction deadlines (ten minutes
by default) and explicit abort causes, elapsed times and provider errors in run
history/session views. Pair with pi-session-search 0.7.0 and pi-okf-agent-memory
0.5.0 so both adapters honor timeout settings and report cancellation diagnostics.

**Release 0.3.0** adds private run transcripts, passive watch/history/session
viewers, immediate safe run/retry admission, and configuration/binary diagnostics
with evidence-based blocker retirement. Pair with pi-session-search 0.6.0 and
pi-okf-agent-memory 0.4.0 for summary path-alias fixes and model tracing.

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
  "memoryOwnership": "limited",
  "summaries": true,
  "reviewModel": "provider/model-id",
  "summaryModel": "provider/model-id",
  "maxCostPerCycle": 0.5,
  "dailyBudget": 5,
  "push": false,
  "modelTranscripts": true,
  "modelTimeoutSeconds": 600,
  "compaction": {
    "enabled": false,
    "minTokens": 50000,
    "budgetTokens": 200000
  }
}
```

### Memory ownership

`memoryOwnership` is **`limited`** (automatic index/link repair) or **`full`**
(agent-owned, tool-capable recovery with no normal human approval). Explicit
workspace/host settings take precedence, then `PI_MEMORY_OWNERSHIP`; otherwise
ownership defaults to **limited** in every environment. Hosts explicitly enable
full ownership through generic configuration, just as they opt into compaction.
No sandbox/platform detection changes authority. Status reports the selected mode
and captured environment-default origin. Configuration is not authenticated
identity or a security boundary. Both updated packages must be loaded; full requests require
an OKF adapter advertising `ownershipProtocol:1`, never silent limited fallback.

For unattended hosts or provisioning:

```sh
export PI_MEMORY_OWNERSHIP=full  # explicit default; limited opts out
```

Or send host configuration with `settings: {memoryOwnership:"full", ...}`.
`/maintenance settings` exposes ownership and an optional explicit
`memoryGitIdentity:{name,email}`. Full mode applies that authorized identity to
repository-local Git config (including an enclosing repository); omission uses
existing Git configuration/environment. It does not guess OS/hostname authors.
Loading full mode delegates memory setup, metadata/governance/lifecycle repair,
factual investigation, qualification/archival of unsupported claims, and scoped
Git recovery. Missing facts are a reason to investigate or qualify memory—not
wait for a human. Publication still requires the separate push setting/request.

Full recovery uses the existing registry and read/edit/write/shell tools. It
persists cases, original-content checkpoints and execution evidence, checks source
and bundle ownership, then requires actual validation/commit proof. Eight model
turns per opportunity and the existing approximate budget/deadline gates bound
work; exhausted opportunities continue automatically. Failed ordinary extraction
or oversized corpora can use an incremental tool-based review bound to the current
source hash; installed-step attestations still pass runner ordering/verifiers.
Content fingerprints and a daily health key re-admit validation even when saved
conversation coverage is fresh, without replaying committed extraction sections.

External prerequisites include unavailable credentials/mounts, incompatible
runtime/model capabilities, foreign/live ownership, and Git operations belonging
to unrelated project state. They remain structured host/owning-agent prerequisites,
not console questions. Model claims of external blockers need failed operational
evidence; unresolved memory facts/policy alone cannot park autonomous repair.

**Full mode is powerful:** shell inherits the Pi process's filesystem, network and
credential access. Memory-only shell scope is cooperative, not an OS sandbox;
private transcripts are not infrastructure-authenticated audit. These worker tools
do not inherit foreground tool overrides/approval extensions. Use full-process
isolation for unattended deployments, or deliberately accept host-process
permissions when opting in locally. Never assume tool-only isolation covers this worker.

All fields are optional; omit model fields to pin each session's maintenance jobs
to the active model when first processed. Later foreground model switches alone
do not regenerate historical work; explicit model-setting changes do. Default
compaction is **off**, and its between-turn `budgetTokens` trigger is absent.
Idle duration is seconds. `modelTimeoutSeconds` defaults to **600 (10 minutes)**,
up from the previous hardcoded three-minute limit; set any whole number from 1 to
3600. It bounds each knowledge/upgrade/summary model call and the native compaction
watchdog, not an entire multi-section job. `/maintenance settings` can edit it with
values like `20m`. Foreground/peer input and manual cancellation still stop work
immediately; a longer deadline does not disable those safeguards. Provider/server
limits can end a call earlier and are not overridden by this setting.
Token limits are nonnegative safe integers (budget must
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

Normal extraction performs at most one new model-backed section/step per
opportunity, then yields. Full recovery may use up to eight sequential model turns
within the same budget/deadline gates; no parallel repair agent is launched. Stages and summary calls are sequential (summary concurrency **1**).
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
/maintenance run                # start immediately or report the blocker; clear backoff
/maintenance watch              # live read-only output; Ctrl+Alt+M also opens it
/maintenance history [run-id]   # two-pane runs/results browser; Enter views session
/maintenance cancel             # stop and suspend for one idle interval; retain checkpoints
/maintenance suspend 30m        # timed workspace suspension (s/m/h/d accepted)
/maintenance resume             # clear suspension/off; begin a fresh idle interval
/maintenance off                # durable workspace disable
/maintenance on                 # enable this runtime and clear workspace disable
/maintenance retry              # alias for run; same immediate-admission behavior
/maintenance backfill /path/to/session.jsonl
/maintenance help               # human-readable commands and examples
```

Tab completion includes action descriptions. Every action reports what it changed;
suspend/backfill can prompt for a missing argument when a UI is available. Status
shows mode, ownership, idle timing, enabled/absent stages, approximate spend, named
sessions' saved coverage and retry blockers—not a raw JSON dump. Coverage is bounded
to eight sessions; the host API remains structured and complete. Footer status
describes running/waiting/suspended work. Active stages animate a spinner and show
elapsed time plus `→ /maintenance watch`. This means active, not proven healthy. The settings menu holds local/peer
maintenance while open and does not call a model or resolve credentials. There is
no unsolicited model prompt or maintenance transcript appended to your conversation.
Foreground input/agent starts cancel background calls; TUI typing also takes
priority. Typing `/maintenance watch`, `history`, `status`, `help`, `run`, or `retry`
does not preempt work; ordinary prose, other commands and mutation commands still
do. Passive monitor navigation never holds maintenance or changes ownership.
Participating windows in the same cwd publish busy state and interruption
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
| `🧹 ⠋ review 2/6 38s → /maintenance watch` | Animated active stage, section count and elapsed time |
| `🧹 compact` / `push` / `stop…` | Compaction / Git push / waiting for cancellation to finish |
| `🧹 off` / `pause 30m` / `settings` | Disabled / timed pause / settings editor open |
| `🧹 budget` / `err 2 → status` / `new` | Daily budget reached / actual error groups (inspect `/maintenance status`) / no session path |
| `🧹 block 1 → status` / `wait 1 auto` | Blocking resource needing inspection / routine deferral with automatic retry |

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

Stages retry independently. Actual errors and blocking conditions use exponential
backoff capped at one hour; routine deferrals (busy bundles, stale snapshots or tool
pairing) wait one polling interval without accumulating failure counts. Structured
adapter issues identify kind, stable code and canonical resource. A shared knowledge
bundle blocker affecting six sessions is counted **once**, with all affected reviews
shown in status, not as six independent execution failures. Each issue shows the
recorded check count, last check time (when known), whether intervention is needed,
the specific next action, and automatic retry eligibility. Legacy counters are
labeled rather than assigned invented timestamps. Fresh healthy adapter status
archives obsolete binary/upgrade errors in `state.db`'s `issue_history` instead of
leaving them as active blockers. Original messages, counters and legacy unknown
timestamps are preserved alongside the resolution evidence/time; no work receipt
is manufactured. Cached summary errors clear only after fresh ready status and a
matching saved receipt. Failed or unavailable status checks never clear blockers. Unknown diagnostics are not
presented as a confidently diagnosed repair.

`/maintenance run` and `/maintenance retry` are aliases: both clear retry backoff
without erasing receipts/history and attempt admission immediately, skipping the
normal idle countdown and poll delay. They return when a stage starts, not when
its model call completes. If admission is blocked they explain why (foreground
work/input, another owner/executor, suspension/off, settings, budget, missing model
or adapter prerequisites). Neither interrupts active work, steals ownership, or
bypasses safety/budget gates. If nothing is due, they report that rather than
claiming work was queued. Failures discovered after a manually started stage begins
also produce a visible notification and remain in the transcript/status. Cached
plans/summaries and Git finalization do not require auth for a new model call.
Use them in the owning window.
Status states those gates and notes that retrying cannot fix a static prerequisite.
Configuration/validation/Git blockers include concrete actions (reported findings,
provider setup, author identity, upstream, conflicts, credentials or signing).
Repeated unknown failures recommend investigation, while automatic retries remain
scheduled.

In limited mode, validation repair is **agent-owned and automatic within structural authority**:
missing index navigation and drifted descriptions are restored from concept metadata;
a tool-free model can correct evidenced broken Markdown link targets. Repairs use
the existing bundle lease, source/corpus guards, private checkpoints and scoped
validated commits. They do not require `/maintenance retry`, human approval or a
foreground agent handoff. If extraction used this opportunity's model call, repair
queues for the next idle opportunity; saved extraction is reused after repair.
Repair proposals are bounded to two per unchanged corpus/policy, with findings,
applied files/rationale and fresh validation visible in watch/history. Failed repair
commits retry before new extraction. Newly advertised repair support automatically
re-admits old validation-blocked plans without deleting their attempt history;
already-attempted automatic repairs retain backoff. No fabricated facts, provenance, governance,
review dates or semantic relationships; findings outside structural authority stay
explicit blockers with the reason automatic repair could not proceed.

Successful OKF reviews can retain non-blocking validation advisories. Independent
concepts do not require invented relationships; schema, index/drift, broken links,
governance/provenance and stale-data findings remain blocking. Old orphan-only strict
validation records are classified without deleting receipts/plans; when the updated
adapter reports advisory policy, those plans are re-admitted for real validation and
Git finalization. They are never marked complete merely because policy changed.

Native maintenance compaction requests abort after the configured model-call
watchdog (10 minutes by default); it never kills
pi or releases a still-running operation early. Failed
pushes/finalization do not cause new extraction calls. A missing/oversized corpus,
unsupported model or findings outside the configured authority remain visible,
not invented successes. Full mode investigates broader corpus/Git failures instead
of parking them for human repair; unavailable host resources remain prerequisites. Knowledge uses attributed
addenda and automatic bundle-scoped commits, preserving unrelated outer-repository
staging. Push sends the **existing configured Git branch**, not a file-filtered
remote update; configure it only for the repository/upstream you intend to publish.
No force push, auto-rebase/reset, password prompt, fabricated identity or hook bypass.

## Host integration

Deployment-specific defaults belong to the host adapter, not these extensions.
Hosts can enable full ownership and idle compaction while keeping workspace
preferences authoritative by merging defaults with workspace settings before
sending `configure`. **Disable any old independent hygiene loop before enabling
this coordinator**; this package cannot prevent an uncooperative extension from
issuing parallel compactions/reviews.

A trusted adapter can use `pi-session-maintenance:control:v1`:

```ts
const request = { protocol: 1, operation: "configure", settings: {
  memoryOwnership: "full",  // unattended agent-owned memory; no human approval
  idleSeconds: 900,
  compaction: { enabled: true, minTokens: 50000, budgetTokens: 250000 }
}, result: undefined };
pi.events.emit("pi-session-maintenance:control:v1", request);
await request.result;
```

The responder assigns `result` synchronously. Operations: `status`, `configure`
(full settings object, defaults fill omissions), `run`, `cancel`, `suspend` with
`seconds`, and `resume`. Configure changes are runtime-local, not written into
host/persona files. Runtime replacement invalidates prior contexts. `stateDir`
changes require reload. No host-platform client or schema is implemented here.

Packages advertise `{memory?,summary?}` on
`pi-session-maintenance:capabilities:v1` using `{protocol:1,channel}` descriptors.
Requests carry the active context/registry, original cwd, immutable all-branch
snapshot/hash, source-freshness guard, cancellation signal, progress and usage
callbacks. Package implementations own their formats/validation and return
structured policy-keyed outcomes. These are documented trusted in-process
contracts, **not authentication boundaries or model-callable control tools**.

## Run transcripts and live inspection

Each admitted stage writes a native pi session JSONL under `<stateDir>/runs/`.
It is separate from the foreground conversation and normal session discovery,
so it neither grows foreground context nor gets maintained recursively. Updated
memory/summary adapters record exact model prompts, visible text/thinking streams,
final assistant responses (including usage/stop reason), progress and outcomes.
Knowledge runs also record plan concept IDs, validation and commit references.
Failures/cancellations retain partial output. Compaction logs reference the source
session; its native compaction entry still owns the result/usage, not a duplicate
model transcript. Older adapters can provide operational results without stream traces.

`/maintenance watch` follows the newest run in this workspace, including work owned
by another process. `Ctrl+Alt+M` opens it directly. `↑↓`/`j k` and PageUp/PageDown
scroll; `f`/End follows; `p` toggles model prompts; Esc closes. Elapsed time and time
since the last real log event help distinguish activity from a merely spinning UI.
`/maintenance history` opens a two-pane browser: `↑↓`/`j k` select runs on the
left and show logs/results on the right. `Tab` or `←→` switches focus; arrows and
PageUp/PageDown scroll the focused pane; End/`f` follows output in the detail pane.
Selection stays on the same run when new records arrive. Narrow terminals show
one pane at a time. An optional run ID preselects it. `logs` remains an unadvertised
compatibility alias. The detail pane groups JSON into semantic rows: status,
progress, results, validation, commit references, and clearly labeled model
proposals. Bold headings, icons and theme colors distinguish success, warnings
and failures. `r` toggles raw JSON; `t` toggles visible thinking. Unknown JSON fields
remain visible as readable key/value rows rather than being silently dropped.

Model details include requested/response model, reasoning level, output limit,
call deadline and elapsed time. New aborted calls show the originating cause:
timeout, local/peer foreground activity, explicit cancellation, runtime shutdown,
or provider-reported abortion. The native-session view also shows run termination
and provider error text. Older records display available errors without guessing
whether an unspecified abort was a timeout.
Provider-reported input/output/cache token counts and recorded cost are shown when
available. Costs are pi-normalized recorded amounts, not independently verified invoices. Input includes uncached + cache read + cache write; reasoning output
and 1-hour cache writes are labeled subsets, never added again. Visible-text
estimates use the same characters/4 heuristic as pi-context and are explicitly
marked `~`; signatures/base64 are not treated as text. Estimates are not billing
counts, missing/all-zero usage is not presented as exact zero, and no dollar cost
is inferred from estimates. Duplicate usage events and stream/final-response
copies are counted once. A recorded zero-dollar cost is not proof of free inference.

Enter opens the selected run's **read-only session transcript**. It shows native
user/assistant messages rather than progress-event logs. `p` toggles system
prompts, `t` toggles visible thinking, and `r` shows raw JSON entries. Esc returns
to history with the previous selection/scroll intact; a second Esc closes history.
It never resumes the transcript as an agent session, switches the foreground
conversation, or replays actions. RPC history returns a bounded run list (or a
selected run snapshot); headless hosts can read the control API's transcript paths. Opening a viewer does
not start jobs, acquire ownership, hold maintenance or issue model calls.

These transcripts contain private conversation/corpus material and provider-visible
reasoning. HTTP credentials/transport options are not intentionally recorded, but
prompts, outputs and error messages can themselves contain secrets; inspect/redact
before sharing. Directories are `0700`, files `0600`. Set
`modelTranscripts:false` (also available in settings) to keep only operational events
and accounting in future runs; this does not erase existing run transcripts. Full
recovery also omits durable provider-message context when disabled, re-investigating
from operational cases/checkpoints on continuation. Checkpoints still contain private
memory content and tool action metadata. Completed
runs retain at most 200 files for up to 30 days, pruned when the next run starts.
Active/unfinished files are never automatically deleted. A 32 MiB safety threshold
stops further work on an oversized transcript; viewer output is bounded separately.

## Storage and development

`state.db` stores observed sessions, receipts, controls, leases, daily spend and
resolved issue history. `/maintenance status` reports the actual loaded maintenance
configuration source (workspace file, defaults, or host override) and recent
archival counts; failed admission includes that configuration source too.
`/memory-diagnostics` identifies the memory package's independent binary/config
lookup. Old binary errors are grouped by workspace when legacy provenance is
missing; new errors carry the exact package/override resource.
`work/` stores private review proposals/application checkpoints and full recovery
cases/evidence. Keep state/work storage outside the knowledge bundle; the adapter
refuses recursive/private-in-bundle work directories before any commit. These can contain
sensitive rationale and source references; do not publish them. Directories are
owner-only and files owner-readable. Deleting this state loses receipts and can
cause repeat model work; session-search's paid caches live in its own database.

```bash
npm run dev:link-host  # local peer symlinks to installed pi/pi-tui; no duplicate host
npm test
npm run typecheck
```

Tests use fake model registries, temporary session files/corpora/Git repositories,
and real bundled OKF CLI validation. Cross-project adapter tests require adjacent
local checkouts. They **never launch authenticated pi, read auth.json, call a real
provider, or access personal browser/history data**. No model calls are needed.
