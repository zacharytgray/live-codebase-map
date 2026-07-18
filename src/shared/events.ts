// event types + envelope builder. mirrors docs/event-schema.md (frozen v1).

export type EntityType = "module" | "file" | "class" | "function";
export type EdgeType = "imports" | "calls" | "defines";
export type EventKind = "entity.observed" | "entity.changed" | "edge.changed" | "annotation";

export interface Turn {
  session_id: string;
  turn_id: number;
}

// the entity object as it appears inside entity.observed (no exported/hash — those stay internal)
export interface EntityShape {
  id: string;
  type: EntityType;
  path: string;
  name: string;
  span: [number, number];
  loc: number;
}

export interface Edge {
  from: string;
  to: string;
  type: EdgeType;
}

export interface EventCtx {
  session_id: string;
  turn_id: number;
  branch: string | null;
  commit: string | null;
}

// crockford base32, for ulid-style sortable ids
const B32 = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

export function genId(): string {
  let t = Date.now();
  let time = "";
  for (let i = 9; i >= 0; i--) {
    time = B32[t % 32] + time;
    t = Math.floor(t / 32);
  }
  let rand = "";
  for (let i = 0; i < 16; i++) rand += B32[Math.floor(Math.random() * 32)];
  return "evt_" + time + rand;
}

// schema shows second-precision utc, no millis
export function isoSeconds(d = new Date()): string {
  return d.toISOString().replace(/\.\d{3}Z$/, "Z");
}

export function makeEvent(
  ctx: EventCtx,
  kind: EventKind,
  fields: Record<string, unknown>,
): Record<string, unknown> {
  return {
    v: 0,
    id: genId(),
    ts: isoSeconds(),
    source: "agent-hook",
    turn: { session_id: ctx.session_id, turn_id: ctx.turn_id },
    branch: ctx.branch,
    commit: ctx.commit,
    kind,
    ...fields,
  };
}

export function entityObserved(ctx: EventCtx, entity: EntityShape) {
  return makeEvent(ctx, "entity.observed", { entity });
}

export function entityChanged(
  ctx: EventCtx,
  change: "added" | "modified" | "removed" | "renamed",
  entity_id: string,
  delta_loc: number,
  prev_id?: string,
) {
  const fields: Record<string, unknown> = { change, entity_id, delta_loc };
  if (prev_id) fields.prev_id = prev_id;
  return makeEvent(ctx, "entity.changed", fields);
}

export function edgeChanged(ctx: EventCtx, change: "added" | "removed", edge: Edge) {
  return makeEvent(ctx, "edge.changed", {
    change,
    edge: { from: edge.from, to: edge.to, type: edge.type },
  });
}

export function annotation(
  ctx: EventCtx,
  targets: string[],
  text: string,
  origin: "map-note" | "turn-text" | "commit-msg",
  confidence: "stated" | "inferred",
) {
  return makeEvent(ctx, "annotation", { targets, text, origin, confidence });
}
