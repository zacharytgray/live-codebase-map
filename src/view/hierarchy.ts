// build a stable directory/file tree from file entities. pure, no imports —
// this same compiled file is served to the page (one implementation).
//
// stability rule (invariant 3): children are sorted by path, never by size, so an
// unchanged file keeps its slot when a sibling grows or a new sibling appears.

export interface FileLeaf {
  id: string;
  path: string;
  loc: number;
}

export interface HierNode {
  name: string;
  path: string;
  loc: number; // leaf loc; directory nodes are 0 (area sums from leaves)
  id?: string; // present on leaves only
  children?: HierNode[];
}

export function buildHierarchy(files: FileLeaf[]): HierNode {
  const root: HierNode = { name: "", path: "", loc: 0, children: [] };

  for (const f of files) {
    const parts = f.path.split("/").filter(Boolean);
    let node = root;
    let acc = "";
    for (let i = 0; i < parts.length; i++) {
      const seg = parts[i];
      acc = acc ? `${acc}/${seg}` : seg;
      const leaf = i === parts.length - 1;
      if (!node.children) node.children = [];
      let child = node.children.find((c) => c.name === seg);
      if (!child) {
        child = leaf
          ? { name: seg, path: f.path, loc: f.loc, id: f.id }
          : { name: seg, path: acc, loc: 0, children: [] };
        node.children.push(child);
      }
      node = child;
    }
  }

  sortTree(root);
  return root;
}

// canonical path order at every level; deterministic (same state -> same tree)
function sortTree(node: HierNode): void {
  if (!node.children) return;
  node.children.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  for (const c of node.children) sortTree(c);
}
