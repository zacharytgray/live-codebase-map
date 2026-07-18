import { test } from "node:test";
import assert from "node:assert/strict";
import { extractFile } from "../dist/capture/extract.js";
import { diffFile, toStored } from "../dist/capture/state.js";

async function snapshot(path, source) {
  const fx = await extractFile(path, source);
  const entities = {};
  for (const e of fx.entities) entities[e.id] = toStored(e);
  return { entities, edges: fx.defines };
}

const V1 = `export function a() { return 1; }
export function b() { return 2; }
`;

const V2 = `export function b() { return 22; }
export function c() { return 3; }
`;

test("first snapshot: everything is added", async () => {
  const next = await snapshot("m.ts", V1);
  const d = diffFile(undefined, next);
  const added = d.added.map((e) => e.id).sort();
  assert.deepEqual(added, ["m.ts", "m.ts#a", "m.ts#b"]);
  assert.equal(d.removed.length, 0);
  assert.equal(d.modified.length, 0);
  // defines edges added for the two functions
  assert.deepEqual(d.edgesAdded.map((e) => e.to).sort(), ["m.ts#a", "m.ts#b"]);
});

test("diff across two snapshots: add / modify / remove entities and edges", async () => {
  const snap1 = await snapshot("m.ts", V1);
  const snap2 = await snapshot("m.ts", V2);
  const d = diffFile({ entities: snap1.entities, edges: snap1.edges }, snap2);

  assert.deepEqual(d.added.map((e) => e.id), ["m.ts#c"]);
  assert.deepEqual(d.removed.map((e) => e.id), ["m.ts#a"]);

  // b changed body (hash) and the file entity changed
  const modIds = d.modified.map((m) => m.entity.id).sort();
  assert.deepEqual(modIds, ["m.ts", "m.ts#b"]);

  // delta_loc is signed relative to prior loc
  const b = d.modified.find((m) => m.entity.id === "m.ts#b");
  assert.equal(typeof b.deltaLoc, "number");

  // edge churn: c defined, a undefined
  assert.deepEqual(d.edgesAdded.map((e) => e.to), ["m.ts#c"]);
  assert.deepEqual(d.edgesRemoved.map((e) => e.to), ["m.ts#a"]);
});

const V1_SHIFTED = `// header comment pushes everything down
export function a() { return 1; }
export function b() { return 2; }
`;

test("pure line shift is not a modification", async () => {
  const snap = await snapshot("m.ts", V1);
  const shifted = await snapshot("m.ts", V1_SHIFTED);
  const d = diffFile({ entities: snap.entities, edges: snap.edges }, shifted);
  // file content changed; the body-identical functions below the insert did not
  assert.deepEqual(d.modified.map((m) => m.entity.id), ["m.ts"]);
  assert.equal(d.added.length, 0);
  assert.equal(d.removed.length, 0);
});

test("identical snapshot yields no changes", async () => {
  const snap = await snapshot("m.ts", V1);
  const again = await snapshot("m.ts", V1);
  const d = diffFile({ entities: snap.entities, edges: snap.edges }, again);
  assert.equal(d.added.length, 0);
  assert.equal(d.removed.length, 0);
  assert.equal(d.modified.length, 0);
  assert.equal(d.edgesAdded.length, 0);
  assert.equal(d.edgesRemoved.length, 0);
});
