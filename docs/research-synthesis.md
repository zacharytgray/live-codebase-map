# Research Synthesis & Brainstorm: The Live Codebase Map
*Synthesized 2026-07-16 from four parallel research passes: (1) prior art in code visualization, (2) agent memory and capture mechanisms, (3) developer behavior and cognition research, (4) storage and rendering technology.*

---

## 1. The headline: the niche appears to be genuinely open

Four findings, one from each research pass, converge on the same conclusion:

**The intersection you described is unoccupied.** The retrieval-index players (Cursor, Augment, Windsurf) have exactly the cheap incremental-capture plumbing you want, but they emit vectors for the agent and throw away the human-facing view. The visualization players (CodeSee, CodeCharta, DeepWiki) have the human view but pay heavy batch capture costs and don't tie the view to live agent edits. Nobody sits at: cheap incremental structured capture + stable-layout human view with change highlighting + timed to the agent wait cycle.

**The wait-time framing is recognized but unfilled.** Addy Osmani explicitly named "the doomscrolling gap: those 2-5 minutes when an agent is working and you have nothing to do." Every existing product answer (Vibe Kanban, Claude Squad, Conductor, Terragon) fills that gap by queueing *more agents* and turning the human into a triage worker. Nobody has framed the wait as *learning time*. The closest thing is a blog post of personal habits (Atomic Object's "26 Things To Do While Waiting for Your Agent"), not a product.

**The comprehension problem is now empirically documented.** Anthropic's own skill-formation RCT (Feb 2026, 52 engineers) found AI-assisted developers scored 17 points lower on comprehension quizzes of code they had just shipped, with the largest drops in debugging ability. GitClear's data shows copy-pasted code overtaking refactored code for the first time. "Comprehension debt" is now a named, cited concept. Your tool is a direct countermeasure.

**Zero-token capture is proven feasible.** A tool called code-review-graph already hooks Claude Code's `Stop` event and updates a tree-sitter-based code graph in ~0.4 seconds per turn with, quote, "LLM tokens used: 0." Your hard constraint is not just achievable, someone has demonstrated the mechanism. What they haven't built is the human-facing view or the wait-time experience on top of it.

## 2. The most important design insight from the research

This one reframes the whole idea, so it goes first.

**Passive viewing may not build comprehension. The Anthropic RCT found the difference between developers who retained understanding and those who didn't was not whether they looked at information, but whether they engaged actively.** Delegation-style users ("just make it work") scored under 40% on comprehension; question-driven users scored over 65%.

Implication: a map you merely glance at while waiting could end up being a prettier version of doomscrolling. The wait-time view should provoke micro-engagement, not just display. Cheap ways to do that, all rendered programmatically from the store:

- **Prediction prompts.** Before revealing the agent's changes, ask "the agent is editing the auth module: which downstream files do you think this touches?" Then reveal. Prediction-then-feedback is one of the strongest known learning mechanisms.
- **Claim-verification framing.** Show the agent's stated intent next to the actual structural change: "Claude said it was adding a cache layer. Here are the 3 edges that actually changed. Does that match?" This exploits top-down comprehension (hypothesis-then-verify), which is how experienced devs actually read code.
- **One-question flashcards from the store.** "What calls `resolvePayment()`?" is generatable from the graph with zero LLM involvement.

A second human-factors insight worth building around: **developers resume work by re-navigating, not by remembering.** Parnin & Rugaber found 93% of interrupted sessions began with re-navigation of the codebase, and only 10% resumed real work within a minute. So the map's job is not only to fill the wait; it pre-stages the re-orientation you will need the moment the agent finishes. "What changed since you last looked" is simultaneously the study material *and* the resumption cue. That dual use is the strongest version of the pitch.

Third: **attention residue.** Leroy's research shows an unfinished thought (the reason you fired the prompt) keeps leaking attention. A tiny "park your thought" input box, one line, timestamped to the turn, would let the dev close the loop before studying the map, and gives them their own context back on return. Nearly free to build, disproportionately valuable.

## 3. Why previous code visualization tools died (and how this dodges each cause)

The academic literature (Bedu et al. 2019 tertiary review, plus the CodeSee post-mortem era) is unusually clear about failure causes:

1. **Staleness.** One-shot snapshots diverge from code and lose trust. "A stale graph is worse than no graph if the agent trusts it too much." → Your capture-on-every-turn design is inherently anti-stale for agent-driven changes. The remaining gap is human edits outside the agent; a file watcher (codegraph's approach: OS-level watch, ~2s debounce, re-index only changed files) covers it. Every fact should carry a commit hash and timestamp so the view can show its own freshness.
2. **Wrong abstraction level / metaphor-chasing.** 3D code cities were impressive and unadopted. → The store should be organized around what devs actually forage for: "which files define behavior X, what depends on this, what would break." Boring module graphs and treemaps that answer real questions beat cities.
3. **Cognitive overload, no filtering.** Whole-codebase views overwhelm. → The wait-time frame is actually an advantage here: the default view is *the delta from this turn*, radiating outward. You almost never need the whole map at once.
4. **Layout instability destroying the mental map.** Kuhn's software cartography work established that consistent spatial layout across versions is what makes a map's mental model accumulate. → This is a hard technical requirement, covered in section 5.
5. **Not integrated into workflow.** A separate app you must remember to open dies. → It must appear where the wait happens: terminal-adjacent local web view, auto-refreshed by the hook, or even pushed into the same window.

## 4. The capture architecture (the "nearly free" requirement, made concrete)

The research surfaced a clean layering, echoing the principle "deterministic structure first, semantic summaries second":

**Layer 1: Structural facts, zero LLM tokens.** An async fire-and-forget hook on `PostToolUse`/`PostToolBatch` or `Stop` receives tool payloads for free: file paths, old_string/new_string for edits, bash commands. A background process runs tree-sitter on the changed files only, diffs the symbol graph (functions, classes, imports, call edges) against the last snapshot, and appends facts to the store. Proven cost: ~0.4s per turn, zero tokens, with CPU/RAM guards so it never competes with the agent. The agent doesn't even know it's happening.

**Layer 2: Semantic annotations, zero *marginal* tokens.** The "why" does not require a new LLM call, because the agent already narrates its intent in text it generates anyway. Three free sources, in increasing quality order: (a) heuristic extraction of the assistant text block nearest each edit in the turn (available in hook payloads and JSONL transcripts), (b) the agent's own commit messages if it commits, (c) a `CLAUDE.md` instruction asking the agent to end each turn with a one-line structured note like `MAP: payment-service -> added retry wrapper around stripe client`, which costs ~20 tokens of output it produces inline during generation, not a separate call. Option (c) is my favorite: near-zero cost, high signal, and the agent formats it for machine parsing.

**Layer 3 (optional, budgeted): periodic consolidation.** Once a day or on demand, a single cheap model pass tidies accumulated annotations into module-level summaries. This is the only place an LLM ever runs for the map, it's off the critical path, and it's skippable.

A caution from the research: hook-based capture is only as trustworthy as the hook config, and anything the agent can rewrite, it can (rarely, weirdly) subvert. Keep the capture process outside the agent's write scope.

## 5. Store and view (the programmatic layout requirement, made concrete)

**Store: append-only JSONL event log as the durable layer, ephemeral SQLite as the query layer.** JSONL is the only format that behaves well with your likely reality of git branches and multiple worktrees: line-based diffs, mostly conflict-free merges because writers append. SQLite and graph DBs are binary files that git cannot merge, so they should only ever be disposable read caches materialized from the log. SQLite's recursive CTEs handle "everything within 3 hops of what changed" fine at this scale. Each event: `{turn_id, ts, commit, entity, kind, edge?, annotation?, change_type}`.

**Layout stability is the make-or-break rendering requirement.** The user builds spatial memory of their codebase only if things stay where they were. Findings:

- d3-force is nondeterministic by default (internal Math.random); it can be seeded, but the better lever is pinning unchanged nodes at prior positions and only releasing new nodes into a warm-started simulation.
- dagre and Graphviz are deterministic but global: one new edge can reshuffle everything. dagre is stable if you feed nodes in canonical (path-sorted) order and add deltas rather than rebuilding.
- For the file/module overview, the **ordered treemap** (Shneiderman & Wattenberg 2001) was designed for exactly this problem: stable reading order under changing data, unlike squarified treemaps which shuffle.
- ELK layered has documented interactive/model-order options to bias layouts toward the previous run's arrangement.

**Change highlighting: flash then decay.** Gource's model maps perfectly: entities touched this turn glow bright, fading over the next N turns. Recency lives in an overlay (color/opacity keyed to `last_touched_turn`) fully decoupled from position, so highlighting never perturbs layout. GitHub's repo-visualizer convention (size = LOC, color = recency) is a reusable baseline.

**Progressive disclosure ladder:** module/directory (collapsed clusters, from folders or community detection) → file (nodes = files, edges = imports) → symbol (expand a file in place to its call graph). Expansion is local; the outer map never relayouts. Mermaid is not viable beyond ~100 nodes; Cytoscape.js handles thousands interactively; a custom D3 ordered treemap covers the overview.

## 6. Candidate product shapes (brainstorm)

**A. Claude Code hook + local web view (the MVP).** A shell hook on `Stop`, a small watcher process, JSONL in `.codemap/`, a local page on `localhost` that auto-refreshes when the log grows. Zero agent modification beyond one optional CLAUDE.md line. This is buildable as a weekend prototype and tests the core hypothesis: will you actually look at it during waits?

**B. MCP server variant.** The map store doubles as agent context: the same graph that renders for you can answer the agent's "what depends on this?" queries, saving the agent exploration tokens. This flips the cost story: capture doesn't just avoid costing tokens, it *saves* tokens on future turns (this is Aider's repo-map thesis, and the codegraph tools' pitch). The human view becomes a free byproduct of an agent optimization, which is a much easier adoption story.

**C. Multi-agent dashboard.** The research is blunt that devs already run several agents in parallel and suffer overload from it. A per-worktree change feed merged into one "what's moving across my whole session" view addresses tomorrow's problem, not yesterday's. Probably v2, but the JSONL-per-worktree design should anticipate it from day one.

**D. The "study mode" layer.** Prediction prompts, claim-vs-change verification, and graph-generated flashcards on top of any of the above. This is the differentiated part; A through C without it risk being another passive dashboard.

## 7. Sharpened open questions

1. **The engagement question (biggest risk).** Will a dev actually open the map instead of their phone? Research says the tool must be faster to reach than a phone unlock and must reward a 2-minute glance. What's the "first three seconds" experience? Possibly: the delta view is already on your second monitor when the turn ends, no action required.
2. **What is a "notable action"?** Proposed answer from the research: structural facts are captured exhaustively and cheaply (they're free), and "notability" becomes a *rendering* decision (what glows, what surfaces first), not a capture decision. That neatly avoids needing the agent to judge importance.
3. **Annotation quality floor.** Is harvested turn-text good enough, or does the CLAUDE.md structured-note convention become necessary? Testable early.
4. **Trust display.** Every rendered fact should be able to show its provenance (turn, commit, timestamp) so staleness is visible rather than silent. What's the lightest UI for that?
5. **Does the map double as agent context (shape B)?** If yes, the project competes in the crowded "code knowledge graph for agents" space (codegraph, CodexGraph, etc.) but with a unique human-facing surface. If no, it stays smaller and purer. Worth deciding early.

## 8. Suggested next steps

1. Try code-review-graph and codegraph on a real repo to feel what zero-token capture already yields and where it falls short (both are open source).
2. Prototype shape A: Stop-hook → tree-sitter diff → JSONL → static ordered-treemap page with decay highlighting. Measure capture latency and, more importantly, whether you look at it.
3. Draft the event schema (entity kinds, edge kinds, annotation attachment) before writing code; it's the real product.
4. Run the personal experiment for a week and journal whether next-prompt quality improves. The METR study warns that self-perception of AI workflows is unreliable, so log actual behavior (opens, dwell time) rather than trusting the feel.

---

## Appendix: key sources by thread

**Prior art:** CodeSee (acquired by GitKraken 2024, sunset), Cognition DeepWiki (cognition.com/blog/deepwiki), Aider repo map (aider.chat/2023/10/22/repomap.html), SCIP (sourcegraph.com/blog/announcing-scip), CodeCharta (codecharta.com), Bedu et al. 2019 failure review (fabiopetrillo.com/publication/2019bedu), Kuhn's software cartography on layout stability (scg.unibe.ch), "Coding Agents Need Codebase Maps" (developersdigest.tech/blog/codebase-knowledge-graphs-ai-coding-agents).

**Capture:** Claude Code hooks incl. async mode (code.claude.com/docs/en/agent-sdk/hooks), code-review-graph Stop-hook 0-token updates (github.com/tirth8205/code-review-graph), codegraph file-watcher (github.com/colbymchenry/codegraph), Claude Code auto memory (code.claude.com/docs/en/memory), MCP knowledge-graph memory server (modelcontextprotocol/servers), hook-subversion caution (danq.me/2026/03/03/ai-agent-logging).

**Human side:** METR RCT (metr.org, arXiv:2507.09089), Anthropic skill formation RCT (arXiv:2601.20245), JetBrains workflow telemetry 2026 (blog.jetbrains.com/research), GitClear 2025 (gitclear.com), Osmani on comprehension debt and the doomscrolling gap (addyosmani.com), Parnin & Rugaber resumption (Springer SQJ 2011), Leroy attention residue (2009), Vibe Kanban (github.com/BloopAI/vibe-kanban), Atomic Object wait-time list (spin.atomicobject.com).

**Store/render:** JSONL-vs-SQLite git-mergeability (gastown discussion #363), ordered treemaps (cs.umd.edu/hcil/trs/2001-06), stable incremental layout (Fraunhofer 2014), d3-force determinism (d3/d3-force#121), ELK interactive options (eclipse.dev/elk), Cytoscape.js perf (cytoscape.org/js-perf), Mermaid scale limits (mermaid-js#5042), Gource decay model (github.com/acaudwell/gource), repo-visualizer (githubocto/repo-visualizer).
