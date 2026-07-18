import { existsSync, readFileSync, mkdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { resolveRepoRoot, isSourceExt } from "../shared/paths.js";
import { gitBranch, gitCommit, gitListFiles } from "../shared/git.js";
import { entityObserved, entityChanged, edgeChanged, type EventCtx } from "../shared/events.js";
import { extractFile, toShape, type ExtractEdge } from "./extract.js";
import { resolveImports } from "./resolve-imports.js";
import { applyReferencePass } from "./references.js";
import {
  loadState,
  saveState,
  diffFile,
  toStored,
  type StoredEntity,
  type FileSnapshot,
} from "./state.js";
import { appendEvents } from "../store/jsonl.js";

export interface ScanSummary {
  files: number;
  entities: number;
  edges: number;
  events: number;
  ms: number;
}

// full-repo baseline: one batch, source "scan", turn null. re-scan diffs against
// state.json so it only emits changes — plus a fresh observed for every entity in
// every scanned file (open-decision 2: observation is the freshness refresh).
export async function scanRepo(repoRoot: string): Promise<ScanSummary> {
  const t0 = Date.now();
  const listed = gitListFiles(repoRoot);
  if (listed == null) throw new Error(`codemap scan: ${repoRoot} is not a git repo`);
  const files = listed.filter(
    (rel) => isSourceExt(rel) && !rel.startsWith(".codemap/") && existsSync(join(repoRoot, rel)),
  );

  const codemapDir = join(repoRoot, ".codemap");
  mkdirSync(codemapDir, { recursive: true });
  const ctx: EventCtx = {
    session_id: null,
    turn_id: null,
    branch: gitBranch(repoRoot),
    commit: gitCommit(repoRoot),
    source: "scan",
  };

  const state = loadState(codemapDir);
  const events: Record<string, unknown>[] = [];
  const scanned = new Set<string>();
  let entityCount = 0;

  for (const rel of files) {
    let source: string;
    try {
      source = readFileSync(join(repoRoot, rel), "utf8");
    } catch {
      continue;
    }
    const fx = await extractFile(rel, source);
    if (!fx) continue;
    scanned.add(rel);

    const importTargets = resolveImports(repoRoot, rel, fx.imports);
    const importEdges: ExtractEdge[] = importTargets.map((t) => ({ from: rel, to: t, type: "imports" }));
    const nextEntities: Record<string, StoredEntity> = {};
    for (const e of fx.entities) nextEntities[e.id] = toStored(e);
    const nextEdges = [...fx.defines, ...importEdges];

    for (const e of fx.entities) events.push(entityObserved(ctx, toShape(e)));
    entityCount += fx.entities.length;

    // same split as stop: references belong to the pass below
    const old = state.files[rel];
    const oldSansRefs = old ? { ...old, edges: old.edges.filter((e) => e.type !== "references") } : undefined;
    const d = diffFile(oldSansRefs, { entities: nextEntities, edges: nextEdges });
    for (const e of d.added) events.push(entityChanged(ctx, "added", e.id, e.loc));
    for (const m of d.modified) events.push(entityChanged(ctx, "modified", m.entity.id, m.deltaLoc));
    for (const e of d.removed) events.push(entityChanged(ctx, "removed", e.id, -e.loc));
    for (const edge of d.edgesAdded) events.push(edgeChanged(ctx, "added", edge));
    for (const edge of d.edgesRemoved) events.push(edgeChanged(ctx, "removed", edge));

    const keptRefs = old?.edges.filter((e) => e.type === "references") ?? [];
    const snap: FileSnapshot = { entities: nextEntities, edges: [...nextEdges, ...keptRefs] };
    if (fx.declaredTypes.length) snap.declaredTypes = fx.declaredTypes;
    if (fx.typeRefs.length) snap.typeRefs = fx.typeRefs;
    state.files[rel] = snap;
  }

  // files known to state but gone from the repo
  for (const rel of Object.keys(state.files)) {
    if (scanned.has(rel)) continue;
    const old = state.files[rel];
    for (const e of Object.values(old.entities)) events.push(entityChanged(ctx, "removed", e.id, -e.loc));
    for (const edge of old.edges) events.push(edgeChanged(ctx, "removed", edge));
    delete state.files[rel];
  }

  applyReferencePass(state, ctx, events);

  appendEvents(codemapDir, events);
  saveState(codemapDir, state);

  let edgeCount = 0;
  for (const rel of Object.keys(state.files)) edgeCount += state.files[rel].edges.length;
  return { files: scanned.size, entities: entityCount, edges: edgeCount, events: events.length, ms: Date.now() - t0 };
}

// cli entry: codemap scan [--repo <path>] — human-invoked, stdout is fine
export async function runScan(repoArg?: string): Promise<void> {
  const repoRoot = resolveRepoRoot(repoArg ? resolve(repoArg) : process.cwd());
  const s = await scanRepo(repoRoot);
  console.log(`scan: ${s.files} files, ${s.entities} entities, ${s.edges} edges, ${s.ms} ms (${s.events} events)`);
}
