# Idea Brief: The Live Codebase Map
### Turning agent wait time into codebase understanding
*Captured 2026-07-16 from a voice memo by Zachary. Origin note: not originally Zachary's idea, but one he wants to think through and brainstorm independently.*

---

## The problem

When developers work with coding agents (Claude Code, etc.), there is dead time between prompts while the agent works. That gap is "certainly at least in the minutes for most people." Today that time gets filled badly:

- Picking up your phone and context-switching away entirely
- Trying to juggle three or more Claude conversations in your head at once
- Passively watching a scrolling log

If you're serious about understanding your codebase, that time would be far better spent studying how the code works and getting a lay of the land, especially the parts the agent just touched.

## The core idea

A lightweight way for the agent to log high-level information about how the code works and how pieces connect, as it makes changes, stored somewhere structured. Then, while you wait on the next prompt, you read a visualization of your codebase built from that store, with recent changes highlighted.

Three components, as originally described:

1. **Capture.** As the agent works, it quickly logs "notable actions that affect codebase dynamics": what a part does, how it connects to other parts, what just changed. High-level, LLM-generated descriptions, not raw diffs.
2. **Store.** A database of some kind that holds this information in a form that can be programmatically laid out (i.e., structured enough that a renderer can draw it without an LLM in the loop), alongside the natural-language annotations.
3. **View.** A visualization of the codebase drawn cheaply from the store, highlighting recent changes, that the developer reads during agent wait time.

## The hard constraint (this is the whole game)

**Capture must be nearly free.** If the agent spends significant extra time or tokens producing visuals or elaborate documentation between every turn, wait time doubles and the entire purpose is defeated. The ultimate goal is still minimizing time between prompts; this rides along on top of it.

Implications:

- The agent emits cheap structured facts, not diagrams. Drawing is the client's job, done programmatically from the store.
- Logging should piggyback on work the agent already did (it already knows what it changed and why; capturing that should be a few lines, not a new task).
- No LLM calls purely for visualization. Layout is deterministic/programmatic.

## Why this might be worth building

- The wait time exists no matter what. It is otherwise wasted or spent on costly context switches.
- Reading about the code you're actively working on keeps you in the problem domain, so your next prompt is better informed.
- Over time the store becomes a living, high-level map of the codebase that survives beyond any one conversation, a side effect that may be as valuable as the wait-time experience itself.
- It directly addresses the "AI wrote it, I don't understand it anymore" comprehension debt problem.

## Open questions to brainstorm

- What exactly counts as a "notable action that affects codebase dynamics"? What is the schema?
- Where does capture hook in? (Agent hooks? Post-tool-call? End of turn? A watcher that reads the transcript?)
- What store? (SQLite? JSON graph? Something git-tracked so it branches with the code?)
- What does the view look like? (Module graph? Timeline of changes? Both? How interactive?)
- How does the store stay honest as code changes outside the agent (human edits, other branches)?
- Is this a Claude Code extension/hook, a standalone app watching the repo, an MCP server, or something else?
- How does staleness get handled cheaply, without re-summarizing the world?

## Prior art awareness

This idea wasn't original to Zachary; part of the research task is mapping who has tried adjacent things (codebase visualization tools, agent memory systems, repo maps) and why the specific wait-time framing plus near-zero capture cost might still be an open niche.
