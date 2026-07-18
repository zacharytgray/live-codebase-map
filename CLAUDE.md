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

## Decisions (session 001, 2026-07-16)

- **Shape: A now, B-ready schema.** V1 is the pure human view. No agent-facing code, but the event schema and SQLite cache must not preclude an MCP query surface ("what depends on X?") bolting on without migration.
- **View surface: browser on a second monitor.** Auto-refreshing localhost page; the bet is that it's already on screen when the turn ends.
- **Study mode: passive-plus-one (revised 2026-07-18).** V1 ships the delta map plus exactly one active element: the claim-vs-change juxtaposition — the agent's stated intent rendered beside the actual structural delta. Both halves are already computed in v1, so the marginal cost is one panel. No prediction prompts, no flashcards. Rationale: a purely passive v1 runs the one clean self-experiment on the variant the comprehension research already predicts fails, and a null result would be ambiguous (idea dead vs. variant weak). Open/dwell instrumentation remains hard v1 scope.
- **Stack: TypeScript end-to-end.** Node tree-sitter bindings for capture; D3/Cytoscape for the view.
- **Capture: one batch per turn at Stop, buffered by PostToolUse (amended 2026-07-18 after doc scouting).** The transcript JSONL format is undocumented and lags at Stop time — nothing may parse it. Instead: a thin `PostToolUse` hook (matcher `Edit|Write|MultiEdit|NotebookEdit`) appends `.tool_input.file_path` to a per-session buffer, and an `async: true` `Stop` hook does all real work — buffered paths + `git status --porcelain` for changed files, the documented `last_assistant_message` field for turn text. The one-batch-per-turn spirit stands; no file watcher yet.
- **Annotations: both sources, compared.** Emit the `MAP:` note convention AND harvest turn text; every annotation carries its `origin`; the dogfood week decides which survives.
- **Dogfood: develop here, experiment on a real repo (revised 2026-07-18).** This repo is the development test bed, but the one-week experiment runs on whatever real repo is most active that week (likely Synapse). A map of a 15-file repo trivializes layout stability, overload, and delta-radiating views — the experiment's question needs real scale and real waits. Capture only appends to `.codemap/`, so worst-case pollution is one `rm -rf`.
- **Store is worktree-local and git-excluded in v1 (2026-07-18).** `.codemap/` goes in `.git/info/exclude` (not the observed repo's `.gitignore` — leave the observed repo untouched). Every event carries `branch` + `commit`; the view reconciles cross-branch history via provenance rather than git merging the log. The "JSONL git-merges well" argument from the research is deferred to multi-machine/team scenarios (candidate mechanism then: a dedicated ref, git-notes style). JSONL stays regardless: append-only, human-readable, trivially parseable.
- **V1 view derives state by in-memory replay of `events.jsonl` (2026-07-18).** No SQLite yet — at dogfood scale, replay is sub-millisecond and one fewer moving part. The cache lands when replay cost demands it or shape B needs query serving; the schema already supports it.
- **V1 home screen (2026-07-18):** top strip = the agent's claim line for the last turn (best available annotation) + turn number + freshness stamp; below it, the claim-vs-change panel (claim beside the actual touched entities/edges, glowing); below that, the ordered treemap with glow/decay overlay. Eye lands on the claim, then the glow. Three seconds should answer: what does the agent say it did, and where did it actually land.

- **Graph view is first-class, not a drill-in (2026-07-18, from first real user feedback).** Zach's reaction to the treemap: "just a bunch of shapes… I'm having trouble seeing relationships and functionality at a glance." The relationships he wants were already captured (`imports`/`defines`) but under-rendered. V1.1 adds a Map/Graph toggle: nodes = files, arrows = dependency edges, deterministic dagre layout fed in canonical path order, same glow overlay and detail sidebar. The treemap stays — it answers "where is the mass, what just moved"; the graph answers "what connects to what."
- **`codemap scan` + Swift (2026-07-18).** Full-repo baseline capture so a real repo is mappable before any agent turn. Swift grammar is a vendored wasm (`vendor/tree-sitter-swift.wasm`, built from tree-sitter-swift 0.7.1 sources with tree-sitter-cli/wasi-sdk — the published `tree-sitter-wasms` build ships a legacy `dylink` section web-tree-sitter 0.26 rejects; provenance in vendor/README.md). Swift gets `references` edges (cross-file type mentions, unambiguous-only) because same-module Swift files share symbols without imports — an import graph of a Swift app would be nearly empty.

## Current phase

Building v1 (since 2026-07-18). Schema is frozen — `docs/event-schema.md` is authoritative; changing it requires bumping `v` and a note there. Build order and pre-registered experiment criteria live in `CURRENT-TODOs.md`. TypeScript end-to-end; keep dependencies minimal and justified.

## How to verify

Capture core (steps 2–3) is built. From the repo root:

- `npm install` — deps are the four tree-sitter wasm packages + typescript/@types/node (native node-tree-sitter does not build on Node 26; we use `web-tree-sitter`).
- `npm run build` — `tsc` → `dist/`.
- `npm test` — builds, then runs the `node:test` suite (extraction, import resolution, diffing, `MAP:` parsing, and a buffer→stop integration test against a real temp git repo).
- `npx tsc --noEmit` — typecheck only.
- `node bin/codemap.js bench --repo <path> --files <n>` — the capture-latency check. Budget is ≤1s per turn; measured ~60ms pipeline / ~0.2s end-to-end (fresh process) for 10 changed files.
- `node bin/codemap.js scan [--repo <path>]` — full-repo baseline (git ls-files + untracked-not-ignored, incl. Swift). One `source: "scan"` batch, `turn: null`; re-scan only emits diffs plus fresh observations. Swift needs `vendor/tree-sitter-swift.wasm` (see vendor/README.md for provenance/rebuild).
- `node bin/codemap.js view [--repo <path>] [--port <n>] [--open]` — the map itself (default port 4177). Derives state by replaying `.codemap/events.jsonl`; SSE-updates the page when the log grows; writes open/dwell telemetry to `.codemap/telemetry.jsonl`.

Install into an observed repo with `node bin/codemap.js init --repo <path>` (creates `.codemap/`, adds it and `.claude/settings.local.json` to `.git/info/exclude`, merges the PostToolUse + Stop hooks into `.claude/settings.local.json` — local, never committable, because the hook command embeds this machine's absolute path). The view/SQLite/instrumentation layers are not built yet.
