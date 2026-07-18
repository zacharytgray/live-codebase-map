import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join, dirname } from "node:path";
import { derive, selectClaim } from "../dist/view/derive.js";
import { glow, DECAY_TURNS } from "../dist/view/decay.js";
import { buildHierarchy } from "../dist/view/hierarchy.js";

const here = dirname(fileURLToPath(import.meta.url));

function loadFixture() {
  const raw = readFileSync(join(here, "fixtures", "view-events.jsonl"), "utf8");
  return raw.split("\n").filter((l) => l.trim()).map((l) => JSON.parse(l));
}

test("replay: entities = last observed minus removed, edges folded in order", () => {
  const state = derive(loadFixture());
  const ids = state.entities.map((e) => e.id).sort();
  // bar was added in turn 1 and removed in turn 2 -> gone
  assert.deepEqual(ids, ["src/a.ts", "src/a.ts#baz", "src/a.ts#foo", "src/b.ts", "src/b.ts#run"]);

  // loc reflects the latest observed shape
  assert.equal(state.entities.find((e) => e.id === "src/b.ts").loc, 12);
  assert.equal(state.entities.find((e) => e.id === "src/a.ts").loc, 24);

  // edges: defines a->foo, a->baz, b->run survive; a->bar removed; imports b->a added then removed
  const edgeKeys = state.edges.map((e) => `${e.from}|${e.to}|${e.type}`).sort();
  assert.deepEqual(edgeKeys, [
    "src/a.ts|src/a.ts#baz|defines",
    "src/a.ts|src/a.ts#foo|defines",
    "src/b.ts|src/b.ts#run|defines",
  ]);
});

test("replay: turn ordering + latest-turn delta", () => {
  const state = derive(loadFixture());
  assert.equal(state.turns.length, 3);
  assert.deepEqual(state.turns.map((t) => t.seq), [0, 1, 2]);

  const latest = state.latestTurn;
  assert.equal(latest.turn.turn_id, 3);
  assert.equal(latest.turn.commit, "c3ccccc");
  // best claim prefers the map-note
  assert.equal(latest.claim.best.origin, "map-note");
  assert.equal(latest.claim.best.text, "b no longer depends on a");
  // both origins are surfaced for the comparison
  assert.ok(latest.claim.mapNote);
  assert.ok(latest.claim.turnText);
  assert.equal(latest.claim.turnText.text, "decoupled b from a");

  // what actually changed this turn
  const changes = latest.entityChanges.map((c) => `${c.change}:${c.entity_id}:${c.delta_loc}`).sort();
  assert.deepEqual(changes, ["modified:src/b.ts#run:2", "modified:src/b.ts:2"]);
  assert.deepEqual(latest.edgeChanges, [{ change: "removed", from: "src/b.ts", to: "src/a.ts", type: "imports" }]);
  assert.deepEqual(latest.touchedFiles, ["src/b.ts"]);
});

test("replay: per-entity last_touched turn seq drives glow distance", () => {
  const state = derive(loadFixture());
  const seq = (id) => state.entities.find((e) => e.id === id).lastTouchedSeq;
  // b touched last in turn 3 (seq 2); a family last touched in turn 2 (seq 1)
  assert.equal(seq("src/b.ts"), 2);
  assert.equal(seq("src/b.ts#run"), 2);
  assert.equal(seq("src/a.ts"), 1);
  assert.equal(seq("src/a.ts#foo"), 1);
  assert.equal(seq("src/a.ts#baz"), 1);
});

test("empty log -> empty state", () => {
  const state = derive([]);
  assert.equal(state.empty, true);
  assert.equal(state.latestTurn, null);
  assert.deepEqual(state.entities, []);
});

test("decay: strongest at distance 0, linear to zero at N", () => {
  assert.equal(glow(0), 1);
  assert.equal(glow(4, 8), 0.5);
  assert.equal(glow(1, 8), 0.875);
  assert.equal(glow(DECAY_TURNS), 0);
  assert.equal(glow(DECAY_TURNS + 1), 0);
  assert.equal(glow(-1), 0);
});

test("claim selection prefers map-note over turn-text", () => {
  const both = selectClaim([
    { text: "scraped intent", origin: "turn-text", targets: ["x"] },
    { text: "deliberate note", origin: "map-note", targets: ["x"] },
  ]);
  assert.equal(both.best.origin, "map-note");
  assert.equal(both.best.text, "deliberate note");

  const only = selectClaim([{ text: "scraped only", origin: "turn-text", targets: ["x"] }]);
  assert.equal(only.best.origin, "turn-text");
  assert.equal(only.mapNote, null);

  assert.equal(selectClaim([]).best, null);
});

test("hierarchy: path-sorted, stable under sibling growth (never size-ordered)", () => {
  const base = buildHierarchy([
    { id: "a.ts", path: "a.ts", loc: 1 },
    { id: "m.ts", path: "m.ts", loc: 5 },
    { id: "z.ts", path: "z.ts", loc: 999 }, // huge, but must stay last by path
  ]);
  assert.deepEqual(base.children.map((c) => c.name), ["a.ts", "m.ts", "z.ts"]);

  // add a new sibling; existing files keep their relative order, new one slots in by path
  const grown = buildHierarchy([
    { id: "a.ts", path: "a.ts", loc: 1 },
    { id: "aa.ts", path: "aa.ts", loc: 500 },
    { id: "m.ts", path: "m.ts", loc: 5 },
    { id: "z.ts", path: "z.ts", loc: 999 },
  ]);
  assert.deepEqual(grown.children.map((c) => c.name), ["a.ts", "aa.ts", "m.ts", "z.ts"]);

  // nested dirs sort by path too
  const nested = buildHierarchy([
    { id: "src/b.ts", path: "src/b.ts", loc: 3 },
    { id: "src/a.ts", path: "src/a.ts", loc: 3 },
    { id: "pkg/x.py", path: "pkg/x.py", loc: 3 },
  ]);
  assert.deepEqual(nested.children.map((c) => c.name), ["pkg", "src"]);
  const src = nested.children.find((c) => c.name === "src");
  assert.deepEqual(src.children.map((c) => c.name), ["a.ts", "b.ts"]);
});
