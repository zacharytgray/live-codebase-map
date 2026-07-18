import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { extractFile } from "../dist/capture/extract.js";
import { buildDeclIndex, referencesFor, applyReferencePass } from "../dist/capture/references.js";

const here = dirname(fileURLToPath(import.meta.url));
const repo = join(here, "fixtures", "swift-repo");

function read(rel) {
  return readFileSync(join(repo, rel), "utf8");
}

function byId(fx, id) {
  return fx.entities.find((e) => e.id === id);
}

test("swift: struct/enum/protocol/actor/extension map to class, methods qualify", async () => {
  const fx = await extractFile("Sources/Render.swift", read("Sources/Render.swift"));
  const ids = fx.entities.map((e) => e.id).sort();
  assert.deepEqual(ids, [
    "Sources/Render.swift",
    "Sources/Render.swift#Ambig",
    "Sources/Render.swift#Drawable",
    "Sources/Render.swift#Drawable.draw",
    "Sources/Render.swift#Mode",
    "Sources/Render.swift#Mode.flip",
    "Sources/Render.swift#Renderer",
    "Sources/Render.swift#Renderer.draw",
    "Sources/Render.swift#Renderer.render",
    "Sources/Render.swift#Renderer.reset",
  ].sort());

  // struct/class/enum/protocol all land on the schema's class type
  assert.equal(byId(fx, "Sources/Render.swift#Renderer").type, "class");
  assert.equal(byId(fx, "Sources/Render.swift#Mode").type, "class");
  assert.equal(byId(fx, "Sources/Render.swift#Drawable").type, "class");

  // extension members fold under the extended type's name (Renderer.draw)
  assert.equal(byId(fx, "Sources/Render.swift#Renderer.draw").type, "function");

  // private modifier
  assert.equal(byId(fx, "Sources/Render.swift#Renderer.reset").exported, false);
  assert.equal(byId(fx, "Sources/Render.swift#Renderer.render").exported, true);

  // declared types: extension declares nothing new
  assert.deepEqual(fx.declaredTypes.sort(), ["Ambig", "Drawable", "Mode", "Renderer"]);

  // swift imports emit nothing — references replace them
  assert.equal(fx.imports.length, 0);

  // defines: file -> every symbol
  assert.equal(fx.defines.length, fx.entities.length - 1);
});

test("swift: top-level functions and type usages", async () => {
  const fx = await extractFile("Sources/App.swift", read("Sources/App.swift"));
  assert.equal(byId(fx, "Sources/App.swift#launch").type, "function");
  assert.deepEqual(fx.declaredTypes, ["App"]);
  // usages include annotations, ctor calls, and out-of-repo names (dropped later)
  for (const name of ["Renderer", "Point", "Mode", "Ambig", "App", "URL"]) {
    assert.ok(fx.typeRefs.includes(name), `typeRefs should include ${name}`);
  }
});

test("references: unambiguous cross-file only; ambiguous and same-file skipped", async () => {
  const files = ["Sources/Models.swift", "Sources/Render.swift", "Sources/App.swift"];
  const state = { v: 1, files: {} };
  for (const rel of files) {
    const fx = await extractFile(rel, read(rel));
    state.files[rel] = {
      entities: {},
      edges: [],
      declaredTypes: fx.declaredTypes,
      typeRefs: fx.typeRefs,
    };
  }

  const index = buildDeclIndex(state);
  // Ambig declared in two files -> ambiguous
  assert.equal(index.get("Ambig").length, 2);

  const appRefs = referencesFor("Sources/App.swift", state.files["Sources/App.swift"].typeRefs, index);
  assert.deepEqual(appRefs.map((e) => e.to).sort(), ["Sources/Models.swift", "Sources/Render.swift"]);
  assert.ok(appRefs.every((e) => e.type === "references" && e.from === "Sources/App.swift"));

  // Models uses only its own types -> same-file skip leaves nothing
  const modelRefs = referencesFor("Sources/Models.swift", state.files["Sources/Models.swift"].typeRefs, index);
  assert.deepEqual(modelRefs, []);

  // full pass emits added edges and stores them on each file's snapshot
  const events = [];
  const ctx = { session_id: null, turn_id: null, branch: "main", commit: null, source: "scan" };
  applyReferencePass(state, ctx, events);
  const added = events.filter((e) => e.kind === "edge.changed" && e.change === "added");
  const keys = added.map((e) => `${e.edge.from} -> ${e.edge.to}`).sort();
  assert.deepEqual(keys, [
    "Sources/App.swift -> Sources/Models.swift",
    "Sources/App.swift -> Sources/Render.swift",
    "Sources/Render.swift -> Sources/Models.swift",
  ]);
  assert.equal(state.files["Sources/App.swift"].edges.filter((e) => e.type === "references").length, 2);

  // second pass over the same state is a no-op
  const again = [];
  applyReferencePass(state, ctx, again);
  assert.deepEqual(again, []);
});
