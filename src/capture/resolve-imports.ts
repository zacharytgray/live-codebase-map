import { existsSync } from "node:fs";
import { join, posix } from "node:path";
import type { ImportRequest } from "./extract.js";

const JS_EXTS = [".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs"];

// turn a file's import requests into repo-relative target paths (existing files only).
// bare/package specifiers and unresolvable relatives are dropped.
export function resolveImports(
  repoRoot: string,
  fromRel: string,
  reqs: ImportRequest[],
): string[] {
  const out = new Set<string>();
  for (const r of reqs) {
    const t = r.lang === "py"
      ? resolvePy(repoRoot, fromRel, r.level, r.spec)
      : resolveJs(repoRoot, fromRel, r.spec);
    if (t) out.add(t);
  }
  return [...out];
}

function firstExisting(repoRoot: string, candidates: string[]): string | null {
  for (const c of candidates) {
    const norm = posix.normalize(c);
    if (norm.startsWith("..")) continue; // escaped the repo
    if (existsSync(join(repoRoot, norm))) return norm;
  }
  return null;
}

function resolveJs(repoRoot: string, fromRel: string, spec: string): string | null {
  if (!spec.startsWith(".")) return null; // bare / package import
  const base = posix.join(posix.dirname(fromRel), spec);
  const ext = posix.extname(base);
  const candidates: string[] = [];
  if (JS_EXTS.includes(ext)) {
    candidates.push(base);
    // ts convention: `./x.js` may actually be x.ts / x.tsx
    if (ext === ".js") candidates.push(base.slice(0, -3) + ".ts", base.slice(0, -3) + ".tsx");
    if (ext === ".jsx") candidates.push(base.slice(0, -4) + ".tsx");
  } else {
    for (const e of JS_EXTS) candidates.push(base + e);
    for (const e of JS_EXTS) candidates.push(posix.join(base, "index" + e));
  }
  return firstExisting(repoRoot, candidates);
}

function resolvePy(repoRoot: string, fromRel: string, level: number, modPath: string): string | null {
  let dir = posix.dirname(fromRel);
  // one leading dot = current package; each extra dot climbs one level
  for (let i = 1; i < level; i++) dir = posix.dirname(dir);
  const segs = modPath ? modPath.split(".") : [];
  const targetBase = posix.join(dir, ...segs);
  return firstExisting(repoRoot, [targetBase + ".py", posix.join(targetBase, "__init__.py")]);
}
