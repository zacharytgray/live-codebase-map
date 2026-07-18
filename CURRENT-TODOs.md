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

1. [ ] Freeze event schema — resolve open decisions in `docs/event-schema.md` (incl. B-readiness question)
2. [ ] Capture: Stop hook → changed-file detection → tree-sitter diff → `.codemap/events.jsonl` (budget ≤1s per turn, measured; `.codemap/` via `.git/info/exclude`)
3. [ ] Annotations: `MAP:` convention line for the observed repo's CLAUDE.md + turn-text harvester, both origin-tagged
4. [ ] View: local server + page — claim strip on top, claim-vs-change panel, ordered treemap with glow/decay, delta-first
5. [ ] Instrumentation: log view opens + dwell time (hard v1 scope — this data decides the rest of study mode)
6. [ ] Develop against this repo; run the one-week experiment on the most active real repo that week (likely Synapse)
7. [ ] Score against the pre-registered criteria below; annotation-quality comparison (MAP: vs harvested) → go/no-go on full study-mode layer

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
- `calls` edges, if `imports` alone proves too sparse for the drill-in view
- Layer 3 consolidation pass (daily, budgeted, off critical path)
