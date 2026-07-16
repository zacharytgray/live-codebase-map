# Live Codebase Map

Turning agent wait time into codebase understanding.

## The problem

When you work with a coding agent, there are minutes of dead time between prompts. Today that time gets spent badly: phone, juggling three conversations, or passively watching a log scroll. Meanwhile the agent is rewriting code you increasingly don't understand — Anthropic's own RCT found AI-assisted developers scored 17 points lower on comprehension of code they had just shipped. The wait time exists no matter what; it could be spent rebuilding exactly the understanding the agent is eroding.

## The idea

Three components:

1. **Capture.** As the agent works, structured facts about what changed and how pieces connect get logged automatically — file/symbol-level structure from tree-sitter, intent harvested from text the agent already generates.
2. **Store.** An append-only JSONL event log (git-friendly, branch-mergeable) with a disposable SQLite cache for queries.
3. **View.** A local, auto-refreshing visualization drawn programmatically from the store — recent changes glowing and decaying, the delta from this turn front and center.

While you wait on the agent, you read the map. When the turn ends, the "what changed" view doubles as your re-orientation cue (devs resume work by re-navigating, not remembering — Parnin & Rugaber).

## The one hard constraint

**Capture must be nearly free.** If the agent spends meaningful time or tokens producing documentation between turns, wait time grows and the whole purpose is defeated. Concretely:

- No LLM calls for visualization, ever. Layout is deterministic and programmatic.
- Structural capture is zero-token: a hook fires after the turn, tree-sitter diffs only the changed files (~0.4s demonstrated by prior art).
- Semantic capture piggybacks on text the agent already produces (turn narration, commit messages, or an optional one-line `MAP:` note convention costing ~20 inline tokens).

## Why the niche appears open

The retrieval-index players (Cursor, Augment) have cheap incremental capture but emit vectors for the agent and throw away the human view. The visualization players (CodeSee, DeepWiki, CodeCharta) have the human view but pay heavy batch capture costs disconnected from live agent edits. The wait-time gap is named in the discourse ("the doomscrolling gap" — Osmani) but every product answer fills it with *more agents*, not learning. Full analysis in [docs/research-synthesis.md](docs/research-synthesis.md).

## Design principles

Distilled from why previous code-viz tools died, plus the comprehension research:

1. **Anti-stale by construction.** Capture on every turn; a file watcher covers human edits. Every fact carries turn, commit, and timestamp so freshness is visible, never assumed.
2. **Layout stability is make-or-break.** Spatial memory only accumulates if things stay where they were (Kuhn's software cartography). Pin unchanged nodes; ordered treemaps over squarified; expansion is local and never relayouts the outer map.
3. **Delta-first.** The default view is what this turn touched, radiating outward. Never the whole codebase at once.
4. **Micro-engagement over passive display.** Passive glancing is prettier doomscrolling; comprehension comes from active engagement (prediction prompts, claim-vs-change verification, graph-generated flashcards — all zero-LLM).
5. **Live where the wait happens.** A separate app you must remember to open dies. The view should already be on screen when the turn ends.
6. **"Notable" is a rendering decision, not a capture decision.** Capture structure exhaustively (it's free); let the view decide what glows.

## MVP — shape A

Claude Code `Stop` hook → tree-sitter diff of changed files → JSONL events in `.codemap/` → local web page (ordered treemap + import graph) that auto-refreshes when the log grows. Zero agent modification beyond one optional CLAUDE.md line. Buildable as a weekend prototype; tests the core hypothesis: *will I actually look at it during waits?*

Later shapes: MCP server so the same graph answers the agent's "what depends on this?" queries (capture becomes token-*saving*, not just token-neutral); multi-worktree dashboard; study-mode layer.

## Roadmap

1. **Draft the event schema** — [docs/event-schema.md](docs/event-schema.md). This is the real product; code comes after.
2. **Feel out prior art** — run [code-review-graph](https://github.com/tirth8205/code-review-graph) and [codegraph](https://github.com/colbymchenry/codegraph) on a real repo; see what zero-token capture already yields.
3. **Prototype shape A** and measure capture latency.
4. **One-week self-experiment** — log actual opens and dwell time, not vibes (METR: self-perception of AI workflows is unreliable).

## Status

**2026-07-16** — idea captured, research synthesis done, repo scaffolded. Schema design is the current work. No code yet.

## Docs

- [docs/idea-brief.md](docs/idea-brief.md) — the original idea, verbatim
- [docs/research-synthesis.md](docs/research-synthesis.md) — four-thread research pass: prior art, capture mechanisms, cognition research, storage/rendering tech (with full source list)
- [docs/event-schema.md](docs/event-schema.md) — draft event schema (the current design surface)
