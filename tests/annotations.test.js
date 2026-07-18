import { test } from "node:test";
import assert from "node:assert/strict";
import { buildAnnotations } from "../dist/capture/annotations.js";

const ctx = { session_id: "s", turn_id: 1, branch: "main", commit: "abc123" };
const changed = ["src/payments/stripe.ts", "src/util.ts"];

function ofOrigin(events, origin) {
  return events.filter((e) => e.origin === origin);
}

test("MAP: note with target hint resolves against changed files", () => {
  const msg = "MAP: stripe -> added a retry wrapper";
  const events = buildAnnotations(ctx, msg, changed);
  const notes = ofOrigin(events, "map-note");
  assert.equal(notes.length, 1);
  assert.equal(notes[0].text, "added a retry wrapper");
  assert.deepEqual(notes[0].targets, ["src/payments/stripe.ts"]);
  assert.equal(notes[0].confidence, "stated");
});

test("MAP: note without hint targets all changed files", () => {
  const events = buildAnnotations(ctx, "MAP: touched a few things", changed);
  const notes = ofOrigin(events, "map-note");
  assert.equal(notes.length, 1);
  assert.equal(notes[0].text, "touched a few things");
  assert.deepEqual(notes[0].targets, changed);
});

test("hint matching nothing falls back to all changed files", () => {
  const events = buildAnnotations(ctx, "MAP: nonexistent -> note", changed);
  const notes = ofOrigin(events, "map-note");
  assert.deepEqual(notes[0].targets, changed);
  assert.equal(notes[0].text, "note");
});

test("multiple MAP: lines each become an annotation", () => {
  const msg = "MAP: util -> fixed a bug\nsome prose\nMAP: stripe -> retry logic";
  const events = buildAnnotations(ctx, msg, changed);
  const notes = ofOrigin(events, "map-note");
  assert.equal(notes.length, 2);
  assert.deepEqual(notes[0].targets, ["src/util.ts"]);
  assert.deepEqual(notes[1].targets, ["src/payments/stripe.ts"]);
});

test("turn-text is emitted, strips MAP lines and code fences", () => {
  const msg = "I refactored the client.\nMAP: stripe -> retry\n```ts\nconst x = 1;\n```\nDone.";
  const events = buildAnnotations(ctx, msg, changed);
  const tt = ofOrigin(events, "turn-text");
  assert.equal(tt.length, 1);
  assert.equal(tt[0].confidence, "inferred");
  assert.deepEqual(tt[0].targets, changed);
  assert.ok(!tt[0].text.includes("MAP:"));
  assert.ok(!tt[0].text.includes("const x"));
  assert.ok(tt[0].text.includes("refactored the client"));
});

test("turn-text caps at ~300 chars", () => {
  const long = "word ".repeat(200);
  const events = buildAnnotations(ctx, long, changed);
  const tt = ofOrigin(events, "turn-text");
  assert.ok(tt[0].text.length <= 300);
});

test("empty message emits no annotations", () => {
  assert.equal(buildAnnotations(ctx, "", changed).length, 0);
});
