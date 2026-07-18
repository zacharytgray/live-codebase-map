import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { extractFile } from "../dist/capture/extract.js";

const here = dirname(fileURLToPath(import.meta.url));
const repo = join(here, "fixtures", "sample-repo");

function read(rel) {
  return readFileSync(join(repo, rel), "utf8");
}

function byId(fx, id) {
  return fx.entities.find((e) => e.id === id);
}

test("extracts functions, arrow-consts, interfaces from a ts file", async () => {
  const fx = await extractFile("src/util.ts", read("src/util.ts"));
  const ids = fx.entities.map((e) => e.id);
  assert.deepEqual(ids.sort(), [
    "src/util.ts",
    "src/util.ts#Point",
    "src/util.ts#add",
    "src/util.ts#internal",
    "src/util.ts#mul",
  ].sort());

  // file entity
  const file = byId(fx, "src/util.ts");
  assert.equal(file.type, "file");
  assert.equal(file.name, "util.ts");
  assert.equal(file.span[0], 1);

  // exported function
  const add = byId(fx, "src/util.ts#add");
  assert.equal(add.type, "function");
  assert.equal(add.exported, true);
  assert.deepEqual(add.span, [1, 3]);
  assert.equal(add.loc, 3);

  // arrow const, exported
  assert.equal(byId(fx, "src/util.ts#mul").type, "function");
  assert.equal(byId(fx, "src/util.ts#mul").exported, true);

  // non-exported arrow const
  assert.equal(byId(fx, "src/util.ts#internal").exported, false);

  // interface mapped to class type
  assert.equal(byId(fx, "src/util.ts#Point").type, "class");
  assert.equal(byId(fx, "src/util.ts#Point").exported, true);
});

test("extracts class + qualified methods and a bare function", async () => {
  const fx = await extractFile("src/widget.ts", read("src/widget.ts"));
  const ids = fx.entities.map((e) => e.id).sort();
  assert.deepEqual(ids, [
    "src/widget.ts",
    "src/widget.ts#Widget",
    "src/widget.ts#Widget.make",
    "src/widget.ts#Widget.render",
    "src/widget.ts#helper",
  ].sort());

  assert.equal(byId(fx, "src/widget.ts#Widget").type, "class");
  assert.equal(byId(fx, "src/widget.ts#Widget.render").type, "function");
  assert.equal(byId(fx, "src/widget.ts#Widget.render").name, "Widget.render");
  // bare top-level fn is not exported
  assert.equal(byId(fx, "src/widget.ts#helper").exported, false);

  // defines edges: file -> every non-file symbol
  const defs = fx.defines.map((e) => e.to).sort();
  assert.deepEqual(defs, [
    "src/widget.ts#Widget",
    "src/widget.ts#Widget.make",
    "src/widget.ts#Widget.render",
    "src/widget.ts#helper",
  ].sort());
  assert.ok(fx.defines.every((e) => e.from === "src/widget.ts" && e.type === "defines"));
});

test("extracts a tsx arrow component", async () => {
  const fx = await extractFile("src/app.tsx", read("src/app.tsx"));
  assert.ok(byId(fx, "src/app.tsx#App"));
  assert.equal(byId(fx, "src/app.tsx#App").type, "function");
});

test("extracts python functions, classes, methods; underscore = private", async () => {
  const fx = await extractFile("pkg/mod.py", read("pkg/mod.py"));
  const ids = fx.entities.map((e) => e.id).sort();
  assert.deepEqual(ids, [
    "pkg/mod.py",
    "pkg/mod.py#Thing",
    "pkg/mod.py#Thing.run",
    "pkg/mod.py#top",
  ].sort());
  assert.equal(byId(fx, "pkg/mod.py#Thing").type, "class");
  assert.equal(byId(fx, "pkg/mod.py#Thing.run").name, "Thing.run");

  const helpers = await extractFile("pkg/helpers.py", read("pkg/helpers.py"));
  assert.equal(byId(helpers, "pkg/helpers.py#thing").exported, true);
  assert.equal(byId(helpers, "pkg/helpers.py#_private").exported, false);
});

test("returns null for unsupported extensions", async () => {
  const fx = await extractFile("README.md", "# hi");
  assert.equal(fx, null);
});
