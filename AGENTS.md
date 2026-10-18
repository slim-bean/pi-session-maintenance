# pi-session-maintenance

Read README.md. Capability-driven maintenance, not a browser or knowledge implementation.

- Never launch an authenticated pi or read auth.json in tests. All model tests use fake registries.
- Loading the package authorizes configured autonomous maintenance; defaults apply only while pi is open. memoryOwnership limited/full is standing policy: explicit config > PI_MEMORY_OWNERSHIP > limited everywhere. Keep platform-specific defaults/detection in host adapters, never these extensions. Capture environment-default provenance at load; do not infer authenticated identity or an OS boundary. Full requires ownershipProtocol:1; never silently use a limited adapter.
- Source conversation history is read-only except native compaction. Opt-in daily rotation may append date-name/custom metadata and use native newSession; never rewrite/delete prior entries or synthesize a chat prompt. Keep departing sessions queued for archive review/summary.
- All branches belong in knowledge/search inputs. Do not treat off-branch as rejected.
- SQLite holds queue, receipts, controls, spend and advisory ownership. Never steal live/foreign owners based on age.
- Same-cwd participants publish busy state and interruption counters; poll them even during a running job. Keep progress visible and leases held until real stop.
- Unchanged idle full inspections are capped at 60 seconds, independently of heartbeat
  polls. Async source metadata plus config/model/queue changes invalidate that gate;
  forced runs bypass it. External corpus/Git changes are eventually rechecked within
  one minute. Never cache mutation admission, source assertions or commit proof.
- `snapshot-cache.ts` is read-only scheduler discovery only: bounded immutable
  projections, canonical identity/size/mtimeNs/ctimeNs invalidation, stable-read
  checks, clear on attach/shutdown. Never use it in assertSource, compaction or
  actual rotation admission. Same-day rotation polls may skip expensive guards
  only if neither metadata/name changes nor rotation are needed.
- Pin default maintenance models per session; only explicit settings/policy changes invalidate fresh model-keyed work.
- Native compaction is active-owner-only, checks file/in-memory agreement and compaction-aware tool pairing, and has a cooperative abort watchdog (never kill pi).
- `rotation.ts`: sessionRotation defaults off, UTC calendar with local/IANA overrides. YYYY-MM-DD names, monotonic calendar catch-up, native parent lineage, no model call. Gate on ownership/executor, idle, tools, saved/in-memory agreement, drafts, holds and monitor. Queue token-bound commands outside tick/lifecycle callbacks; switching while tick drains deadlocks teardown. Use fresh withSession contexts only; preserve runtime settings without overriding fresh host/workspace settings. Veto/failure retries back off. Dispose timers/tickets on reload/shutdown.
- Use documented versioned event contracts; no imports of sibling projects' private modules.
- Foreground input cancels background calls. Retain leases until operations have actually stopped.
- modelTimeoutSeconds is a whole-number 1–3600s per-call/compaction deadline (default
  600s). Pass modelTimeoutMs to adapters, preserve the first abort signal's reason,
  and show elapsed/deadline/provider errors in history and session views. Never infer
  timeout from an old generic aborted record or mutate the provider's native message.
- Keep corpus operations inside the OKF adapter, including configured limited/full recovery, commits and non-force pushes. Full failures continue automatically within budget/turn gates; unknown facts/governance are investigation/qualification work, not human approval. Only unavailable host resources or authority beyond memory scope are external prerequisites. Pass memoryGitIdentity only as explicit authorization, never invent it. Full shell has process permissions and does not inherit foreground tool overrides; logs are private/cooperative, not infrastructure audit. Never manufacture success.
- `store.ts` archives resolved blockers to issue_history only with fresh adapter evidence.
  Preserve original counters/messages/unknown timestamps; compare against the current
  issue before clearing it. Never manufacture review/summary completion receipts.
- Track actual configuration origin separately from Config; don't infer loaded settings
  from file existence after startup. Report file/default/host origins in status/errors.
- `issues.ts` classifies deferred/blocked/error outcomes and deduplicates by resource/code. Legacy validation parsing is narrow; do not erase receipts or label work complete on policy changes. Re-admit proven orphan-only saved plans when the adapter reports advisory policy; newly advertised repairPolicy:1 re-admits legacy memory-validation plans without erasing history or bypassing safety. Already-attempted automatic repairs keep their backoff.
- Retry limit: error/blocked failures past `maxRetries` park (`issue.parked` + stage-settings fingerprint). Deferrals neither count nor reset failures. Re-admit only on source change, relevant settings change/raised limit, or manual retry (one attempt, history kept). Never park deferrals or erase counters.
- `guidance.ts` gives code-specific next actions; show retry history and gates without implying retries can repair static prerequisites. Never invent a root cause or prior attempt timestamps.
- `format.ts` keeps slash-command output human-readable and bounded; host control status stays structured. Manual retry clears delay only, preserves history, and requests a check without aborting foreground work.
- `footer.ts` produces `🧹` blocks, active-only animation and a `/maintenance watch` hint. Animation uses cached footer state, never per-frame SQLite/source reads; stop its timer on completion/shutdown. Derive ownership on scheduler polls.
- `runs.ts` owns private native SessionManager transcripts outside normal discovery. Recovery replay contexts use model-context events, not duplicated native assistant messages/usage; tool-result events preserve executed tools. Respect modelTranscripts:false in durable worker cases too, while retaining operational/private corpus checkpoints. Never append background prompts/output to the source session. Preserve failed/cancelled output, distinguish unfinished from completed, respect modelTranscripts opt-out, and never record credential/transport options.
- `presentation.ts` projects immutable rows from native JSONL. Apply bold/theme/ANSI
  only at render time; retain raw JSON as an escape hatch. Separate model proposals
  from validation/commit evidence. Report exact provider usage vs labeled visible
  estimates; never count deltas plus final responses, usage events plus messages,
  reasoning output twice, signatures/base64 as text, or estimate dollar costs.
- `history.ts` owns the two-pane history list/detail UI (SelectList). Preserve run-ID
  selection and scroll during refresh; support narrow panes and nested read-only
  session inspection. Never switch/resume the foreground session to view a journal.
- `viewer.ts`/`passive-input.ts` own passive inspection: no model calls, scheduler holds, ownership changes or cancellation from monitor navigation. Normal foreground input still preempts work. Escape terminal controls and bound display sizes.
- Manual run/retry share runNow admission: no idle/poll delay, explicit blockers, no promise of running if nothing is due. Preserve checkpoints/attempt history and never bypass safety or budget gates.
- `settings.ts` uses built-in dialogs, draft-only edits and compare-before-rename workspace saves. Hold maintenance while editing; guard against session/config changes; never resolve credentials to list models.
- Tests: npm test; npm run typecheck. No model calls, normal session writes or browser launches.
