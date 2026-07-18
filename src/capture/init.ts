import { existsSync, readFileSync, writeFileSync, mkdirSync, appendFileSync } from "node:fs";
import { join, resolve, dirname } from "node:path";
import { resolveRepoRoot, binShimPath } from "../shared/paths.js";

const POST_MATCHER = "Edit|Write|MultiEdit|NotebookEdit";

interface HookCmd {
  type: "command";
  command: string;
  async?: boolean;
  timeout?: number;
}
interface HookGroup {
  matcher?: string;
  hooks: HookCmd[];
}

// install capture into an observed repo: .codemap/, git exclude, merged hook config.
export function runInit(repoArg?: string): void {
  const start = repoArg ? resolve(repoArg) : process.cwd();
  const repoRoot = resolveRepoRoot(start);
  const codemapDir = join(repoRoot, ".codemap");
  mkdirSync(join(codemapDir, "turn-buffer"), { recursive: true });

  installExclude(repoRoot);
  installHooks(repoRoot);

  console.log(`codemap: installed into ${repoRoot}`);
}

function installExclude(repoRoot: string): void {
  const gitDir = join(repoRoot, ".git");
  if (!existsSync(gitDir)) {
    console.log("codemap: no .git found — skipping exclude (add '.codemap/' to your ignore manually)");
    return;
  }
  const excludePath = join(gitDir, "info", "exclude");
  mkdirSync(dirname(excludePath), { recursive: true });
  const existing = existsSync(excludePath) ? readFileSync(excludePath, "utf8") : "";
  const lines = existing.split("\n").map((l) => l.trim());
  const wanted = [".codemap/", ".claude/settings.local.json"].filter((w) => !lines.includes(w));
  if (!wanted.length) return;
  const prefix = existing.length && !existing.endsWith("\n") ? "\n" : "";
  appendFileSync(excludePath, prefix + wanted.join("\n") + "\n");
}

function installHooks(repoRoot: string): void {
  // local, not settings.json: the command embeds this machine's absolute path
  const settingsPath = join(repoRoot, ".claude", "settings.local.json");
  const postCmd = `${binShimPath} hook post-tool-use`;
  const stopCmd = `${binShimPath} hook stop`;

  let settings: Record<string, unknown> = {};
  if (existsSync(settingsPath)) {
    try {
      settings = JSON.parse(readFileSync(settingsPath, "utf8")) as Record<string, unknown>;
    } catch {
      console.log(`codemap: ${settingsPath} is not valid JSON — not touching it. Add these hooks manually:`);
      console.log(`  PostToolUse (matcher ${POST_MATCHER}): ${postCmd}`);
      console.log(`  Stop (async): ${stopCmd}`);
      return;
    }
  }

  const hooks = (settings.hooks ?? {}) as Record<string, HookGroup[]>;
  const post = (hooks.PostToolUse ?? []) as HookGroup[];
  const stop = (hooks.Stop ?? []) as HookGroup[];
  let changed = false;

  if (!hasCommand(post, postCmd)) {
    post.push({ matcher: POST_MATCHER, hooks: [{ type: "command", command: postCmd }] });
    changed = true;
  }
  if (!hasCommand(stop, stopCmd)) {
    stop.push({ hooks: [{ type: "command", command: stopCmd, async: true, timeout: 30 }] });
    changed = true;
  }

  if (!changed) {
    console.log("codemap: hooks already installed");
    return;
  }

  hooks.PostToolUse = post;
  hooks.Stop = stop;
  settings.hooks = hooks;
  mkdirSync(dirname(settingsPath), { recursive: true });
  writeFileSync(settingsPath, JSON.stringify(settings, null, 2) + "\n");
}

function hasCommand(groups: HookGroup[], cmd: string): boolean {
  return groups.some((g) => g.hooks?.some((h) => h.command === cmd));
}
