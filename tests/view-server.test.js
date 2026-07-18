import { test } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, appendFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { startServer } from "../dist/view/server.js";

const here = dirname(fileURLToPath(import.meta.url));
const FIXTURE = readFileSync(join(here, "fixtures", "view-events.jsonl"), "utf8");

// a turn-4 batch that adds a brand new file
const GROWTH =
  `{"v":0,"id":"evt_t4_01","ts":"2026-07-18T10:15:00Z","source":"agent-hook","turn":{"session_id":"sess-alpha","turn_id":4},"branch":"main","commit":"c4ddddd","kind":"entity.observed","entity":{"id":"src/c.ts","type":"file","path":"src/c.ts","name":"c.ts","span":[1,3],"loc":3}}\n` +
  `{"v":0,"id":"evt_t4_02","ts":"2026-07-18T10:15:00Z","source":"agent-hook","turn":{"session_id":"sess-alpha","turn_id":4},"branch":"main","commit":"c4ddddd","kind":"entity.changed","change":"added","entity_id":"src/c.ts","delta_loc":3}\n`;

function seedRepo() {
  const repo = mkdtempSync(join(tmpdir(), "codemap-view-"));
  const codemap = join(repo, ".codemap");
  mkdirSync(codemap, { recursive: true });
  writeFileSync(join(codemap, "events.jsonl"), FIXTURE);
  return { repo, codemap };
}

test("/api/state serves the derived replay", async () => {
  const { repo } = seedRepo();
  const srv = await startServer({ repoRoot: repo, port: 0 });
  try {
    const state = await fetch(`${srv.url}/api/state`).then((r) => r.json());
    assert.equal(state.entities.length, 5);
    assert.equal(state.turns.length, 3);
    assert.equal(state.latestTurn.turn.turn_id, 3);
    assert.equal(state.latestTurn.claim.best.origin, "map-note");
  } finally {
    await srv.close();
    rmSync(repo, { recursive: true, force: true });
  }
});

test("/api/telemetry appends body + server ts to telemetry.jsonl", async () => {
  const { repo, codemap } = seedRepo();
  const srv = await startServer({ repoRoot: repo, port: 0 });
  try {
    const res = await fetch(`${srv.url}/api/telemetry`, {
      method: "POST",
      body: JSON.stringify({ type: "open" }),
    });
    assert.equal(res.status, 204);
    const res2 = await fetch(`${srv.url}/api/telemetry`, {
      method: "POST",
      body: JSON.stringify({ type: "click", target: "file" }),
    });
    assert.equal(res2.status, 204);

    const lines = readFileSync(join(codemap, "telemetry.jsonl"), "utf8").trim().split("\n").map((l) => JSON.parse(l));
    assert.equal(lines.length, 2);
    assert.equal(lines[0].type, "open");
    assert.ok(lines[0].server_ts, "server stamps a ts");
    assert.equal(lines[1].target, "file");
  } finally {
    await srv.close();
    rmSync(repo, { recursive: true, force: true });
  }
});

test("SSE pushes fresh derived state when events.jsonl grows", async () => {
  const { repo, codemap } = seedRepo();
  const srv = await startServer({ repoRoot: repo, port: 0 });
  try {
    const frames = await new Promise((resolve, reject) => {
      const got = [];
      let appended = false;
      const timer = setTimeout(() => {
        req.destroy();
        reject(new Error(`timed out; got ${got.length} sse frame(s)`));
      }, 5000);
      const req = http.get(`${srv.url}/api/events`, (res) => {
        res.setEncoding("utf8");
        let buf = "";
        res.on("data", (chunk) => {
          buf += chunk;
          let i;
          while ((i = buf.indexOf("\n\n")) !== -1) {
            const raw = buf.slice(0, i);
            buf = buf.slice(i + 2);
            const dl = raw.split("\n").find((l) => l.startsWith("data: "));
            if (!dl) continue;
            got.push(JSON.parse(dl.slice(6)));
            if (got.length === 1 && !appended) {
              appended = true;
              // grow the log after the initial frame
              appendFileSync(join(codemap, "events.jsonl"), GROWTH);
            } else if (got.length >= 2) {
              clearTimeout(timer);
              req.destroy();
              resolve(got);
            }
          }
        });
      });
      req.on("error", () => {});
    });

    assert.equal(frames[0].turns.length, 3, "initial frame is the seeded 3 turns");
    assert.equal(frames[1].turns.length, 4, "growth frame carries the new turn");
    assert.equal(frames[1].latestTurn.turn.turn_id, 4);
    assert.ok(frames[1].entities.some((e) => e.id === "src/c.ts"));
  } finally {
    await srv.close();
    rmSync(repo, { recursive: true, force: true });
  }
});
