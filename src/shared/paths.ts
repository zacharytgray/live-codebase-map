import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";
import { realpathSync } from "node:fs";
import { isAbsolute, resolve, relative, sep, extname, dirname, basename, join } from "node:path";

// absolute path to this install's bin shim (used when writing hook commands)
export const binShimPath = fileURLToPath(new URL("../../bin/codemap.js", import.meta.url));

const SRC_EXTS = new Set([".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs", ".py"]);

export function isSourceExt(p: string): boolean {
  return SRC_EXTS.has(extname(p));
}

// canonicalize a path (resolve symlinks). git returns realpaths but payloads may
// carry symlinked ones (e.g. macOS /tmp -> /private/tmp) — mixing them breaks relative().
function canonical(p: string): string {
  try {
    return realpathSync(p);
  } catch {
    // path may not exist yet (deleted file); canonicalize its nearest ancestor
    try {
      return join(realpathSync(dirname(p)), basename(p));
    } catch {
      return p;
    }
  }
}

// git worktree root for a given dir; falls back to the dir itself if not a repo
export function resolveRepoRoot(cwd: string): string {
  try {
    const out = execFileSync("git", ["-C", cwd, "rev-parse", "--show-toplevel"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    });
    const top = out.trim();
    if (top) return top;
  } catch {
    // not a git repo
  }
  return canonical(resolve(cwd));
}

// any path -> repo-relative posix
export function toRepoRel(repoRoot: string, p: string): string {
  const abs = canonical(isAbsolute(p) ? p : resolve(repoRoot, p));
  return relative(canonical(repoRoot), abs).split(sep).join("/");
}
