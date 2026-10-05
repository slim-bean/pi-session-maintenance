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
- Keep corpus operations inside the OKF adapter, including validation, automatic commits and configured non-force pushes.
- `issues.ts` classifies deferred/blocked/error outcomes and deduplicates by resource/code. Legacy validation parsing is narrow; do not erase receipts or label work complete on policy changes. Re-admit only proven orphan-only saved plans when the adapter reports advisory policy.
- `guidance.ts` gives code-specific next actions; show retry history and gates without implying retries can repair static prerequisites. Never invent a root cause or prior attempt timestamps.
- `format.ts` keeps slash-command output human-readable and bounded; host control status stays structured. Manual retry clears delay only, preserves history, and requests a check without aborting foreground work.
- `footer.ts` produces terse `🧹` blocks without internal dot separators. Derive live wait/ownership/busy state on every poll and early tick return; never display cached progress as current executor state.
- `settings.ts` uses built-in dialogs, draft-only edits and compare-before-rename workspace saves. Hold maintenance while editing; guard against session/config changes; never resolve credentials to list models.
- Tests: npm test; npm run typecheck. No model calls, normal session writes or browser launches.
