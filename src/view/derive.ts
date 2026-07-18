// derive map state by replaying events.jsonl in memory (no sqlite — CLAUDE.md decision).
// pure: takes parsed events, returns the derived state the view renders. server-only.

import type { EntityShape } from "../shared/events.js";

export interface RawEvent {
  v?: number;
  id?: string;
  ts?: string;
  source?: string;
  turn?: { session_id: string; turn_id: number } | null;
  branch?: string | null;
  commit?: string | null;
  kind?: string;
  entity?: EntityShape;
  change?: string;
  entity_id?: string;
  delta_loc?: number;
  edge?: { from: string; to: string; type: string };
  targets?: string[];
  text?: string;
  origin?: string;
  confidence?: string;
  model?: string;
}

// latest llm-summary for a file, surfaced on the file entity (ABOUT section + tooltip)
export interface FileSummary {
  text: string;
  model: string | null;
  commit: string | null;
  ts: string;
}

export interface DerivedEntity extends EntityShape {
  lastTouchedSeq: number; // turn ordinal that last touched it (for glow distance)
  lastTouchedTs: string;
  summary?: FileSummary; // file entities only, when a summary exists
}

export interface DerivedEdge {
  from: string;
  to: string;
  type: string;
}

export interface TurnMeta {
  key: string; // session_id/turn_id
  session_id: string;
  turn_id: number;
  seq: number; // 0-based appearance order == time order
  ts: string; // max ts seen in the turn
  branch: string | null;
  commit: string | null;
}

export interface EntityChange {
  change: "added" | "modified" | "removed";
  entity_id: string;
  path: string;
  name: string;
  delta_loc: number;
}

export interface EdgeChange {
  change: string; // added | removed
  from: string;
  to: string;
  type: string;
}

export interface AnnotationView {
  text: string;
  origin: string;
  targets: string[];
}

export interface AnnotationRecord extends AnnotationView {
  session_id: string | null;
  turn_id: number | null;
  commit: string | null;
  ts: string;
  seq: number;
  model: string | null; // only set for llm-summary
}

export interface Claim {
  best: { text: string; origin: string } | null;
  mapNote: { text: string; targets: string[] } | null;
  turnText: { text: string; targets: string[] } | null;
}

export interface TurnDelta {
  turn: TurnMeta;
  claim: Claim;
  annotations: AnnotationView[];
  entityChanges: EntityChange[];
  edgeChanges: EdgeChange[];
  touchedFiles: string[];
}

export interface DerivedState {
  generatedAt: string;
  eventCount: number;
  empty: boolean;
  turns: TurnMeta[];
  latestTurn: TurnDelta | null;
  entities: DerivedEntity[];
  edges: DerivedEdge[];
  annotations: AnnotationRecord[];
}

function turnKey(t: { session_id: string; turn_id: number }): string {
  return `${t.session_id}/${t.turn_id}`;
}

// id is `path` (file) or `path#qualified_name` (symbol)
function splitId(id: string): { path: string; name: string } {
  const h = id.indexOf("#");
  if (h === -1) return { path: id, name: id.split("/").pop() ?? id };
  return { path: id.slice(0, h), name: id.slice(h + 1) };
}

// best annotation for a turn: a deliberate MAP: note outranks a turn-text scrape.
export function selectClaim(annotations: AnnotationView[]): Claim {
  const mapNote = annotations.find((a) => a.origin === "map-note") ?? null;
  const turnText = annotations.find((a) => a.origin === "turn-text") ?? null;
  const best = mapNote
    ? { text: mapNote.text, origin: "map-note" }
    : turnText
      ? { text: turnText.text, origin: "turn-text" }
      : null;
  return {
    best,
    mapNote: mapNote ? { text: mapNote.text, targets: mapNote.targets } : null,
    turnText: turnText ? { text: turnText.text, targets: turnText.targets } : null,
  };
}

export function derive(events: RawEvent[], now: Date = new Date()): DerivedState {
  const entities = new Map<string, DerivedEntity>();
  const edges = new Map<string, DerivedEdge>();
  const turnMeta = new Map<string, TurnMeta>();
  const turnOrder: string[] = [];
  const annotations: AnnotationRecord[] = [];
  let realEvents = 0;

  for (const ev of events) {
    if (!ev || typeof ev !== "object" || !ev.kind) continue;
    realEvents++;
    const ts = ev.ts ?? "";

    let seq = -1;
    if (ev.turn) {
      const key = turnKey(ev.turn);
      let meta = turnMeta.get(key);
      if (!meta) {
        meta = {
          key,
          session_id: ev.turn.session_id,
          turn_id: ev.turn.turn_id,
          seq: turnOrder.length,
          ts,
          branch: ev.branch ?? null,
          commit: ev.commit ?? null,
        };
        turnMeta.set(key, meta);
        turnOrder.push(key);
      } else if (ts > meta.ts) {
        meta.ts = ts; // max ts across the turn
      }
      seq = meta.seq;
    }

    switch (ev.kind) {
      case "entity.observed": {
        const e = ev.entity;
        if (!e) break;
        // scan events (turn null, seq -1) render neutral: refresh the shape but
        // never grant recency — and never erase recency a real turn already gave
        const prev = entities.get(e.id);
        if (seq < 0 && prev) {
          entities.set(e.id, { ...e, lastTouchedSeq: prev.lastTouchedSeq, lastTouchedTs: prev.lastTouchedTs });
        } else {
          entities.set(e.id, { ...e, lastTouchedSeq: seq, lastTouchedTs: ts });
        }
        break;
      }
      case "entity.changed": {
        const id = ev.entity_id;
        if (!id) break;
        if (ev.change === "removed") {
          entities.delete(id);
        } else {
          const cur = entities.get(id);
          if (cur && seq >= 0) {
            cur.lastTouchedSeq = seq;
            cur.lastTouchedTs = ts;
          }
        }
        break;
      }
      case "edge.changed": {
        const e = ev.edge;
        if (!e) break;
        const k = `${e.from}|${e.to}|${e.type}`;
        if (ev.change === "added") edges.set(k, { from: e.from, to: e.to, type: e.type });
        else edges.delete(k);
        break;
      }
      case "annotation": {
        annotations.push({
          text: ev.text ?? "",
          origin: ev.origin ?? "unknown",
          targets: ev.targets ?? [],
          session_id: ev.turn?.session_id ?? null,
          turn_id: ev.turn?.turn_id ?? null,
          commit: ev.commit ?? null,
          ts,
          seq,
          model: ev.model ?? null,
        });
        break;
      }
    }
  }

  const turns = turnOrder.map((k) => turnMeta.get(k)!);

  // latest turn = max by ts, tie-break by appearance order
  let latest: TurnMeta | null = null;
  for (const m of turns) {
    if (!latest || m.ts > latest.ts || (m.ts === latest.ts && m.seq > latest.seq)) latest = m;
  }

  const latestTurn = latest ? buildTurnDelta(events, latest, annotations) : null;

  // latest llm-summary per file wins (last appearance, ts tiebreak) -> file entity
  const summaryByPath = new Map<string, { rec: FileSummary; ts: string; idx: number }>();
  annotations.forEach((a, idx) => {
    if (a.origin !== "llm-summary") return;
    for (const t of a.targets) {
      const cur = summaryByPath.get(t);
      if (!cur || a.ts > cur.ts || (a.ts === cur.ts && idx > cur.idx)) {
        summaryByPath.set(t, { rec: { text: a.text, model: a.model, commit: a.commit, ts: a.ts }, ts: a.ts, idx });
      }
    }
  });
  for (const e of entities.values()) {
    if (e.type !== "file") continue;
    const s = summaryByPath.get(e.path);
    if (s) e.summary = s.rec;
  }

  return {
    generatedAt: now.toISOString(),
    eventCount: realEvents,
    empty: realEvents === 0,
    turns,
    latestTurn,
    entities: [...entities.values()],
    edges: [...edges.values()],
    annotations,
  };
}

function buildTurnDelta(events: RawEvent[], meta: TurnMeta, annotations: AnnotationRecord[]): TurnDelta {
  const entityChanges: EntityChange[] = [];
  const edgeChanges: EdgeChange[] = [];
  const touched = new Set<string>();

  for (const ev of events) {
    if (!ev || !ev.turn || turnKey(ev.turn) !== meta.key) continue;
    if (ev.kind === "entity.observed" && ev.entity) {
      touched.add(ev.entity.path);
    } else if (ev.kind === "entity.changed" && ev.entity_id) {
      const { path, name } = splitId(ev.entity_id);
      touched.add(path);
      if (ev.change === "added" || ev.change === "modified" || ev.change === "removed") {
        entityChanges.push({ change: ev.change, entity_id: ev.entity_id, path, name, delta_loc: ev.delta_loc ?? 0 });
      }
    } else if (ev.kind === "edge.changed" && ev.edge) {
      edgeChanges.push({ change: ev.change ?? "", from: ev.edge.from, to: ev.edge.to, type: ev.edge.type });
    }
  }

  const turnAnnos: AnnotationView[] = annotations
    .filter((a) => a.session_id === meta.session_id && a.turn_id === meta.turn_id)
    .map((a) => ({ text: a.text, origin: a.origin, targets: a.targets }));

  return {
    turn: meta,
    claim: selectClaim(turnAnnos),
    annotations: turnAnnos,
    entityChanges,
    edgeChanges,
    touchedFiles: [...touched].sort(),
  };
}

// ---- staleness selection for `codemap summarize` (Layer-3 consolidation) ----

export interface StaleFile {
  path: string;
  loc: number;
  reason: "no-summary" | "changes" | "delta";
  changesSince: number; // entity.changed events since the latest llm-summary
  deltaSince: number; // cumulative |delta_loc| since the latest llm-summary
}

interface FileAcc {
  loc: number;
  exists: boolean;
  hasSummary: boolean;
  changesSince: number;
  deltaSince: number;
}

// pure: a file is stale if it has no summary, OR >=3 entity.changed events since
// its latest summary, OR cumulative |delta_loc| since >= 30% of current loc.
// stale-first order (no-summary first, then furthest over threshold), capped at limit.
export function selectStaleFiles(events: RawEvent[], limit = 100): StaleFile[] {
  const files = new Map<string, FileAcc>();
  const ensure = (p: string): FileAcc => {
    let f = files.get(p);
    if (!f) files.set(p, (f = { loc: 0, exists: false, hasSummary: false, changesSince: 0, deltaSince: 0 }));
    return f;
  };

  for (const ev of events) {
    if (!ev || !ev.kind) continue;
    if (ev.kind === "entity.observed" && ev.entity) {
      if (ev.entity.type === "file") {
        const f = ensure(ev.entity.path);
        f.loc = ev.entity.loc;
        f.exists = true;
      }
    } else if (ev.kind === "entity.changed" && ev.entity_id) {
      const { path } = splitId(ev.entity_id);
      const f = ensure(path);
      f.changesSince += 1;
      f.deltaSince += Math.abs(ev.delta_loc ?? 0);
      if (ev.change === "removed" && ev.entity_id === path) f.exists = false; // file entity gone
    } else if (ev.kind === "annotation" && ev.origin === "llm-summary") {
      for (const t of ev.targets ?? []) {
        const f = ensure(t);
        f.hasSummary = true;
        f.changesSince = 0;
        f.deltaSince = 0;
      }
    }
  }

  const out: (StaleFile & { score: number; noSummary: boolean })[] = [];
  for (const [path, f] of files) {
    if (!f.exists) continue;
    const noSummary = !f.hasSummary;
    const changeTrigger = f.changesSince >= 3;
    const deltaTrigger = f.loc > 0 && f.deltaSince >= 0.3 * f.loc;
    if (!noSummary && !changeTrigger && !deltaTrigger) continue;
    const reason = noSummary ? "no-summary" : changeTrigger ? "changes" : "delta";
    const score = noSummary ? Infinity : Math.max(f.changesSince / 3, f.loc > 0 ? f.deltaSince / (0.3 * f.loc) : 0);
    out.push({ path, loc: f.loc, reason, changesSince: f.changesSince, deltaSince: f.deltaSince, score, noSummary });
  }

  out.sort((a, b) => {
    if (a.noSummary !== b.noSummary) return a.noSummary ? -1 : 1;
    if (b.score !== a.score) return b.score - a.score; // Infinity==Infinity falls through
    return a.path < b.path ? -1 : 1;
  });

  return out.slice(0, Math.max(0, limit)).map(({ path, loc, reason, changesSince, deltaSince }) => ({
    path,
    loc,
    reason,
    changesSince,
    deltaSince,
  }));
}
