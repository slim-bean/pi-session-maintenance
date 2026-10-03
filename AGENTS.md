# pi-session-maintenance

Read README.md. Capability-driven maintenance, not a browser or knowledge implementation.

- Never launch an authenticated pi or read auth.json in tests. All model tests use fake registries.
- Loading the package authorizes configured autonomous maintenance; defaults apply only while pi is open.
- Source conversations are read-only except native compaction of the current owned session.
- All branches belong in knowledge/search inputs. Do not treat off-branch as rejected.
- SQLite holds queue, receipts, controls, spend and advisory ownership. Never steal live/foreign owners based on age.
- Use documented versioned event contracts; no imports of sibling projects' private modules.
- Foreground input cancels background calls. Retain leases until operations have actually stopped.
- Keep corpus operations inside the OKF adapter, including validation, automatic commits and configured non-force pushes.
- Tests: npm test; npm run typecheck. No model calls, normal session writes or browser launches.
