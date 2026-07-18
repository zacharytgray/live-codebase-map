import { test } from "node:test";
import assert from "node:assert/strict";
import dagre from "@dagrejs/dagre";
import { buildGraphData, layoutGraph, isTestPath, AGGREGATE_THRESHOLD } from "../dist/view/graph.js";

const files = [
  { id: "src/b.ts", path: "src/b.ts", loc: 40, seq: 2 },
  { id: "src/a.ts", path: "src/a.ts", loc: 120, seq: 0 },
  { id: "lib/c.py", path: "lib/c.py", loc: 10, seq: -1 },
  { id: "lone.ts", path: "lone.ts", loc: 5, seq: -1 },
];

const edges = [
  { from: "src/b.ts", to: "src/a.ts", type: "imports" },
  { from: "lib/c.py", to: "src/a.ts", type: "references" },
  { from: "src/a.ts", to: "src/a.ts#foo", type: "defines" }, // must never render
];

test("graph data: imports + references only, defines never, canonical node order", () => {
  const data = buildGraphData(files, edges);
  assert.deepEqual(
    data.nodes.map((n) => n.id),
    ["lib/c.py", "lone.ts", "src/a.ts", "src/b.ts"],
  );
  const kinds = data.edges.flatMap((e) => e.types);
  assert.ok(!kinds.includes("defines"));
  assert.deepEqual(
    data.edges.map((e) => `${e.from} -> ${e.to}`).sort(),
    ["lib/c.py -> src/a.ts", "src/b.ts -> src/a.ts"],
  );
  // area tracks loc within the clamped range
  const a = data.nodes.find((n) => n.id === "src/a.ts");
  const c = data.nodes.find((n) => n.id === "lib/c.py");
  assert.ok(a.w * a.h > c.w * c.h);
});

test("graph layout: deterministic — same state, same picture", () => {
  const one = layoutGraph(dagre, buildGraphData(files, edges));
  const two = layoutGraph(dagre, buildGraphData(files, edges));
  assert.deepEqual(JSON.parse(JSON.stringify(one)), JSON.parse(JSON.stringify(two)));
});

test("graph layout: disconnected nodes park in a grid below the dag", () => {
  const layout = layoutGraph(dagre, buildGraphData(files, edges));
  const lone = layout.nodes.find((n) => n.id === "lone.ts");
  const connectedMaxY = Math.max(
    ...layout.nodes.filter((n) => n.id !== "lone.ts").map((n) => n.y + n.h / 2),
  );
  assert.ok(lone.y - lone.h / 2 > connectedMaxY, "isolated node sits below the layout");
  // every node got a position
  for (const n of layout.nodes) {
    assert.ok(Number.isFinite(n.x) && Number.isFinite(n.y), n.id);
  }
});

test("test-path heuristic: segments and basenames, case-insensitive", () => {
  for (const p of [
    "HyprMacTests/BSPNodeTests.swift",
    "tests/helpers.py",
    "src/Test/foo.ts",
    "spec/widget.rb",
    "src/util.test.ts",
    "src/util.spec.ts",
    "tools/space-test.swift",
  ]) {
    assert.equal(isTestPath(p), true, p);
  }
  for (const p of [
    "src/contest.ts", // "test" inside a word is not a test
    "HyprMac/Core/WindowManager.swift",
    "src/latest.ts",
    "protest/notes.md",
  ]) {
    assert.equal(isTestPath(p), false, p);
  }
});

test("graph data: hides test files by default, toggle brings them back", () => {
  const withTests = [
    ...files,
    { id: "tests/a.test.ts", path: "tests/a.test.ts", loc: 30, seq: -1 },
  ];
  const testEdge = { from: "tests/a.test.ts", to: "src/a.ts", type: "references" };

  const hidden = buildGraphData(withTests, [...edges, testEdge]);
  assert.ok(!hidden.nodes.some((n) => n.id === "tests/a.test.ts"));
  assert.equal(hidden.hiddenTests, 1);
  assert.ok(!hidden.edges.some((e) => e.from === "tests/a.test.ts"), "edges from hidden files drop too");

  const shown = buildGraphData(withTests, [...edges, testEdge], { hideTests: false });
  assert.ok(shown.nodes.some((n) => n.id === "tests/a.test.ts"));
  assert.equal(shown.hiddenTests, 0);
  assert.ok(shown.edges.some((e) => e.from === "tests/a.test.ts"));
});

test("graph data: >150 files aggregates to directory nodes, expand overrides", () => {
  const many = [];
  for (let i = 0; i < AGGREGATE_THRESHOLD + 10; i++) {
    many.push({ id: `pkg${i % 4}/f${i}.ts`, path: `pkg${i % 4}/f${i}.ts`, loc: 10, seq: -1 });
  }
  const manyEdges = [{ from: "pkg0/f0.ts", to: "pkg1/f1.ts", type: "imports" }];

  const agg = buildGraphData(many, manyEdges);
  assert.equal(agg.aggregated, true);
  assert.deepEqual(agg.nodes.map((n) => n.id), ["pkg0", "pkg1", "pkg2", "pkg3"]);
  assert.deepEqual(agg.edges.map((e) => `${e.from} -> ${e.to}`), ["pkg0 -> pkg1"]);
  assert.equal(agg.nodes[0].files, 40);

  const flat = buildGraphData(many, manyEdges, { aggregate: false });
  assert.equal(flat.aggregated, false);
  assert.equal(flat.nodes.length, many.length);

  // same-dir edges vanish in aggregated mode
  const intra = buildGraphData(many, [{ from: "pkg0/f0.ts", to: "pkg0/f4.ts", type: "imports" }]);
  assert.deepEqual(intra.edges, []);
});
