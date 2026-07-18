import { execFileSync } from "node:child_process";

// raw stdout — do NOT trim here; porcelain lines carry a meaningful leading space
function git(repoRoot: string, args: string[]): string | null {
  try {
    return execFileSync("git", ["-C", repoRoot, ...args], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    });
  } catch {
    return null;
  }
}

// current branch, or null when detached / unresolvable
export function gitBranch(repoRoot: string): string | null {
  const b = git(repoRoot, ["rev-parse", "--abbrev-ref", "HEAD"])?.trim();
  if (!b || b === "HEAD") return null;
  return b;
}

// short HEAD hash, or null on an unborn branch. dirty tree still reports HEAD.
export function gitCommit(repoRoot: string): string | null {
  return git(repoRoot, ["rev-parse", "--short", "HEAD"])?.trim() || null;
}

export interface StatusPaths {
  changed: string[];
  deleted: string[];
}

// repo-relative paths from porcelain status. renames -> old deleted + new changed.
export function gitStatusPaths(repoRoot: string): StatusPaths {
  const out = git(repoRoot, ["status", "--porcelain"]);
  const changed: string[] = [];
  const deleted: string[] = [];
  if (out == null) return { changed, deleted };
  for (const line of out.split("\n")) {
    if (!line.trim()) continue;
    const x = line[0];
    const y = line[1];
    const rest = line.slice(3);
    if (x === "R" || x === "C" || y === "R" || y === "C") {
      const parts = rest.split(" -> ");
      if (parts.length === 2) {
        deleted.push(unquote(parts[0]));
        changed.push(unquote(parts[1]));
        continue;
      }
    }
    if (x === "D" || y === "D") {
      deleted.push(unquote(rest));
      continue;
    }
    changed.push(unquote(rest));
  }
  return { changed, deleted };
}

function unquote(p: string): string {
  const t = p.trim();
  if (t.startsWith('"') && t.endsWith('"')) return t.slice(1, -1);
  return t;
}
