import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const SHIM = resolve(process.cwd(), "bin", "codemap.js");

function git(cwd, args) {
  execFileSync("git", args, { cwd, stdio: "ignore" });
}

function runHook(sub, payload, cwd) {
  return execFileSync("node", [SHIM, "hook", sub], {
    input: JSON.stringify(payload),
    cwd,
    encoding: "utf8",
  });
}

function readEvents(repo) {
  const p = join(repo, ".codemap", "events.jsonl");
  if (!existsSync(p)) return [];
  return readFileSync(p, "utf8")
    .split("\n")
    .filter((l) => l.trim())
    .map((l) => JSON.parse(l));
}

function setupRepo() {
  const tmp = mkdtempSync(join(tmpdir(), "codemap-it-"));
  git(tmp, ["init", "-q", "-b", "main"]);
  git(tmp, ["config", "user.email", "t@t.dev"]);
  git(tmp, ["config", "user.name", "t"]);
  git(tmp, ["config", "commit.gpgsign", "false"]);
  mkdirSync(join(tmp, "src"), { recursive: true });
  writeFileSync(join(tmp, "src", "util.js"), "export function add(a, b) { return a + b; }\n");
  git(tmp, ["add", "-A"]);
  git(tmp, ["commit", "-qm", "init"]);
  // install capture (also exercises init end-to-end)
  execFileSync("node", [SHIM, "init", "--repo", tmp], { stdio: "ignore" });
  return tmp;
}

test("init installs hooks + exclude", () => {
  const tmp = setupRepo();
  try {
    const settings = JSON.parse(readFileSync(join(tmp, ".claude", "settings.local.json"), "utf8"));
    const postCmds = settings.hooks.PostToolUse.flatMap((g) => g.hooks.map((h) => h.command));
    const stopCmds = settings.hooks.Stop.flatMap((g) => g.hooks.map((h) => h.command));
    assert.ok(postCmds.some((c) => c.includes("hook post-tool-use")));
    assert.ok(stopCmds.some((c) => c.includes("hook stop")));
    assert.ok(settings.hooks.Stop[0].hooks[0].async === true);

    const exclude = readFileSync(join(tmp, ".git", "info", "exclude"), "utf8");
    assert.ok(exclude.split("\n").includes(".codemap/"));

    // idempotent: second init does not duplicate
    execFileSync("node", [SHIM, "init", "--repo", tmp], { stdio: "ignore" });
    const again = JSON.parse(readFileSync(join(tmp, ".claude", "settings.local.json"), "utf8"));
    assert.equal(again.hooks.PostToolUse.length, settings.hooks.PostToolUse.length);
    assert.equal(again.hooks.Stop.length, settings.hooks.Stop.length);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

test("buffer -> stop captures a turn into events.jsonl", () => {
  const tmp = setupRepo();
  try {
    // edit a file, buffer it via the post-tool-use hook
    const target = join(tmp, "src", "util.js");
    writeFileSync(target, "export function add(a, b) { return a + b; }\nexport function sub(a, b) { return a - b; }\n");
    runHook("post-tool-use", {
      session_id: "s1",
      cwd: tmp,
      tool_name: "Edit",
      tool_input: { file_path: target },
    }, tmp);

    // buffer file exists for the session
    assert.ok(existsSync(join(tmp, ".codemap", "turn-buffer", "s1.jsonl")));

    // stop does the real work
    runHook("stop", {
      session_id: "s1",
      cwd: tmp,
      last_assistant_message: "MAP: util -> added a subtract helper\nAdded the sub function to util.",
    }, tmp);

    const events = readEvents(tmp);
    assert.ok(events.length > 0, "expected events");

    // provenance
    for (const e of events) {
      assert.equal(e.v, 0);
      assert.equal(e.source, "agent-hook");
      assert.equal(e.turn.session_id, "s1");
      assert.equal(e.turn.turn_id, 1);
      assert.equal(e.branch, "main");
      assert.ok(e.commit, "commit should be set on a committed repo");
      assert.ok(e.id.startsWith("evt_"));
    }

    // structural facts
    const observed = events.filter((e) => e.kind === "entity.observed").map((e) => e.entity.id);
    assert.ok(observed.includes("src/util.js#sub"));
    assert.ok(observed.includes("src/util.js#add"));
    assert.ok(observed.includes("src/util.js"));

    const added = events.filter((e) => e.kind === "entity.changed" && e.change === "added").map((e) => e.entity_id);
    assert.ok(added.includes("src/util.js#sub"));

    const defEdges = events.filter((e) => e.kind === "edge.changed" && e.change === "added" && e.edge.type === "defines");
    assert.ok(defEdges.some((e) => e.edge.to === "src/util.js#sub" && e.edge.from === "src/util.js"));

    // annotations, both origins
    const notes = events.filter((e) => e.kind === "annotation" && e.origin === "map-note");
    assert.equal(notes.length, 1);
    assert.equal(notes[0].text, "added a subtract helper");
    assert.deepEqual(notes[0].targets, ["src/util.js"]);
    const turnText = events.filter((e) => e.kind === "annotation" && e.origin === "turn-text");
    assert.equal(turnText.length, 1);
    assert.ok(!turnText[0].text.includes("MAP:"));

    // buffer cleared after stop
    assert.ok(!existsSync(join(tmp, ".codemap", "turn-buffer", "s1.jsonl")));
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

test("zero-change turn emits nothing", () => {
  const tmp = setupRepo();
  try {
    // make one real change + capture it
    const target = join(tmp, "src", "util.js");
    writeFileSync(target, "export function add(a, b) { return a + b; }\nexport const z = 1;\n");
    runHook("post-tool-use", { session_id: "s1", cwd: tmp, tool_name: "Edit", tool_input: { file_path: target } }, tmp);
    runHook("stop", { session_id: "s1", cwd: tmp, last_assistant_message: "did a thing" }, tmp);
    const before = readEvents(tmp).length;
    assert.ok(before > 0);

    // commit everything so git is clean, then a fresh session with no buffer
    git(tmp, ["add", "-A"]);
    git(tmp, ["commit", "-qm", "work"]);
    runHook("stop", { session_id: "s2", cwd: tmp, last_assistant_message: "nothing changed this turn" }, tmp);

    const after = readEvents(tmp).length;
    assert.equal(after, before, "no new events on a zero-change turn");
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

test("malformed stdin on post-tool-use exits 0 and does not throw", () => {
  const tmp = setupRepo();
  try {
    // should not throw (exit 0)
    execFileSync("node", [SHIM, "hook", "post-tool-use"], { input: "not json", cwd: tmp, encoding: "utf8" });
    assert.ok(true);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});
