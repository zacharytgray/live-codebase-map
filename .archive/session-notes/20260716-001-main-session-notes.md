# Session 001 Notes — July 16, 2026

**Participants**: Zachary Gray, Claude (claude-fable-5)
**Session**: 8e169648-7097-4ce2-9970-ee8ba4266fd4

> Living document. Update throughout the session with what worked, lessons
> learned, mistakes made, assumptions proven wrong, and any other observations
> worth distilling later to improve performance on similar tasks and projects.
> Capture both wins and misses — validated approaches are just as much fuel
> for future improvement as corrections.

## What Worked

- Repo was scaffolded (README, CLAUDE.md, event-schema draft) before llm-dev init; the in-place template update skipped existing files cleanly, so nothing was clobbered.
- Structured decision quiz (AskUserQuestion, 4 forks per round) moved planning fast: 8 decisions locked in two rounds. Zach engaged with the trade-off descriptions directly.
- Scout-before-build paid off twice on 2026-07-18: (1) docs scout found the transcript format is undocumented + lags at Stop, forcing the PostToolUse-buffer amendment BEFORE any code assumed transcript parsing; (2) tree-sitter scout empirically reproduced the native-binding build failure on Node 26, avoiding a dead-end dependency. Both scouts ran in parallel; ~5 min wall clock.
- Orchestrator/implementer split (Fable orchestrating, Opus subagents): capture core landed in one shot, 27 tests, ~0.2s/turn; view landed in one shot, 37 tests total. Fresh-context verifier caught one real design flaw the implementer missed (span in the change predicate → line-shift churn in claim-vs-change); fixed at orchestrator level with a regression test.
- Gated risky steps work: the Swift-wasm implementer hit the ABI wall (stale `dylink` section in tree-sitter-wasms), STOPPED as instructed, and reported options instead of improvising — one SendMessage authorized the vendored build and the same agent finished with context intact.
- Orchestrator eyeballing between agent rounds matters: the first graph render passed all automated checks (52 tests, determinism, invariants) but was visually unusable — 92 nodes scaled to confetti. Only looking at the real render caught it; one feedback round (test-file filter, fit-to-width, node geometry measured against real dagre dims) fixed it. Lesson: "tests green" ≠ "communicates"; screenshot the real thing before calling a view done.

## Lessons Learned

- init-project.py appends the project name to `--path`; pass the PARENT directory to update an existing repo in place (dry-run caught this before any damage).

## Mistakes Made

- Ran the decision quiz faster than Zach could give it real attention — he later said he wasn't confident in his answers and deferred to Claude's judgment (2026-07-18). For big-fork questions, fewer per round with more context beats efficient batching.

## Assumptions Proven Wrong

- Recommended shipping one micro-engagement element in v1; Zach chose passive-first with instrumentation instead — consistent with the METR "measure actual behavior, not vibes" caution. Instrumentation (opens/dwell logging) is therefore hard v1 scope.

## Other Observations

- **First real engagement datapoint (2026-07-18):** Zach's unprompted reaction to the demo treemap — "I just see a bunch of shapes. It's really abstract… I'm having trouble seeing relationships and functionality at a glance," and he independently reinvented the dependency-graph view ("arrows showing dependencies from one function to another"). Two lessons: (1) the treemap communicates mass+recency but NOT relationships, and relationships are what a newcomer reaches for first; (2) the `imports`/`defines` edges were captured from day one but under-rendered — the data model was ahead of the view. Response: graph view promoted to first-class (Map/Graph toggle), `codemap scan` for cold-start on real repos, Swift + `references` edges so his actual codebases (HyprMac, Sidenote — both Swift) are mappable. Also worth remembering: demo-data demos undersell this tool; always show it on a repo the viewer knows.

- Decisions locked this session (also recorded in CLAUDE.md):
  1. Shape A now with a B-ready schema (MCP surface must bolt on without migration, but no agent-facing code in v1)
  2. View surface: browser on second monitor, auto-refreshing localhost page
  3. Study mode NOT in v1 — passive map + instrumentation, revisit after dogfood week
  4. Stack: TypeScript end-to-end (node tree-sitter bindings, D3/Cytoscape view)
  5. Capture: Stop hook only in v1 (no file watcher; human-edit staleness accepted for self-experiment)
  6. Annotations: both sources in v1 — MAP: note convention AND turn-text harvesting, origin-tagged, quality compared after a week
  7. Dogfood target: this repo itself, from first commit
  8. Session runs on stream `main`
- Repo made public at https://github.com/zacharytgray/live-codebase-map per Zach's request.
- **Proposal issue posted 2026-07-18** to Dallas's repo: https://github.com/DallasElleman/llm-dev/issues/22 (tags @DallasElleman). Framed per Zach's direction as thesis → what the MVP does → open brainstorm, NO roadmap/phases. Carries the git-tracked-vs-local open question as a named discussion point. Next: Zach may add a HyprMac graph screenshot via GitHub web UI; awaits Dallas's response before any llm-dev handler work.
- **2026-07-18 decision review** (Zach deferred to Claude's judgment): kept shape A/B-ready, TS stack, Stop-hook capture, both-annotation comparison, browser view, main stream. Revised two: study mode passive → passive-plus-one (claim-vs-change panel ships in v1; a purely passive experiment can't distinguish "idea dead" from "variant weak"), dogfood self → develop-on-self, experiment-on-real-repo (a 15-file graph trivializes every hard rendering problem). Added three: worktree-local git-excluded store with branch-tagged events, the v1 home-screen layout, and pre-registered dogfood success/pivot/kill criteria in CURRENT-TODOs.
