# Event Schema — v1 (frozen 2026-07-18)

*The durable store is an append-only JSONL log, one event per line, living in `.codemap/events.jsonl` inside the observed repo (worktree-local, git-excluded). All open decisions below are resolved for v1; changes now require bumping `v` and a note here.*

## Shape of an event

```json
{
  "v": 0,
  "id": "evt_01J...",
  "ts": "2026-07-16T14:03:22Z",
  "source": "agent-hook | file-watcher | consolidation | human",
  "turn": {"session_id": "abc123", "turn_id": 47},
  "branch": "main",
  "commit": "9f3c2a1 | null",
  "kind": "<see event kinds>",
  "...": "kind-specific fields"
}
```

- `v` — schema version, bump on breaking change. Currently `0`; "v1" in this doc's title is the product milestone, not this field.
- `loc` is the inclusive line count: `span[1] - span[0] + 1` (corrected 2026-07-18 — the original example implied exclusive, which yields 0 for one-liners).
- `entity.changed{modified}` fires on content-hash change only — a pure position shift (lines inserted above) is not a modification; fresh positions ride on `entity.observed`.
- `turn` is null for file-watcher events (human edits outside the agent).
- `commit` is the HEAD at capture time; null if the repo is dirty-only. Provenance = `(turn, commit, ts)` — every rendered fact must be traceable to these.

## Event kinds

### Structural (Layer 1 — tree-sitter, zero tokens)

**`entity.observed`** — an entity exists (or was re-confirmed) with current shape.

```json
{"kind": "entity.observed", "entity": {"id": "src/payments/stripe.ts#retryWrapper", "type": "function", "path": "src/payments/stripe.ts", "name": "retryWrapper", "span": [12, 48], "loc": 37}}
```

Entity types (deliberately small): `module` (directory), `file`, `class`, `function`. Resist adding more until the view needs them.

**`entity.changed`** — `{"change": "added | modified | removed | renamed", "entity_id": ..., "prev_id": "<for renames>", "delta_loc": 12}`

**`edge.changed`** — `{"change": "added | removed", "edge": {"from": "<entity_id>", "to": "<entity_id>", "type": "imports | calls | defines"}}`

Edge types start with these three. `calls` is best-effort from tree-sitter (no type resolution); that's fine — the map is a study aid, not a compiler.

### Semantic (Layer 2 — harvested, zero marginal tokens)

**`annotation`** — a natural-language claim about intent, attached to entities.

```json
{"kind": "annotation", "targets": ["src/payments/stripe.ts"], "text": "added retry wrapper around stripe client", "origin": "map-note | turn-text | commit-msg", "confidence": "stated | inferred"}
```

`origin` matters for the trust display: a structured `MAP:` note the agent wrote deliberately outranks a heuristic scrape of turn text.

### Maintenance

**`consolidation`** — Layer 3 output (optional daily pass): module-level summary replacing N stale annotations. Carries `supersedes: [event ids]`.

**`observation.stale`** — file watcher noticed a change it couldn't parse or a path it can't reconcile; the view renders affected regions as explicitly unknown rather than silently wrong.

## Entity identity (the hard problem)

`id = path + "#" + qualified_name`. This means renames break identity — accepted for v0, mitigated by `entity.changed{change: renamed}` when tree-sitter diffing can detect it (same body hash, new name/path). Don't build content-hash identity until the rename pain is proven real.

## What the view derives (not stored)

- **Recency/glow** — from `last event ts per entity`, decaying over turns. Never stored; always computed.
- **Notability** — a rendering decision (what glows, what surfaces first), computed from event density + annotation presence. The capture side never judges importance.
- **Flashcards / prediction prompts** — generated from the graph at render time ("what calls X?"), zero LLM.

## Open decisions

1. ~~One `events.jsonl` per worktree, merged at read time — or one log with a `worktree` field?~~ **Resolved 2026-07-18:** one log per worktree, worktree-local, git-excluded via `.git/info/exclude`. Events carry `branch` + `commit`; the view reconciles branch history from provenance instead of git merging the log. Multi-machine/team merging (dedicated ref?) deferred until it's real.
2. **Resolved 2026-07-18:** `entity.observed` fires for every entity in every changed file, every turn. The log is cheap, and per-entity `ts` doubles as the freshness signal — no prior-state bookkeeping needed for observation.
3. **Deferred:** no compaction in v1. `snapshot.graph` is a reserved kind, unused. Trigger to revisit: cold-start replay > 1s or log > 10 MB on the dogfood repo.
4. **Resolved 2026-07-18:** v1 captures `imports` + `defines` only. `calls` goes to the backlog — it's best-effort without type resolution, and nothing in the v1 view (treemap, claim-vs-change, import drill-in) needs it.
5. **Resolved 2026-07-18:** hook side. The capture process parses `MAP:` notes and turn text into structured `annotation` events at write time; the log never contains raw unparsed blobs.
6. **Resolved 2026-07-18:** B-readiness is purely an index concern — no event-shape change. The SQLite cache must serve three query patterns cheaply: reverse-deps within N hops of an entity (recursive CTE over edges), everything-changed-since-turn-N, and per-module edge rollups. Cache tables index on `entity_id`, `turn_id`, and edge `(from, to)`.

## v1 notes (session 001 decisions)

- Capture emits one batch per turn from the `Stop` hook; a thin `PostToolUse` buffer only accumulates touched file paths mid-turn. `source: file-watcher` is reserved but unused in v1.
- Both annotation origins (`map-note`, `turn-text`) ship in v1 and get quality-compared after the dogfood week — the `origin` field is load-bearing, not decorative. `turn-text` comes from the Stop payload's documented `last_assistant_message` field, never from transcript parsing (format undocumented, lags at Stop time).
- The claim-vs-change panel (revised study-mode decision) consumes `annotation` events joined against the same turn's `entity.changed`/`edge.changed` events — no new event kinds needed, which is what makes it nearly free.
