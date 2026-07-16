# Event Schema — draft v0

*The durable store is an append-only JSONL log, one event per line, living in `.codemap/events.jsonl` inside the observed repo (one log per worktree; merged at view time). This document is the design surface — argue with it before writing code.*

## Shape of an event

```json
{
  "v": 0,
  "id": "evt_01J...",
  "ts": "2026-07-16T14:03:22Z",
  "source": "agent-hook | file-watcher | consolidation | human",
  "turn": {"session_id": "abc123", "turn_id": 47},
  "commit": "9f3c2a1 | null",
  "kind": "<see event kinds>",
  "...": "kind-specific fields"
}
```

- `v` — schema version, bump on breaking change.
- `turn` is null for file-watcher events (human edits outside the agent).
- `commit` is the HEAD at capture time; null if the repo is dirty-only. Provenance = `(turn, commit, ts)` — every rendered fact must be traceable to these.

## Event kinds

### Structural (Layer 1 — tree-sitter, zero tokens)

**`entity.observed`** — an entity exists (or was re-confirmed) with current shape.

```json
{"kind": "entity.observed", "entity": {"id": "src/payments/stripe.ts#retryWrapper", "type": "function", "path": "src/payments/stripe.ts", "name": "retryWrapper", "span": [12, 48], "loc": 36}}
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

1. One `events.jsonl` per worktree, merged at read time — or one log with a `worktree` field? (Per-worktree matches the JSONL merge story and anticipates the multi-agent dashboard.)
2. Does `entity.observed` fire for every entity in a changed file each turn (simple, bigger log) or only on shape change (smaller, needs prior-state diffing)? Leaning: every entity in changed files; the log is cheap and it doubles as the freshness signal.
3. Compaction story — the log grows forever by design; when does a snapshot event (`snapshot.graph`) become worth it so cold-start replay stays fast?
4. Is `calls` worth capturing in v0, or do `imports` edges alone carry the MVP treemap/graph view?
5. Where does the `MAP:` note convention get parsed — hook side (structured at capture) or store side (raw text event, parsed at read)? Leaning: hook side, keep the log clean.
