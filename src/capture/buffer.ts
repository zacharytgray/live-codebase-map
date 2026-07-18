import { existsSync, readFileSync, appendFileSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { resolveRepoRoot, toRepoRel } from "../shared/paths.js";
import { isoSeconds } from "../shared/events.js";

// keep all per-turn state keyed by session_id (concurrent sessions share one repo).
function bufferDir(codemapDir: string): string {
  return join(codemapDir, "turn-buffer");
}

function bufferFile(codemapDir: string, sessionId: string): string {
  return join(bufferDir(codemapDir), `${sessionId}.jsonl`);
}

function metaFile(codemapDir: string, sessionId: string): string {
  return join(bufferDir(codemapDir), `${sessionId}.meta.json`);
}

export interface PostToolPayload {
  session_id?: string;
  cwd?: string;
  tool_name?: string;
  tool_input?: { file_path?: string };
}

// PostToolUse hook: append the touched file path to this session's buffer. near-instant.
export function postToolUse(payload: PostToolPayload): void {
  const filePath = payload.tool_input?.file_path;
  const sessionId = payload.session_id;
  if (!filePath || !sessionId) return;
  const repoRoot = resolveRepoRoot(payload.cwd || process.cwd());
  const codemapDir = join(repoRoot, ".codemap");
  mkdirSync(bufferDir(codemapDir), { recursive: true });
  const rel = toRepoRel(repoRoot, filePath);
  const line = JSON.stringify({ ts: isoSeconds(), file_path: rel, tool_name: payload.tool_name ?? null });
  appendFileSync(bufferFile(codemapDir, sessionId), line + "\n");
}

export interface BufferEntry {
  file_path: string;
}

export function readBuffer(codemapDir: string, sessionId: string): BufferEntry[] {
  const p = bufferFile(codemapDir, sessionId);
  if (!existsSync(p)) return [];
  const out: BufferEntry[] = [];
  for (const line of readFileSync(p, "utf8").split("\n")) {
    if (!line.trim()) continue;
    try {
      const obj = JSON.parse(line) as BufferEntry;
      if (obj.file_path) out.push(obj);
    } catch {
      // skip malformed line
    }
  }
  return out;
}

export function clearBuffer(codemapDir: string, sessionId: string): void {
  rmSync(bufferFile(codemapDir, sessionId), { force: true });
}

// monotonic per-session turn counter; advanced only when a turn actually emits.
export function nextTurnId(codemapDir: string, sessionId: string): number {
  mkdirSync(bufferDir(codemapDir), { recursive: true });
  const p = metaFile(codemapDir, sessionId);
  let current = 0;
  if (existsSync(p)) {
    try {
      current = (JSON.parse(readFileSync(p, "utf8")) as { turn_id?: number }).turn_id ?? 0;
    } catch {
      current = 0;
    }
  }
  const next = current + 1;
  writeFileSync(p, JSON.stringify({ turn_id: next }));
  return next;
}
