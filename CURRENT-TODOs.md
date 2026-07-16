# Current TODOs - live-codebase-map

**Last Updated**: 2026-07-16

## Streams

| Slug | Name | Status | Claim | Since | Last Touched | Last Handoff |
|------|------|--------|-------|-------|--------------|--------------|
| main | Main | active | unclaimed | — | 2026-07-16 | |

<!-- Add streams with: /llm-dev:stream new <slug> "<name>" -->

## Stream: main

**Phase: planning (session 001).** Eight decisions locked 2026-07-16 — see CLAUDE.md "Decisions". Currently resolving the remaining schema open-decisions, then building.

### V1 build order

1. [ ] Freeze event schema — resolve open decisions in `docs/event-schema.md` (incl. new B-readiness question)
2. [ ] Capture: Stop hook → changed-file detection → tree-sitter diff → `.codemap/events.jsonl` (budget ≤1s per turn, measured)
3. [ ] Annotations: `MAP:` convention line for the observed repo's CLAUDE.md + turn-text harvester, both origin-tagged
4. [ ] View: local server + page — ordered treemap home, import-graph drill-in, glow/decay overlay, delta-first
5. [ ] Instrumentation: log view opens + dwell time (hard v1 scope — this data decides study mode)
6. [ ] Point it at this repo; dogfood for one week
7. [ ] Review dogfood data: annotation-quality comparison (MAP: vs harvested), open/dwell numbers → go/no-go on study-mode layer

---

## Backlog

- File watcher for human edits outside the agent (v1.x — anti-stale story)
- MCP query surface, shape B ("what depends on this?" answered from the same store)
- Multi-worktree / multi-agent dashboard (design anticipates it: per-worktree JSONL)
- Study-mode layer: claim-vs-change panel, prediction prompts, graph-generated flashcards
- `calls` edges, if `imports` alone proves too sparse for the drill-in view
- Layer 3 consolidation pass (daily, budgeted, off critical path)
