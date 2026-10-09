# pi-session-maintenance

Read README.md. Capability-driven maintenance, not a browser or knowledge implementation.

- Never launch an authenticated pi or read auth.json in tests. All model tests use fake registries.
- Loading the package authorizes configured autonomous maintenance; defaults apply only while pi is open.
- Source conversations are read-only except native compaction of the current owned session.
- All branches belong in knowledge/search inputs. Do not treat off-branch as rejected.
- SQLite holds queue, receipts, controls, spend and advisory ownership. Never steal live/foreign owners based on age.
- Same-cwd participants publish busy state and interruption counters; poll them even during a running job. Keep progress visible and leases held until real stop.
- Pin default maintenance models per session; only explicit settings/policy changes invalidate fresh model-keyed work.
- Native compaction is active-owner-only, checks file/in-memory agreement and compaction-aware tool pairing, and has a cooperative abort watchdog (never kill pi).
- Use documented versioned event contracts; no imports of sibling projects' private modules.
- Foreground input cancels background calls. Retain leases until operations have actually stopped.
- modelTimeoutSeconds is a whole-number 1–3600s per-call/compaction deadline (default
  600s). Pass modelTimeoutMs to adapters, preserve the first abort signal's reason,
  and show elapsed/deadline/provider errors in history and session views. Never infer
  timeout from an old generic aborted record or mutate the provider's native message.
- Keep corpus operations inside the OKF adapter, including validation, automatic commits and configured non-force pushes.
- `store.ts` archives resolved blockers to issue_history only with fresh adapter evidence.
  Preserve original counters/messages/unknown timestamps; compare against the current
  issue before clearing it. Never manufacture review/summary completion receipts.
- Track actual configuration origin separately from Config; don't infer loaded settings
  from file existence after startup. Report file/default/host origins in status/errors.
- `issues.ts` classifies deferred/blocked/error outcomes and deduplicates by resource/code. Legacy validation parsing is narrow; do not erase receipts or label work complete on policy changes. Re-admit only proven orphan-only saved plans when the adapter reports advisory policy.
- `guidance.ts` gives code-specific next actions; show retry history and gates without implying retries can repair static prerequisites. Never invent a root cause or prior attempt timestamps.
- `format.ts` keeps slash-command output human-readable and bounded; host control status stays structured. Manual retry clears delay only, preserves history, and requests a check without aborting foreground work.
- `footer.ts` produces `🧹` blocks, active-only animation and a `/maintenance watch` hint. Animation uses cached footer state, never per-frame SQLite/source reads; stop its timer on completion/shutdown. Derive ownership on scheduler polls.
- `runs.ts` owns private native SessionManager transcripts outside normal discovery. Never append background prompts/output to the source session. Preserve failed/cancelled output, distinguish unfinished from completed, respect modelTranscripts opt-out, and never record credential/transport options.
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
