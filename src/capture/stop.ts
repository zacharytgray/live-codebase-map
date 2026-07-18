import { existsSync, readFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { resolveRepoRoot, isSourceExt } from "../shared/paths.js";
import { gitBranch, gitCommit, gitStatusPaths } from "../shared/git.js";
import {
  entityObserved,
  entityChanged,
  edgeChanged,
  type EventCtx,
} from "../shared/events.js";
import { extractFile, toShape, type ExtractEdge } from "./extract.js";
import { resolveImports } from "./resolve-imports.js";
import { loadState, saveState, diffFile, toStored, type StoredEntity, type StoredEdge } from "./state.js";
import { buildAnnotations } from "./annotations.js";
import { readBuffer, clearBuffer, nextTurnId } from "./buffer.js";
import { appendEvents } from "../store/jsonl.js";

export interface StopPayload {
  session_id: string;
  cwd?: string;
  stop_hook_active?: boolean;
  last_assistant_message?: string;
  hook_event_name?: string;
}

export interface RunStopOptions {
  payload: StopPayload;
  repoRoot?: string;
  codemapDir?: string;
  // bench: use these files directly instead of buffer u git-status, and don't touch the buffer
  forcedChangedFiles?: string[];
}

export interface RunStopResult {
  events: number;
  changedFiles: number;
  turnId: number | null;
}

interface ChangeSet {
  changed: string[]; // exist on disk
  deleted: string[]; // gone from disk
}

function detectChangedFiles(repoRoot: string, codemapDir: string, sessionId: string): ChangeSet {
  const buf = readBuffer(codemapDir, sessionId).map((b) => b.file_path);
  const { changed: gc, deleted: gd } = gitStatusPaths(repoRoot);
  const candidates = new Set<string>([...buf, ...gc, ...gd]);
  const changed: string[] = [];
  const deleted: string[] = [];
  for (const rel of candidates) {
    if (!isSourceExt(rel)) continue;
    if (rel === ".codemap" || rel.startsWith(".codemap/")) continue;
    if (existsSync(join(repoRoot, rel))) changed.push(rel);
    else deleted.push(rel);
  }
  return { changed, deleted };
}

export async function runStop(opts: RunStopOptions): Promise<RunStopResult> {
  const { payload } = opts;
  const repoRoot = opts.repoRoot ?? resolveRepoRoot(payload.cwd || process.cwd());
  const codemapDir = opts.codemapDir ?? join(repoRoot, ".codemap");
  mkdirSync(codemapDir, { recursive: true });

  let changed: string[];
  let deleted: string[];
  if (opts.forcedChangedFiles) {
    changed = opts.forcedChangedFiles.filter((f) => isSourceExt(f) && existsSync(join(repoRoot, f)));
    deleted = [];
  } else {
    ({ changed, deleted } = detectChangedFiles(repoRoot, codemapDir, payload.session_id));
  }

  // zero relevant changes -> emit nothing, just clear the buffer
  if (changed.length === 0 && deleted.length === 0) {
    if (!opts.forcedChangedFiles) clearBuffer(codemapDir, payload.session_id);
    return { events: 0, changedFiles: 0, turnId: null };
  }

  const turnId = nextTurnId(codemapDir, payload.session_id);
  const ctx: EventCtx = {
    session_id: payload.session_id,
    turn_id: turnId,
    branch: gitBranch(repoRoot),
    commit: gitCommit(repoRoot),
  };

  const state = loadState(codemapDir);
  const events: Record<string, unknown>[] = [];
  const annotationTargets = [...changed, ...deleted];

  for (const rel of changed) {
    let source: string;
    try {
      source = readFileSync(join(repoRoot, rel), "utf8");
    } catch {
      continue; // vanished between detection and read
    }
    const fx = await extractFile(rel, source);
    if (!fx) continue;

    const importTargets = resolveImports(repoRoot, rel, fx.imports);
    const importEdges: ExtractEdge[] = importTargets.map((t) => ({ from: rel, to: t, type: "imports" }));

    const nextEntities: Record<string, StoredEntity> = {};
    for (const e of fx.entities) nextEntities[e.id] = toStored(e);
    const nextEdges: StoredEdge[] = [...fx.defines, ...importEdges];

    // observed fires for every entity in every changed file
    for (const e of fx.entities) events.push(entityObserved(ctx, toShape(e)));

    const d = diffFile(state.files[rel], { entities: nextEntities, edges: nextEdges });
    for (const e of d.added) events.push(entityChanged(ctx, "added", e.id, e.loc));
    for (const m of d.modified) events.push(entityChanged(ctx, "modified", m.entity.id, m.deltaLoc));
    for (const e of d.removed) events.push(entityChanged(ctx, "removed", e.id, -e.loc));
    for (const edge of d.edgesAdded) events.push(edgeChanged(ctx, "added", edge));
    for (const edge of d.edgesRemoved) events.push(edgeChanged(ctx, "removed", edge));

    state.files[rel] = { entities: nextEntities, edges: nextEdges };
  }

  // deleted files: remove every entity (and edge) from the prior snapshot
  for (const rel of deleted) {
    const old = state.files[rel];
    if (!old) continue;
    for (const e of Object.values(old.entities)) events.push(entityChanged(ctx, "removed", e.id, -e.loc));
    for (const edge of old.edges) events.push(edgeChanged(ctx, "removed", edge));
    delete state.files[rel];
  }

  events.push(...buildAnnotations(ctx, payload.last_assistant_message ?? "", annotationTargets));

  appendEvents(codemapDir, events);
  saveState(codemapDir, state);
  if (!opts.forcedChangedFiles) clearBuffer(codemapDir, payload.session_id);

  return { events: events.length, changedFiles: changed.length + deleted.length, turnId };
}
