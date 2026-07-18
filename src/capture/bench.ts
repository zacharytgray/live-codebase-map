import { readdirSync, statSync, mkdtempSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { resolveRepoRoot, isSourceExt, toRepoRel } from "../shared/paths.js";
import { runStop } from "./stop.js";

const SKIP_DIRS = new Set(["node_modules", ".git", ".codemap", "dist", ".archive"]);

// latency check: run the full stop pipeline over the n most-recently-modified source
// files against a throwaway .codemap. prints cold + warm wall-clock.
export async function runBench(repoArg: string | undefined, filesN: number): Promise<void> {
  const repoRoot = resolveRepoRoot(repoArg ? resolve(repoArg) : process.cwd());
  const files = mostRecentSourceFiles(repoRoot, filesN);
  if (files.length === 0) {
    console.log("bench: no source files found");
    return;
  }

  const tmp = mkdtempSync(join(tmpdir(), "codemap-bench-"));
  const payload = { session_id: "bench", cwd: repoRoot, last_assistant_message: "bench synthetic turn" };

  try {
    const t0 = performance.now();
    const r1 = await runStop({ payload, repoRoot, codemapDir: tmp, forcedChangedFiles: files });
    const cold = performance.now() - t0;

    const t1 = performance.now();
    const r2 = await runStop({ payload, repoRoot, codemapDir: tmp, forcedChangedFiles: files });
    const warm = performance.now() - t1;

    console.log(
      `bench: ${files.length} files | cold ${cold.toFixed(1)}ms (${r1.events} events) | warm ${warm.toFixed(1)}ms (${r2.events} events)`,
    );
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}

function mostRecentSourceFiles(repoRoot: string, n: number): string[] {
  const found: { rel: string; mtime: number }[] = [];
  walk(repoRoot, repoRoot, found);
  found.sort((a, b) => b.mtime - a.mtime);
  return found.slice(0, n).map((f) => f.rel);
}

function walk(repoRoot: string, dir: string, out: { rel: string; mtime: number }[]): void {
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return;
  }
  for (const name of entries) {
    if (SKIP_DIRS.has(name)) continue;
    const full = join(dir, name);
    let st;
    try {
      st = statSync(full);
    } catch {
      continue;
    }
    if (st.isDirectory()) walk(repoRoot, full, out);
    else if (st.isFile() && isSourceExt(name)) out.push({ rel: toRepoRel(repoRoot, full), mtime: st.mtimeMs });
  }
}
