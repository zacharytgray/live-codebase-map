# Live Codebase Map

A tool that turns coding-agent wait time into codebase understanding: near-zero-cost capture of structural facts as the agent works, an append-only event store, and a delta-first visualization the developer reads between prompts.

## Read first

- `README.md` — the pitch, principles, and roadmap.
- `docs/event-schema.md` — the current design surface. Most design work happens here.
- `docs/research-synthesis.md` — before proposing architecture, check it; most obvious questions (store format, layout engine, capture hook point) already have researched answers with cited trade-offs.

## Design invariants

These are load-bearing. Don't trade them away for convenience:

1. **Capture is nearly free.** No LLM calls for visualization or capture, ever. Structural facts come from tree-sitter on changed files only; semantic annotations are harvested from text the agent already produced. If a proposed feature needs a new LLM call on the critical path, it's wrong.
2. **JSONL is the durable store; everything else is disposable.** The append-only event log is the source of truth and must stay git-mergeable. SQLite (or any binary index) is a read cache that can be deleted and rebuilt from the log at any time.
3. **Layout is deterministic and stable.** Same store state → same picture. Unchanged nodes keep their positions across turns. Change highlighting lives in an overlay (color/opacity), never in position.
4. **Delta-first views.** Default to what just changed; the whole-codebase view is the escape hatch, not the home screen.
5. **Provenance on every fact.** Each event carries turn id, commit hash, and timestamp; the view must be able to show how fresh any rendered fact is.
6. **Capture runs outside the agent's write scope.** The hook config and capture process must not be editable by the agent being observed.

## Current phase

Schema design — no implementation yet. Don't scaffold app code, pick frameworks, or add dependencies unless explicitly asked. The current deliverable is a good `docs/event-schema.md`.

## How to verify

Nothing to build or run yet. When code lands, replace this section with real commands (capture latency check belongs here — the budget is ~1s per turn, measured, per the prior-art baseline of 0.4s).
