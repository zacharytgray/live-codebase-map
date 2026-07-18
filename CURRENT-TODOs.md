# Current TODOs - live-codebase-map

**Last Updated**: 2026-07-18

## Streams

| Slug | Name | Status | Claim | Since | Last Touched | Last Handoff |
|------|------|--------|-------|-------|--------------|--------------|
| main | Main | active | unclaimed | — | 2026-07-16 | |

<!-- Add streams with: /llm-dev:stream new <slug> "<name>" -->

## Stream: main

**Phase: planning (session 001).** Decisions locked 2026-07-16, two revised + three added 2026-07-18 after review — see CLAUDE.md "Decisions". Currently resolving the remaining schema open-decisions, then building.

### V1 build order

1. [x] Freeze event schema — all open decisions resolved 2026-07-18 (`docs/event-schema.md` is authoritative)
2. [x] Capture: PostToolUse path buffer + async Stop hook → web-tree-sitter diff → `.codemap/events.jsonl` — landed 2026-07-18, 27 tests, ~0.2s end-to-end for a 10-file turn, independently verified
3. [x] Annotations: `MAP:` + `last_assistant_message` harvester, both origin-tagged — landed with step 2
4. [x] View: `codemap view` server + page (claim strip, claim-vs-change, stable ordered treemap with glow/decay, SSE live updates) — landed 2026-07-18, independently verified
5. [x] Instrumentation: opens/heartbeat-dwell/visibility/clicks → `.codemap/telemetry.jsonl` — landed with step 4
6. [ ] Develop against this repo (hooks installed 2026-07-18); run the one-week experiment on the most active real repo that week (likely Synapse)
7. [ ] Score against the pre-registered criteria below; annotation-quality comparison (MAP: vs harvested) → go/no-go on full study-mode layer

### V1.1 (landed 2026-07-18, from first user feedback — "I just see shapes, I can't see relationships")

- [x] `codemap scan` — full-repo baseline capture (`source: "scan"`, `turn: null`, renders neutral)
- [x] Swift extraction via vendored wasm + `references` edges (cross-file type mentions, unambiguous-only)
- [x] Graph view — Map/Graph toggle, dagre layered layout, dir-colored nodes, imports+references arrows, hover neighborhood highlight, hide-tests filter (default on), fit-to-width + pan
- [x] Verified on HyprMac: 92 files scanned in 892ms; graph readable at 72 nodes / 173 edges with tests hidden

### Pre-registered dogfood criteria (set 2026-07-18, before any code — don't move the goalposts later)

- **Build v2 if:** map open during ≥50% of waits ≥60s (logged, not recalled), AND ≥3 journaled instances where the next prompt or a caught agent mistake traceably came from the map.
- **Pivot to shape B if:** opens are high but influence instances ≈ 0 (the view is decoration; the store may still earn its keep as agent context).
- **Shelve the wait-time thesis if:** opens collapse by mid-week despite the tool working (the phone won; note WHY in the journal before shelving).

---

## Backlog

- File watcher for human edits outside the agent (v1.x — anti-stale story)
- MCP query surface, shape B ("what depends on this?" answered from the same store)
- Multi-worktree / multi-agent dashboard (design anticipates it: per-worktree JSONL)
- Study-mode layer: claim-vs-change panel, prediction prompts, graph-generated flashcards
- `calls` edges, if `imports`/`references` alone proves too sparse for the drill-in view
- Bootstrap annotations for cold-scanned repos (one-time budgeted LLM pass, Layer-3-consistent, origin-labeled — needs Zach's opt-in per repo)
- Test-path heuristic: contrived basenames containing `tests.` mid-word (e.g. `attests.ts`) misclassify as tests (verifier nitpick, src/view/graph.ts:57)
- Layer 3 consolidation pass (daily, budgeted, off critical path)
