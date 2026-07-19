# Session 001 Handoff — live-codebase-map (stream: main)

## Where We Left Off

The v1 MVP is built, verified, public, and dogfood-armed, and a collaboration proposal is now live on Dallas Elleman's llm-dev repo ([issue #22](https://github.com/DallasElleman/llm-dev/issues/22)). The ball is in Dallas's court — no further llm-dev integration code should be written until he responds. The remaining first-party work is the dogfood experiment itself (running the tool on a real repo for a week), which is a human activity, not a build task.

## Wins This Session

- **Full v1 capture→store→view pipeline shipped**, committed on `main`, pushed to a public repo. 60 tests passing, `tsc --noEmit` clean, capture ~0.2s/turn (5× under the ≤1s budget).
- Independently verified three times by fresh-context verifier agents (capture core, view, scan/Swift/graph, summarize/sidebar). Each caught real issues that were fixed before commit.
- **Proven on a real 92-file Swift repo (HyprMac):** scan in 892ms, 227 cross-file `references` edges, 92 LLM summaries generated in ~3.4 min with zero failures.
- Proposal issue posted to llm-dev#22, framed exactly as Zach wanted (thesis + open brainstorm, no roadmap).

## Active Branches / PRs / Issues

- **Repo:** https://github.com/zacharytgray/live-codebase-map — public, all work on `main`, working tree clean, everything pushed.
- **[DallasElleman/llm-dev#22](https://github.com/DallasElleman/llm-dev/issues/22)** — OPEN, awaiting Dallas's response. This is the live external thread.
- No open PRs. No feature branches (repo uses the legacy flat llm-dev layout — single dir, single branch, `.archive/` is plain dirs on `main`, NOT a worktree).

## In-Flight Work

Nothing is mid-implementation. The codebase is at a clean stopping point. The next *actions* are non-code:
1. **The dogfood experiment** — install capture into an active real repo (likely Synapse), keep the view open for a week, score against the pre-registered criteria in `CURRENT-TODOs.md`. Install: `node bin/codemap.js init --repo <repo>` then `codemap scan` + `codemap view`. Not started.
2. **Optional:** Zach may add a HyprMac graph screenshot to issue #22 via the GitHub web UI (image uploads don't work via `gh` CLI).

## Deferred or Course-Corrected

- **llm-dev integration code — deliberately not started.** We lead with an issue, not a PR, because it's Dallas's repo and this is a design conversation; handler edits wait for his input.
- **git-tracked vs local event log — OPEN QUESTION, not decided.** Documented with full pros/cons in `docs/llm-dev-integration.md` §open-questions #4; it's a named agenda item for the next Zach↔Dallas meeting. Do not implement either side yet.
- **MCP/shape-B agent query surface — endorsed but not built.** Zach wants agents as first-class consumers; design waits until after the Dallas discussion.
- **Branch-accuracy & subtree-scoped views** — identified as real gaps this session (the store doesn't currently filter the view by branch; `scan` is the ground-truth refresh). Good directions, not yet backlogged as tasks — worth capturing if pursued.
- **Broader UI scaling polish** — deferred by Zach; it's proof-of-concept phase, don't polish before the concept settles.

## Locked-In Decisions

Full list in `CLAUDE.md` "Decisions" — the load-bearing ones:
- Shape A now, **B-ready schema** (agent MCP surface must bolt on without migration).
- **Capture is zero-LLM, forever** — the core invariant. All LLM features (summaries) trigger at **session end only**, never during/between prompts.
- Store: single `.codemap/` at repo root (NOT per-directory), git-excluded in v1, one append-only `events.jsonl`; `state.json`/`telemetry.jsonl` always stay local.
- Views: treemap (mass + glow/decay) AND graph (dependencies) as co-equal, toggle between them; claim-vs-change panel; delta-first.
- Study mode: passive-plus-one (only the claim-vs-change panel), measure via instrumentation before building more.
- Dogfood: develop on this repo, run the *experiment* on a real repo.

## Key References

- `CLAUDE.md` — decisions + design invariants (read first).
- `docs/event-schema.md` — FROZEN v1 schema; changing it requires bumping `v`.
- `docs/llm-dev-integration.md` — the integration design + the git-tracked open question.
- `CURRENT-TODOs.md` — build order (v1/v1.1/v1.2 all landed) + pre-registered dogfood success/pivot/kill criteria.
- `README.md` — the pitch.
- The MVP: `node bin/codemap.js {init,scan,view,summarize,bench} --repo <path>`.

## Gotchas

- **Node 26 breaks native tree-sitter** — we use `web-tree-sitter` (wasm). The Swift grammar is a hand-built vendored wasm at `vendor/tree-sitter-swift.wasm` (the published `tree-sitter-wasms` build has a stale `dylink` section web-tree-sitter 0.26 rejects). Don't swap it for the npm package.
- Hook install goes in `.claude/settings.local.json` (machine-absolute paths), not `settings.json`.
- The view demo data is unimpressive by design — always demo on a real repo the viewer knows.
- Background subagents occasionally return degenerate/empty results; confirm `git status` before trusting a completion, relaunch fresh if so.

## First Action for Next Session

Start by reading `CLAUDE.md` (decisions + invariants), `CURRENT-TODOs.md` (what landed + the dogfood criteria), and checking [llm-dev#22](https://github.com/DallasElleman/llm-dev/issues/22) for any reply from Dallas. Then greet Zach, relay your understanding — v1 is built and public, the proposal is posted and awaiting Dallas, and the next real step is the dogfood experiment or reacting to Dallas's response — and ask whether anything has changed (has Dallas replied? did the dogfood week happen?) or whether to resume from here. Don't jump into action; the natural next moves depend on external input (Dallas) and a human activity (dogfooding), so pick up the thread first.
