// graph-view data + dagre layout. pure; dagre is passed in (the page has it as a
// UMD global) — this same compiled file is served to the page (one implementation).
//
// determinism (invariant 3): nodes are fed to dagre in canonical path order and
// edges in (from,to) order, so the same derived state always yields the same
// picture. recency never affects position — it rides on a stroke overlay.

export interface GraphFile {
  id: string;
  path: string;
  loc: number;
  seq: number; // last-touched turn seq, -1 = never touched by a real turn
}

export interface DepEdge {
  from: string;
  to: string;
  type: string;
}

export interface GraphNode {
  id: string; // file path, or directory path when aggregated
  label: string;
  group: string; // color group: top-level dir, or second-level when the repo has one root package
  loc: number;
  seq: number;
  files: number; // members when aggregated, else 1
  w: number;
  h: number;
}

export interface GraphEdge {
  from: string;
  to: string;
  types: string[]; // imports | references (deduped file pairs can carry both)
}

export interface GraphData {
  nodes: GraphNode[];
  edges: GraphEdge[];
  aggregated: boolean;
  fileCount: number;
  hiddenTests: number; // files dropped by the hide-tests filter
}

// file->file dependency edges only. defines is file->own-symbol noise — never rendered.
const DEP_TYPES = new Set(["imports", "references"]);

export const AGGREGATE_THRESHOLD = 150;

// test/tooling files shred the layout (every test references source types).
// hidden by default; the toggle brings them back.
export function isTestPath(path: string): boolean {
  const parts = path.toLowerCase().split("/");
  const base = parts[parts.length - 1];
  if (parts.slice(0, -1).some((s) => s === "test" || s === "tests" || s === "spec" || s.endsWith("tests"))) return true;
  return /tests\.|[-._]test\.|[-._]spec\./.test(base);
}

const SRC_EXT = /\.(swift|ts|tsx|js|jsx|mjs|cjs|py)$/;

function topDirOf(path: string): string {
  const i = path.indexOf("/");
  return i === -1 ? "." : path.slice(0, i);
}

// color group per path. single-root-package repos (hyprmac: everything under
// HyprMac/) would render monochrome on top-dir alone, so descend one level.
// dirSegs: segments that are all directories (aggregated node ids) vs file paths
// whose last segment is the basename.
function groupsFor(paths: string[], dirSegs = false): Map<string, string> {
  const counts = new Map<string, number>();
  for (const p of paths) counts.set(topDirOf(p), (counts.get(topDirOf(p)) ?? 0) + 1);
  const maxShare = Math.max(...counts.values()) / Math.max(1, paths.length);
  // descend when top-level barely discriminates — few dirs, or one dominant
  // package (keeps colors stable when the tests toggle adds a top dir)
  const deep = counts.size < 3 || maxShare > 0.5;
  const minSegs = dirSegs ? 2 : 3;
  const out = new Map<string, string>();
  for (const p of paths) {
    const segs = p.split("/");
    out.set(p, deep && segs.length >= minSegs ? `${segs[0]}/${segs[1]}` : topDirOf(p));
  }
  return out;
}

function dirOf(path: string): string {
  const i = path.lastIndexOf("/");
  return i === -1 ? "." : path.slice(0, i);
}

// compact chips: fixed width (rank pitch stays tight and below-labels get room),
// height carries the loc signal inside a modest range. tuned on hyprmac (72 files):
// wide loc-proportional nodes pushed the layout past 1700px; this keeps it ~1270.
function nodeSize(loc: number): { w: number; h: number } {
  const h = Math.max(16, Math.min(36, Math.round(12 + 1.6 * Math.sqrt(Math.max(1, loc)))));
  return { w: 58, h };
}

export function buildGraphData(
  files: GraphFile[],
  edges: DepEdge[],
  opts: { aggregate?: boolean; hideTests?: boolean } = {},
): GraphData {
  const hideTests = opts.hideTests ?? true;
  const kept = hideTests ? files.filter((f) => !isTestPath(f.path)) : files;
  const sorted = [...kept].sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  const known = new Set(sorted.map((f) => f.path));
  const deps = edges.filter((e) => DEP_TYPES.has(e.type) && known.has(e.from) && known.has(e.to));
  const aggregated = opts.aggregate ?? sorted.length > AGGREGATE_THRESHOLD;

  let nodes: GraphNode[];
  let mapped: { from: string; to: string; type: string }[];

  if (!aggregated) {
    const groups = groupsFor(sorted.map((f) => f.path));
    nodes = sorted.map((f) => {
      const { w, h } = nodeSize(f.loc);
      // extension off: the tooltip has the full path, and shorter labels collide less
      const label = (f.path.split("/").pop() ?? f.path).replace(SRC_EXT, "");
      return { id: f.path, label, group: groups.get(f.path)!, loc: f.loc, seq: f.seq, files: 1, w, h };
    });
    mapped = deps;
  } else {
    const byDir = new Map<string, { loc: number; seq: number; files: number }>();
    for (const f of sorted) {
      const dir = dirOf(f.path);
      const cur = byDir.get(dir) ?? { loc: 0, seq: -1, files: 0 };
      cur.loc += f.loc;
      cur.seq = Math.max(cur.seq, f.seq);
      cur.files += 1;
      byDir.set(dir, cur);
    }
    const dirIds = [...byDir.keys()].sort();
    const groups = groupsFor(dirIds, true);
    nodes = dirIds.map((dir) => {
      const d = byDir.get(dir)!;
      const { w, h } = nodeSize(d.loc);
      const label = dir === "." ? "(root)" : (dir.split("/").pop() ?? dir);
      return { id: dir, label, group: groups.get(dir)!, loc: d.loc, seq: d.seq, files: d.files, w, h };
    });
    mapped = deps
      .map((e) => ({ from: dirOf(e.from), to: dirOf(e.to), type: e.type }))
      .filter((e) => e.from !== e.to);
  }

  // dedupe file pairs, merge types, canonical order
  const byPair = new Map<string, GraphEdge>();
  for (const e of mapped) {
    const k = `${e.from}|${e.to}`;
    const cur = byPair.get(k);
    if (cur) {
      if (!cur.types.includes(e.type)) cur.types.push(e.type);
    } else {
      byPair.set(k, { from: e.from, to: e.to, types: [e.type] });
    }
  }
  const outEdges = [...byPair.values()];
  for (const e of outEdges) e.types.sort();
  outEdges.sort((a, b) => (a.from + "|" + a.to < b.from + "|" + b.to ? -1 : 1));

  return { nodes, edges: outEdges, aggregated, fileCount: sorted.length, hiddenTests: files.length - kept.length };
}

export interface LaidNode extends GraphNode {
  x: number; // center
  y: number;
}

export interface LaidEdge extends GraphEdge {
  points: { x: number; y: number }[];
}

export interface GraphLayout {
  nodes: LaidNode[];
  edges: LaidEdge[];
  width: number;
  height: number;
}

// dagre layered left->right for the connected component set; disconnected nodes
// park in a compact path-ordered grid below, never scattered into the layout.
export function layoutGraph(dagre: any, data: GraphData): GraphLayout {
  const linked = new Set<string>();
  for (const e of data.edges) {
    linked.add(e.from);
    linked.add(e.to);
  }
  const connected = data.nodes.filter((n) => linked.has(n.id));
  const isolated = data.nodes.filter((n) => !linked.has(n.id));

  const pos = new Map<string, { x: number; y: number }>();
  const laidEdges: LaidEdge[] = [];
  let coreW = 0;
  let coreH = 0;

  if (connected.length) {
    const g = new dagre.graphlib.Graph();
    // tuned on hyprmac (63 connected nodes / 173 edges): LR + 58px chips gives a
    // ~1150px-wide layout — fit-to-width lands near 1:1 so labels stay legible;
    // the height (~3000px) is what pan is for. nodesep clears the below-labels;
    // rank pitch (58 + 44) clears the widest truncated label.
    g.setGraph({ rankdir: "LR", nodesep: 22, ranksep: 44, marginx: 10, marginy: 10 });
    g.setDefaultEdgeLabel(() => ({}));
    for (const n of connected) g.setNode(n.id, { width: n.w, height: n.h });
    for (const e of data.edges) g.setEdge(e.from, e.to);
    dagre.layout(g);
    for (const n of connected) {
      const p = g.node(n.id);
      pos.set(n.id, { x: p.x, y: p.y });
    }
    for (const e of data.edges) {
      const p = g.edge(e.from, e.to);
      laidEdges.push({ ...e, points: (p?.points ?? []).map((pt: { x: number; y: number }) => ({ x: pt.x, y: pt.y })) });
    }
    const gg = g.graph();
    coreW = gg.width ?? 0;
    coreH = gg.height ?? 0;
  }

  if (isolated.length) {
    // cell padding clears the below-node labels
    const cellW = Math.max(...isolated.map((n) => n.w)) + 36;
    const cellH = Math.max(...isolated.map((n) => n.h)) + 26;
    const cols = coreW > cellW ? Math.max(1, Math.floor(coreW / cellW)) : Math.max(1, Math.ceil(Math.sqrt(isolated.length * 2)));
    const y0 = coreH + (connected.length ? 44 : 10);
    isolated.forEach((n, i) => {
      const col = i % cols;
      const row = Math.floor(i / cols);
      pos.set(n.id, { x: 10 + col * cellW + cellW / 2, y: y0 + row * cellH + cellH / 2 });
    });
    const rows = Math.ceil(isolated.length / cols);
    coreW = Math.max(coreW, 10 + Math.min(isolated.length, cols) * cellW);
    coreH = y0 + rows * cellH;
  }

  const nodes: LaidNode[] = data.nodes.map((n) => ({ ...n, ...pos.get(n.id)! }));
  return { nodes, edges: laidEdges, width: Math.max(coreW, 1), height: Math.max(coreH, 1) };
}
