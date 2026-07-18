import { mkdirSync, appendFileSync } from "node:fs";
import { join } from "node:path";
import { postToolUse } from "./capture/buffer.js";
import { runStop } from "./capture/stop.js";
import { runInit } from "./capture/init.js";
import { runBench } from "./capture/bench.js";
import { isoSeconds } from "./shared/events.js";

export async function main(argv: string[]): Promise<void> {
  const [cmd, sub, ...rest] = argv;

  if (cmd === "hook" && sub === "post-tool-use") return hookPostToolUse();
  if (cmd === "hook" && sub === "stop") return hookStop();
  if (cmd === "init") return void runInit(getFlag([sub, ...rest], "--repo"));
  if (cmd === "bench") {
    const args = [sub, ...rest];
    const repo = getFlag(args, "--repo");
    const files = Number(getFlag(args, "--files") ?? "10");
    return runBench(repo, Number.isFinite(files) && files > 0 ? files : 10);
  }
  if (cmd === "scan") {
    const { runScan } = await import("./capture/scan.js");
    return runScan(getFlag([sub, ...rest], "--repo"));
  }
  if (cmd === "view") {
    const { runView } = await import("./view/server.js");
    return runView([sub, ...rest]);
  }

  console.log("usage: codemap <hook post-tool-use | hook stop | init [--repo <path>] | scan [--repo <path>] | bench --repo <path> --files <n> | view [--repo <path>] [--port <n>] [--open]>");
}

// ---- hook entry points: always exit 0, never write to stdout on success ----

async function hookPostToolUse(): Promise<void> {
  try {
    const payload = JSON.parse(await readStdin());
    postToolUse(payload);
  } catch (e) {
    logError(fallbackCodemapDir(), e);
  }
  process.exit(0);
}

async function hookStop(): Promise<void> {
  let codemapDir = fallbackCodemapDir();
  try {
    const raw = await readStdin();
    const payload = JSON.parse(raw);
    const { resolveRepoRoot } = await import("./shared/paths.js");
    const repoRoot = resolveRepoRoot(payload.cwd || process.cwd());
    codemapDir = join(repoRoot, ".codemap");
    await runStop({ payload, repoRoot, codemapDir });
  } catch (e) {
    logError(codemapDir, e);
  }
  process.exit(0);
}

function readStdin(): Promise<string> {
  return new Promise((res) => {
    if (process.stdin.isTTY) return res("");
    let data = "";
    process.stdin.setEncoding("utf8");
    process.stdin.on("data", (c) => (data += c));
    process.stdin.on("end", () => res(data));
    process.stdin.on("error", () => res(data));
  });
}

function fallbackCodemapDir(): string {
  const root = process.env.CLAUDE_PROJECT_DIR || process.cwd();
  return join(root, ".codemap");
}

function logError(codemapDir: string, e: unknown): void {
  try {
    mkdirSync(codemapDir, { recursive: true });
    const msg = e instanceof Error ? e.stack ?? e.message : String(e);
    appendFileSync(join(codemapDir, "capture.log"), `${isoSeconds()} ${msg}\n`);
  } catch {
    // last resort: swallow. hooks must never fail loudly.
  }
}

function getFlag(args: (string | undefined)[], flag: string): string | undefined {
  const i = args.indexOf(flag);
  if (i === -1 || i + 1 >= args.length) return undefined;
  return args[i + 1];
}
