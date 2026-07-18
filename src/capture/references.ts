import type { EventCtx } from "../shared/events.js";
import { edgeChanged } from "../shared/events.js";
import type { State, StoredEdge } from "./state.js";

// cross-file type references, best-effort name matching (schema doc, 2026-07-18).
// a file->file edge is emitted only when the used name is declared in exactly one
// OTHER file — ambiguous and out-of-repo names (Foundation etc.) drop out naturally.

// type name -> declaring files, from the per-file tables persisted in state.json
export function buildDeclIndex(state: State): Map<string, string[]> {
  const index = new Map<string, string[]>();
  for (const rel of Object.keys(state.files).sort()) {
    for (const name of state.files[rel].declaredTypes ?? []) {
      const files = index.get(name);
      if (files) {
        if (!files.includes(rel)) files.push(rel);
      } else {
        index.set(name, [rel]);
      }
    }
  }
  return index;
}

export function referencesFor(rel: string, typeRefs: string[], index: Map<string, string[]>): StoredEdge[] {
  const out: StoredEdge[] = [];
  const targets = new Set<string>();
  for (const name of typeRefs) {
    const files = index.get(name);
    if (!files || files.length !== 1) continue; // undeclared or ambiguous
    if (files[0] === rel) continue; // same-file
    targets.add(files[0]);
  }
  for (const to of [...targets].sort()) out.push({ from: rel, to, type: "references" });
  return out;
}

// recompute references for every file with type usages, diff against the stored
// edges, emit changes, and update state in place. runs after the declared-type
// table is current, so a turn touching one file resolves against the whole repo —
// and a type moving between files fixes up untouched referrers too.
export function applyReferencePass(state: State, ctx: EventCtx, events: Record<string, unknown>[]): void {
  const index = buildDeclIndex(state);
  for (const rel of Object.keys(state.files).sort()) {
    const snap = state.files[rel];
    const want = referencesFor(rel, snap.typeRefs ?? [], index);
    const have = snap.edges.filter((e) => e.type === "references");
    const wantKeys = new Set(want.map((e) => e.to));
    const haveKeys = new Set(have.map((e) => e.to));
    for (const e of want) if (!haveKeys.has(e.to)) events.push(edgeChanged(ctx, "added", e));
    for (const e of have) if (!wantKeys.has(e.to)) events.push(edgeChanged(ctx, "removed", e));
    if (want.length || have.length) {
      snap.edges = [...snap.edges.filter((e) => e.type !== "references"), ...want];
    }
  }
}
