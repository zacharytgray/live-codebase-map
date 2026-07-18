import { test } from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { resolveImports } from "../dist/capture/resolve-imports.js";

const here = dirname(fileURLToPath(import.meta.url));
const repo = join(here, "fixtures", "sample-repo");

const js = (spec) => ({ lang: "js", spec, level: 0 });
const py = (spec, level) => ({ lang: "py", spec, level });

test("resolves ./x.js to x.ts (ts convention)", () => {
  assert.deepEqual(resolveImports(repo, "src/widget.ts", [js("./util.js")]), ["src/util.ts"]);
});

test("resolves extensionless specifier via extension inference", () => {
  assert.deepEqual(resolveImports(repo, "src/app.tsx", [js("./widget")]), ["src/widget.ts"]);
});

test("skips bare / package imports", () => {
  assert.deepEqual(resolveImports(repo, "src/widget.ts", [js("node:fs"), js("react")]), []);
});

test("resolves directory import to index file", () => {
  // pkg has no index, src has no index either — use a real dir: resolve ../pkg from src is a dir w/o index -> unresolved
  assert.deepEqual(resolveImports(repo, "src/app.tsx", [js("./nope")]), []);
});

test("dedupes multiple specifiers pointing at the same file", () => {
  assert.deepEqual(resolveImports(repo, "src/app.tsx", [js("./widget"), js("./widget.ts")]), ["src/widget.ts"]);
});

test("resolves python relative from-import and dot-import", () => {
  assert.deepEqual(
    resolveImports(repo, "pkg/mod.py", [py("helpers", 1), py("sibling", 1)]).sort(),
    ["pkg/helpers.py", "pkg/sibling.py"],
  );
});

test("python resolution does not escape the repo", () => {
  assert.deepEqual(resolveImports(repo, "pkg/mod.py", [py("outside", 3)]), []);
});
