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
}

export interface DerivedEntity extends EntityShape {
  lastTouchedSeq: number; // turn ordinal that last touched it (for glow distance)
  lastTouchedTs: string;
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
        entities.set(e.id, { ...e, lastTouchedSeq: seq, lastTouchedTs: ts });
        break;
      }
      case "entity.changed": {
        const id = ev.entity_id;
        if (!id) break;
        if (ev.change === "removed") {
          entities.delete(id);
        } else {
          const cur = entities.get(id);
          if (cur) {
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
