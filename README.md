# pi-session-maintenance

An optional pi package coordinating idle OKF knowledge maintenance, all-branch
session-search summaries, and optional compaction. Dependencies are installed
separately; absent capabilities are skipped. Installed-but-broken adapters are
reported, not treated as successful work. Yono integration is deliberately separate.

Implementation is in progress. The initial core provides validated settings,
read-only all-branch conversation snapshots, and a private SQLite queue/ownership
ledger. No authenticated pi subprocesses or model calls are used by tests.

## Development

```bash
npm install
npm test
npm run typecheck
```
