import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { selectStaleFiles, derive } from "../dist/view/derive.js";
import { startServer } from "../dist/view/server.js";

const SHIM = resolve(process.cwd(), "bin", "codemap.js");

// ---- fixtures for the pure staleness selector ----

function fileObserved(path, loc) {
  return { v: 0, id: "e", ts: "2026-07-18T09:00:00Z", source: "scan", turn: null, branch: "main", commit: "c0", kind: "entity.observed", entity: { id: path, type: "file", path, name: path.split("/").pop(), span: [1, loc], loc } };
}
function changed(entity_id, delta) {
  return { v: 0, id: "e", ts: "2026-07-18T09:10:00Z", source: "agent-hook", turn: { session_id: "s", turn_id: 1 }, branch: "main", commit: "c1", kind: "entity.changed", change: "modified", entity_id, delta_loc: delta };
}
function summary(path, text, model, ts) {
  return { v: 0, id: "e", ts: ts ?? "2026-07-18T09:05:00Z", source: "consolidation", turn: null, branch: "main", commit: "c0", kind: "annotation", targets: [path], text, origin: "llm-summary", confidence: "stated", model: model ?? "haiku" };
}

test("staleness: no summary -> selected", () => {
  const stale = selectStaleFiles([fileObserved("src/a.ts", 40)]);
  assert.equal(stale.length, 1);
  assert.equal(stale[0].path, "src/a.ts");
  assert.equal(stale[0].reason, "no-summary");
});

test("staleness: >=3 changes since summary -> selected", () => {
  const events = [
    fileObserved("src/a.ts", 100),
    summary("src/a.ts", "does a thing"),
    changed("src/a.ts#foo", 2),
    changed("src/a.ts#bar", 3),
    changed("src/a.ts", 5),
  ];
  const stale = selectStaleFiles(events);
  assert.equal(stale.length, 1);
  assert.equal(stale[0].reason, "changes");
  assert.equal(stale[0].changesSince, 3);
});

test("staleness: >=30% cumulative delta since summary -> selected", () => {
  const events = [
    fileObserved("src/a.ts", 100),
    summary("src/a.ts", "does a thing"),
    changed("src/a.ts#foo", 40), // 40 >= 30% of 100, only one change
  ];
  const stale = selectStaleFiles(events);
  assert.equal(stale.length, 1);
  assert.equal(stale[0].reason, "delta");
  assert.equal(stale[0].deltaSince, 40);
});

test("staleness: summarized and untouched (and small changes) -> not selected", () => {
  const summarized = selectStaleFiles([fileObserved("src/a.ts", 100), summary("src/a.ts", "does a thing")]);
  assert.deepEqual(summarized, []);

  // one small change: below both the 3-change and 30%-delta triggers
  const lightlyTouched = selectStaleFiles([
    fileObserved("src/a.ts", 100),
    summary("src/a.ts", "does a thing"),
    changed("src/a.ts#foo", 5),
  ]);
  assert.deepEqual(lightlyTouched, []);
});

test("staleness: limit caps and orders no-summary first", () => {
  const events = [fileObserved("src/a.ts", 40), fileObserved("src/b.ts", 40), fileObserved("src/c.ts", 40)];
  const stale = selectStaleFiles(events, 2);
  assert.equal(stale.length, 2);
});

// ---- derive: latest llm-summary wins ----

test("derive: latest llm-summary per file wins with two summaries", () => {
  const events = [
    fileObserved("src/a.ts", 40),
    summary("src/a.ts", "first summary", "haiku", "2026-07-18T09:05:00Z"),
    summary("src/a.ts", "second summary", "sonnet", "2026-07-18T10:00:00Z"),
  ];
  const state = derive(events);
  const a = state.entities.find((e) => e.id === "src/a.ts");
  assert.ok(a.summary);
  assert.equal(a.summary.text, "second summary");
  assert.equal(a.summary.model, "sonnet");
});

// ---- end-to-end via the CLI, with the backend stubbed ----

function git(cwd, args) {
  execFileSync("git", args, { cwd, stdio: "ignore" });
}
function readEvents(repo) {
  const p = join(repo, ".codemap", "events.jsonl");
  if (!existsSync(p)) return [];
  return readFileSync(p, "utf8").split("\n").filter((l) => l.trim()).map((l) => JSON.parse(l));
}
function setupRepo() {
  const tmp = mkdtempSync(join(tmpdir(), "codemap-summarize-"));
  git(tmp, ["init", "-q", "-b", "main"]);
  git(tmp, ["config", "user.email", "t@t.dev"]);
  git(tmp, ["config", "user.name", "t"]);
  git(tmp, ["config", "commit.gpgsign", "false"]);
  mkdirSync(join(tmp, "src"));
  writeFileSync(join(tmp, "src", "util.ts"), "export function add(a: number, b: number) { return a + b; }\n");
  git(tmp, ["add", "-A"]);
  git(tmp, ["commit", "-qm", "init"]);
  return tmp;
}
// stub reads stdin (drains the prompt so no EPIPE) and emits a fixed line
const STUB = 'cat > /dev/null; echo "  stub summary   for   the file  "';

function summarize(tmp, extraArgs = []) {
  return execFileSync("node", [SHIM, "summarize", "--repo", tmp, ...extraArgs], {
    encoding: "utf8",
    env: { ...process.env, CODEMAP_SUMMARIZE_CMD: STUB },
  });
}

test("summarize: emits llm-summary events, /api/state carries summary, idempotent", async () => {
  const tmp = setupRepo();
  try {
    execFileSync("node", [SHIM, "scan", "--repo", tmp], { stdio: "ignore" });

    const out = summarize(tmp);
    assert.match(out, /summarize: 1 summarized, 0 skipped, 0 failed/);

    const anns = readEvents(tmp).filter((e) => e.kind === "annotation" && e.origin === "llm-summary");
    assert.equal(anns.length, 1);
    const a = anns[0];
    assert.deepEqual(a.targets, ["src/util.ts"]);
    assert.equal(a.origin, "llm-summary");
    assert.equal(a.source, "consolidation");
    assert.equal(a.turn, null);
    assert.equal(a.confidence, "stated");
    assert.equal(a.model, "claude-haiku-4-5-20251001");
    // whitespace collapsed + trimmed
    assert.equal(a.text, "stub summary for the file");

    // /api/state exposes the summary on the file entity
    const srv = await startServer({ repoRoot: tmp, port: 0 });
    try {
      const state = await fetch(`${srv.url}/api/state`).then((r) => r.json());
      const util = state.entities.find((e) => e.id === "src/util.ts");
      assert.ok(util.summary, "file entity carries summary");
      assert.equal(util.summary.text, "stub summary for the file");
      assert.equal(util.summary.model, "claude-haiku-4-5-20251001");
    } finally {
      await srv.close();
    }

    // re-run selects nothing (summarized + untouched)
    const again = summarize(tmp);
    assert.match(again, /0 files selected/);
    const after = readEvents(tmp).filter((e) => e.kind === "annotation" && e.origin === "llm-summary");
    assert.equal(after.length, 1, "no duplicate summary on idempotent re-run");
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

test("summarize: --dry-run prints the plan and emits nothing", () => {
  const tmp = setupRepo();
  try {
    execFileSync("node", [SHIM, "scan", "--repo", tmp], { stdio: "ignore" });
    const before = readEvents(tmp).length;
    const out = summarize(tmp, ["--dry-run"]);
    assert.match(out, /--dry-run: 1 file/);
    assert.match(out, /src\/util\.ts/);
    assert.equal(readEvents(tmp).length, before, "dry-run appends no events");
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});
