# Design: codemap × llm-dev integration

*Drafted 2026-07-18 (session 001), after Zach + Dallas raised integrating codemap into the llm-dev plugin. Status: exploration — nothing here is committed work. Written from inside an actual llm-dev session, so the touchpoints below are observed, not guessed.*

## Why these two want to merge

llm-dev already owns the **session lifecycle** (init-project → init-session → work → end-session), the **records** (manifests, session notes, handoffs, transcripts in `.archive/`), and the **stream/worktree model**. codemap owns the **structural memory** (what the code is and how it connects, per turn). They meet on a shared key and a shared philosophy:

1. **The joining key already exists.** codemap events carry `turn.session_id` from the Claude Code hook payload. llm-dev manifests record the same session UUID (this session's notes header says `Session: 8e169648-…` — the id codemap would stamp on every event captured this session). Zero schema work to correlate "what did session 001 change structurally" with "what session 001's handoff says it did."
2. **Streams ↔ worktrees ↔ stores align.** llm-dev's container layout gives each stream a worktree; codemap's store is deliberately worktree-local. One stream = one worktree = one `.codemap/` falls out for free.
3. **Handoffs are the annotation gold llm-dev already pays for.** A handoff is a deliberate, high-signal statement of what changed and why — better than harvested turn text, produced anyway at end-session. That's a future annotation origin (`handoff`, additive) with zero marginal token cost, exactly like the `MAP:` convention.

## Phasing

### Phase 0 — adjacency (possible today, no plugin changes)
`codemap init` + `scan` on an llm-dev project; keep `codemap view` open while working. Nothing integrates, everything coexists. This is the current state of live-codebase-map itself.

### Phase 1 — lifecycle wiring (small handler edits, big payoff)
- **init-project**: template step runs `codemap init && codemap scan` so every new llm-dev project is mapped from birth. Failure is non-fatal (codemap absent → skip with a note).
- **init-session**: print the map URL next to the session banner (optionally auto-open). The "already on your second monitor when the turn ends" bet gets institutionalized at the moment a session starts.
- **end-session**: two natural additions, both off the critical path:
  - **Session delta → handoff.** Filter `events.jsonl` by this session's id and render a compact "structural delta" section into the handoff doc (files touched, entities added/removed, edges changed). The next session's re-entry reading then includes what *actually* changed, not just what the outgoing session claimed — claim-vs-change at the session granularity, in prose.
  - **Summarize refresh.** `codemap summarize` runs here — "after the last major edit" is literally what end-session means. Budgeted, skippable, and the cost lands at a moment the human is already wrapping up. Generalized principle (Zach, 2026-07-18): end-session is the trigger point for *every* LLM-powered codemap feature, since the capture path between prompts must stay zero-LLM forever.

### Phase 2 — plugin-native capture
- The llm-dev plugin ships the PostToolUse/Stop hooks itself (plugin hook config), so any project with the plugin enabled gets capture without per-repo `codemap init`. Kills the biggest adoption friction; also centralizes the "capture outside the agent's write scope" guarantee at plugin level.
- A `/llm-dev:map` skill: opens the view for the current project/stream, scans if no store exists.
- Per-stream view filtering: events already carry `branch`; the view gains a stream selector fed from `.archive/streams/*.json`.

### Also in scope now: agents as consumers (shape B, endorsed 2026-07-18)

The store serves agents as well as humans: an MCP server exposing query tools ("what depends on X", "what references this type", "what changed since turn N", "what is this file for" via the summaries) lets a session's agent query the map instead of re-exploring the repo — capture stops being merely token-neutral and starts saving tokens. In llm-dev terms, a session could begin with the agent already holding map access as a tool. Humans get the same store rendered; agents get it queryable. How this meets llm-dev's session model is a prime Dallas-discussion topic.

### Phase 3 — the workspace dashboard (shape C, later)
llm-dev workspaces manage many projects; codemap's per-worktree JSONL was designed to merge at read time. A workspace-level view ("what moved across all my projects this week, by session") is the multi-agent dashboard from the research, with llm-dev supplying the project registry. Also: handoff/manifest links in the view — click a turn, open the session's handoff.

## The boundary (keep it boring)

llm-dev is Python; codemap is Node. Integration is **shell-out to the codemap CLI + JSONL as the contract** — no FFI, no shared library, no Python reimplementation. Handlers call `codemap scan|summarize|view --repo …` and read/filter `events.jsonl` directly (append-only JSONL is trivially parseable from Python). codemap never imports llm-dev concepts; llm-dev composes codemap commands. If codemap is absent, every integration point degrades to a no-op with a printed hint.

## Distribution options

| option | pro | con |
|---|---|---|
| npm package, plugin checks `npx codemap` | standard, versioned | Node dependency for a Python plugin's users |
| bundled in plugin cache (vendored dist/) | zero install | 3.4MB wasm + dist in plugin repo; update lag |
| standalone binary (bun compile / pkg) | no Node needed | build matrix, size |

Leaning: **npm package with a version pin in the plugin config**, `npx`-invoked, existence-checked at handler start. Revisit if Dallas objects to the Node requirement.

## Open questions (for Zach + Dallas)

1. Does llm-dev want codemap as a hard feature or an optional enhancement? (Phasing above assumes optional-with-degradation.)
2. Hook ownership: if both the plugin and a repo-local `codemap init` register hooks, dedupe strategy? (Probably: plugin hooks check for repo-local ones and yield.)
3. Should the handoff's structural-delta section be generated text (deterministic, from events) inside the handoff markdown, or a link to the view filtered to that session? (Leaning: both — one paragraph + a deep link.)
4. **Should `events.jsonl` be git-tracked?** (Elevated to a full discussion point 2026-07-18 — Zach + Dallas to decide. Current v1 behavior: excluded via `.git/info/exclude`. Regardless of the outcome, `state.json` stays local — derived cache, rebuildable, conflict-prone — and `telemetry.jsonl` stays local — personal behavioral data.)

   **Pros of tracking:**
   - Live architecture per branch: checkout a branch, get that branch's map; the map's history travels with the code's history, no extra sync machinery.
   - The "why" layer becomes durable and shared: a fresh clone gets the accumulated annotations and summaries. Structure can always be re-scanned from code; the accumulated intent layer can't be reconstructed.
   - Merges mostly work: a `.gitattributes` union merge driver concatenates both branches' events (derive already orders by timestamp), and the post-merge `codemap scan` shrinks to a small corrective delta — automatable with a `post-merge` hook.
   - Team/multi-machine support falls out of git itself, instead of needing the dedicated-ref design.

   **Cons of tracking:**
   - Diff noise and a perpetually dirty working tree: the log churns every agent turn. `linguist-generated` collapses it in PR diffs and the union driver prevents conflicts, but both mitigations must actually be configured, and `git status` noise remains.
   - Without the union driver, append-only files conflict at the tail on every branch merge — the naive setup is worse than either deliberate choice.
   - A merged log is still not ground truth: it can't know how code conflicts were resolved, so scan-after-merge stays necessary; tracking only makes the correction small.
   - Privacy: the log contains harvested agent turn-text and `MAP:` notes — committing it publishes the agent's narration of the work. Sharp for public repos; a per-repo sensitivity call.
   - Unbounded growth in git history; every clone carries all of it (makes log compaction/snapshotting more urgent).
   - Adds config surface: it has to be a per-repo choice at `codemap init` time (`--tracked` vs `--local`).
5. Where do `handoff`-origin annotations land in the trust ranking relative to `map-note`? (Proposed: handoff > map-note > turn-text, since handoffs are reviewed prose.)
