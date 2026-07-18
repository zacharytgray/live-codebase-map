import { existsSync, readFileSync, accessSync, constants } from "node:fs";
import { join, resolve, basename } from "node:path";
import { spawn } from "node:child_process";
import { resolveRepoRoot } from "../shared/paths.js";
import { gitBranch, gitCommit } from "../shared/git.js";
import { annotation, type EventCtx } from "../shared/events.js";
import { appendEvents } from "../store/jsonl.js";
import { derive, selectStaleFiles, type DerivedState, type RawEvent } from "../view/derive.js";

const DEFAULT_MODEL = "claude-haiku-4-5-20251001";
const CONCURRENCY = 4;
const CALL_TIMEOUT_MS = 60_000;

// Layer-3 consolidation: per-file 1-2 sentence purpose summaries, human-invoked only.
// never wired into capture hooks (invariant 1 — off the critical path).
export async function runSummarize(argv: (string | undefined)[]): Promise<void> {
  const model = flag(argv, "--model") ?? DEFAULT_MODEL;
  const limitArg = flag(argv, "--limit");
  const limit = limitArg !== undefined ? Math.max(0, Number(limitArg) || 0) : 100;
  const dryRun = argv.includes("--dry-run");
  const repoRoot = resolveRepoRoot(flag(argv, "--repo") ? resolve(flag(argv, "--repo")!) : process.cwd());
  const codemapDir = join(repoRoot, ".codemap");

  const events = readEvents(codemapDir);
  const stale = selectStaleFiles(events, limit);

  if (dryRun) {
    console.log(`summarize --dry-run: ${stale.length} file(s) would be summarized (model ${model})`);
    for (const f of stale) {
      console.log(`  ${f.path}  [${f.reason}]  changes:${f.changesSince} delta:${f.deltaSince} loc:${f.loc}`);
    }
    return;
  }

  if (stale.length === 0) {
    console.log("summarize: 0 files selected — everything is fresh");
    return;
  }

  // fail fast if the default backend is missing before touching a single file
  const usingStub = !!process.env.CODEMAP_SUMMARIZE_CMD;
  if (!usingStub && !onPath("claude")) {
    console.error("summarize: backend 'claude' not found on PATH — install it or set CODEMAP_SUMMARIZE_CMD");
    process.exitCode = 1;
    return;
  }

  const t0 = Date.now();
  const state = derive(events);
  const ctx: EventCtx = {
    session_id: null,
    turn_id: null,
    branch: gitBranch(repoRoot),
    commit: gitCommit(repoRoot),
    source: "consolidation",
  };

  const results = await mapPool(stale, CONCURRENCY, async (f): Promise<Result> => {
    const prompt = buildPrompt(repoRoot, f.path, state);
    if (prompt == null) return { path: f.path, status: "skip" };
    const raw = await runBackend(prompt, model);
    if (raw == null) return { path: f.path, status: "fail" };
    const text = cleanSummary(raw);
    if (!text) return { path: f.path, status: "fail" };
    return { path: f.path, status: "ok", text };
  });

  const outEvents: Record<string, unknown>[] = [];
  let summarized = 0;
  let skipped = 0;
  let failed = 0;
  for (const r of results) {
    if (r.status === "ok") {
      outEvents.push(annotation(ctx, [r.path], r.text, "llm-summary", "stated", model));
      summarized++;
    } else if (r.status === "skip") {
      skipped++;
      process.stderr.write(`summarize: skipped ${r.path} (unreadable)\n`);
    } else {
      failed++;
      process.stderr.write(`summarize: failed ${r.path} (backend error or empty)\n`);
    }
  }

  if (outEvents.length) appendEvents(codemapDir, outEvents); // one batch at the end
  console.log(`summarize: ${summarized} summarized, ${skipped} skipped, ${failed} failed, ${Date.now() - t0} ms`);
}

interface OkResult {
  path: string;
  status: "ok";
  text: string;
}
type Result = OkResult | { path: string; status: "skip" | "fail" };

// deterministic per-file context: path, entities, edges both ways (by basename),
// up to 3 latest annotations, and the file head.
function buildPrompt(repoRoot: string, path: string, state: DerivedState): string | null {
  let source: string;
  try {
    source = readFileSync(join(repoRoot, path), "utf8");
  } catch {
    return null;
  }
  const head = source.split("\n").slice(0, 150).join("\n");

  const ents = state.entities
    .filter((e) => e.path === path && e.type !== "file")
    .sort((a, b) => a.span[0] - b.span[0])
    .map((e) => `- ${e.name} (${e.type}, ${e.loc} loc)`);
  const out = uniq(state.edges.filter((e) => e.from === path).map((e) => basename(e.to)));
  const inc = uniq(state.edges.filter((e) => e.to === path).map((e) => basename(e.from)));
  const annos = state.annotations
    .filter((a) => (a.targets || []).includes(path))
    .sort((a, b) => (a.ts < b.ts ? 1 : -1))
    .slice(0, 3)
    .map((a) => `- ${a.text}`);

  const parts = [
    `File: ${path}`,
    ents.length ? `Entities:\n${ents.join("\n")}` : "Entities: none",
    `Depends on: ${out.join(", ") || "none"}`,
    `Depended on by: ${inc.join(", ") || "none"}`,
    annos.length ? `Existing notes:\n${annos.join("\n")}` : "",
    `--- first 150 lines ---\n${head}`,
    "In 1-2 plain sentences, state what this file is for and its key relationships. No preamble, no markdown.",
  ].filter((s) => s !== "");
  return parts.join("\n\n");
}

// default backend: claude -p <prompt> --model <model>. override via CODEMAP_SUMMARIZE_CMD
// (a shell template run with the prompt on stdin; {model} is substituted). returns
// stdout on success, null on error/timeout/nonzero — the test seam lives here.
function runBackend(prompt: string, model: string): Promise<string | null> {
  return new Promise((resolvePromise) => {
    const tmpl = process.env.CODEMAP_SUMMARIZE_CMD;
    const child = tmpl
      ? spawn("sh", ["-c", tmpl.replace(/\{model\}/g, model)], { stdio: ["pipe", "pipe", "inherit"] })
      : spawn("claude", ["-p", prompt, "--model", model], { stdio: ["ignore", "pipe", "inherit"] });

    let out = "";
    let done = false;
    const finish = (v: string | null) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      resolvePromise(v);
    };
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      finish(null);
    }, CALL_TIMEOUT_MS);

    if (tmpl && child.stdin) {
      child.stdin.on("error", () => {}); // stub may ignore stdin -> EPIPE
      child.stdin.end(prompt);
    }
    child.stdout?.on("data", (c) => (out += c));
    child.on("error", () => finish(null));
    child.on("close", (code) => finish(code === 0 ? out : null));
  });
}

function cleanSummary(s: string): string {
  return s.replace(/\s+/g, " ").trim().slice(0, 400);
}

async function mapPool<T, R>(items: T[], n: number, fn: (t: T) => Promise<R>): Promise<R[]> {
  const results = new Array<R>(items.length);
  let i = 0;
  async function worker(): Promise<void> {
    for (;;) {
      const idx = i++;
      if (idx >= items.length) return;
      results[idx] = await fn(items[idx]);
    }
  }
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, worker));
  return results;
}

function readEvents(codemapDir: string): RawEvent[] {
  const p = join(codemapDir, "events.jsonl");
  if (!existsSync(p)) return [];
  const out: RawEvent[] = [];
  for (const line of readFileSync(p, "utf8").split("\n")) {
    if (!line.trim()) continue;
    try {
      out.push(JSON.parse(line));
    } catch {
      // skip a partially-written trailing line
    }
  }
  return out;
}

function onPath(bin: string): boolean {
  for (const dir of (process.env.PATH || "").split(":")) {
    if (!dir) continue;
    try {
      accessSync(join(dir, bin), constants.X_OK);
      return true;
    } catch {
      // keep looking
    }
  }
  return false;
}

function uniq(xs: string[]): string[] {
  return [...new Set(xs)];
}

function flag(args: (string | undefined)[], name: string): string | undefined {
  const i = args.indexOf(name);
  if (i === -1 || i + 1 >= args.length) return undefined;
  return args[i + 1];
}
