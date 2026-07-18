import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync, cpSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const SHIM = resolve(process.cwd(), "bin", "codemap.js");

function git(cwd, args) {
  execFileSync("git", args, { cwd, stdio: "ignore" });
}

function readEvents(repo) {
  const p = join(repo, ".codemap", "events.jsonl");
  if (!existsSync(p)) return [];
  return readFileSync(p, "utf8").split("\n").filter((l) => l.trim()).map((l) => JSON.parse(l));
}

function setupRepo() {
  const tmp = mkdtempSync(join(tmpdir(), "codemap-scan-"));
  git(tmp, ["init", "-q", "-b", "main"]);
  git(tmp, ["config", "user.email", "t@t.dev"]);
  git(tmp, ["config", "user.name", "t"]);
  git(tmp, ["config", "commit.gpgsign", "false"]);
  cpSync(join(here, "fixtures", "swift-repo", "Sources"), join(tmp, "Sources"), { recursive: true });
  mkdirSync(join(tmp, "src"));
  writeFileSync(join(tmp, "src", "util.ts"), "export function add(a: number, b: number) { return a + b; }\n");
  writeFileSync(join(tmp, "README.md"), "# nope\n"); // unsupported ext, must be ignored
  git(tmp, ["add", "-A"]);
  git(tmp, ["commit", "-qm", "init"]);
  // untracked but not ignored — scan must include it
  writeFileSync(join(tmp, "src", "extra.ts"), "export const x = () => 1;\n");
  return tmp;
}

function scan(tmp) {
  return execFileSync("node", [SHIM, "scan", "--repo", tmp], { encoding: "utf8" });
}

test("scan: full-repo baseline batch, source scan, turn null", () => {
  const tmp = setupRepo();
  try {
    const out = scan(tmp);
    assert.match(out, /^scan: 5 files, \d+ entities, \d+ edges, \d+ ms/);

    const events = readEvents(tmp);
    assert.ok(events.length > 0);
    for (const e of events) {
      assert.equal(e.source, "scan");
      assert.equal(e.turn, null);
      assert.equal(e.branch, "main");
      assert.ok(e.commit);
    }

    const observed = events.filter((e) => e.kind === "entity.observed").map((e) => e.entity.id);
    assert.ok(observed.includes("src/util.ts"));
    assert.ok(observed.includes("src/util.ts#add"));
    assert.ok(observed.includes("src/extra.ts"), "untracked-but-not-ignored file scanned");
    assert.ok(observed.includes("Sources/App.swift#App"));
    assert.ok(!observed.some((id) => id.startsWith("README")));

    // references from the whole-batch declared-type table
    const refs = events
      .filter((e) => e.kind === "edge.changed" && e.edge.type === "references" && e.change === "added")
      .map((e) => `${e.edge.from} -> ${e.edge.to}`)
      .sort();
    assert.deepEqual(refs, [
      "Sources/App.swift -> Sources/Models.swift",
      "Sources/App.swift -> Sources/Render.swift",
      "Sources/Render.swift -> Sources/Models.swift",
    ]);

    // state.json populated as the diff baseline, incl. the per-file type tables
    const state = JSON.parse(readFileSync(join(tmp, ".codemap", "state.json"), "utf8"));
    assert.ok(state.files["Sources/App.swift"]);
    assert.deepEqual(state.files["Sources/App.swift"].declaredTypes, ["App"]);
    assert.ok(state.files["Sources/App.swift"].typeRefs.includes("Renderer"));
    assert.ok(state.files["src/util.ts"]);
    assert.equal(state.files["src/util.ts"].declaredTypes, undefined);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

test("scan: re-scan emits only fresh observations, no phantom changes", () => {
  const tmp = setupRepo();
  try {
    scan(tmp);
    const before = readEvents(tmp).length;
    scan(tmp);
    const events = readEvents(tmp);
    const rescan = events.slice(before);
    assert.ok(rescan.length > 0, "re-scan re-observes everything");
    assert.ok(rescan.every((e) => e.kind === "entity.observed"), "no changed events on identical re-scan");
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

test("scan then stop-hook turn: diff lands against the scan baseline", () => {
  const tmp = setupRepo();
  try {
    scan(tmp);
    git(tmp, ["add", "-A"]);
    git(tmp, ["commit", "-qm", "baseline"]);
    const before = readEvents(tmp).length;

    // agent edits one scanned file: adds a method to Point
    const models = join(tmp, "Sources", "Models.swift");
    writeFileSync(
      models,
      readFileSync(models, "utf8").replace(
        "struct Size {",
        "struct Size {\n    func area() -> Double { w * h }",
      ),
    );
    execFileSync("node", [SHIM, "hook", "stop"], {
      input: JSON.stringify({ session_id: "s1", cwd: tmp, last_assistant_message: "added area helper" }),
      cwd: tmp,
      encoding: "utf8",
    });

    const turn = readEvents(tmp).slice(before);
    assert.ok(turn.length > 0);
    assert.ok(turn.every((e) => e.source === "agent-hook" && e.turn?.turn_id === 1));

    const changes = turn.filter((e) => e.kind === "entity.changed");
    const added = changes.filter((e) => e.change === "added").map((e) => e.entity_id);
    const modified = changes.filter((e) => e.change === "modified").map((e) => e.entity_id);
    // only the new method is added; the file and Size are modified vs the baseline,
    // and nothing already in the baseline re-registers as added
    assert.deepEqual(added, ["Sources/Models.swift#Size.area"]);
    assert.ok(modified.includes("Sources/Models.swift"));
    assert.ok(modified.includes("Sources/Models.swift#Size"));
    assert.ok(!added.includes("Sources/Models.swift#Point"));

    // references settled at scan time don't flap on an unrelated edit
    assert.equal(turn.filter((e) => e.kind === "edge.changed" && e.edge.type === "references").length, 0);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

test("turn moving a type between files reroutes untouched referrers", () => {
  const tmp = setupRepo();
  try {
    scan(tmp);
    const before = readEvents(tmp).length;

    // Mode moves out of Render.swift into its own file; App.swift (a Mode user) is untouched
    const render = join(tmp, "Sources", "Render.swift");
    const src = readFileSync(render, "utf8");
    const modeDecl = src.slice(src.indexOf("enum Mode"));
    writeFileSync(render, src.slice(0, src.indexOf("enum Mode")));
    writeFileSync(join(tmp, "Sources", "Mode.swift"), modeDecl);

    execFileSync("node", [SHIM, "hook", "stop"], {
      input: JSON.stringify({ session_id: "s1", cwd: tmp, last_assistant_message: "extracted Mode" }),
      cwd: tmp,
      encoding: "utf8",
    });

    const turn = readEvents(tmp).slice(before);
    const refChanges = turn
      .filter((e) => e.kind === "edge.changed" && e.edge.type === "references")
      .map((e) => `${e.change} ${e.edge.from} -> ${e.edge.to}`);
    assert.ok(refChanges.includes("added Sources/App.swift -> Sources/Mode.swift"), refChanges.join(", "));
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});
