// live codebase map — plain es module. shares decay + hierarchy with the server
// (one implementation, served from /lib). d3 is the UMD global from /lib/d3.min.js.
import { glow, DECAY_TURNS } from "/lib/decay.js";
import { buildHierarchy } from "/lib/hierarchy.js";

const d3 = window.d3;
let lastState = null;

// ---- helpers ----
const $ = (sel) => document.querySelector(sel);
function esc(s) {
  return String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
}
function cssVar(name) {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}
function shortSid(s) {
  return s ? s.slice(0, 6) : "—";
}
function relTime(ts) {
  const then = Date.parse(ts);
  if (!Number.isFinite(then)) return "";
  const s = Math.max(0, Math.round((Date.now() - then) / 1000));
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}
const GLYPH = { added: "+", modified: "~", removed: "−" };

// ---- telemetry (step 5) ----
function tel(obj) {
  try {
    fetch("/api/telemetry", { method: "POST", body: JSON.stringify(obj), keepalive: true });
  } catch {
    /* best-effort */
  }
}
let hb = null;
function startHeartbeat() {
  if (hb) return;
  hb = setInterval(() => {
    if (document.visibilityState === "visible") tel({ type: "heartbeat", visible: true });
  }, 15000);
}
function stopHeartbeat() {
  if (hb) clearInterval(hb), (hb = null);
}
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible") {
    tel({ type: "visible" });
    startHeartbeat();
  } else {
    tel({ type: "hidden" });
    stopHeartbeat();
  }
});
// panel clicks
for (const el of document.querySelectorAll("[data-tel=panel]")) {
  el.addEventListener("click", () => tel({ type: "click", target: "panel" }));
}
tel({ type: "open" });
startHeartbeat();

// ---- data feed: SSE (initial frame + growth pushes) ----
function connect() {
  const es = new EventSource("/api/events");
  es.onmessage = (e) => {
    try {
      render(JSON.parse(e.data));
    } catch {
      /* ignore bad frame */
    }
  };
  es.onerror = () => {}; // browser auto-reconnects using our retry hint
}
// initial paint doesn't wait on the stream
fetch("/api/state")
  .then((r) => r.json())
  .then(render)
  .catch(() => {});
connect();

// ---- render ----
function render(state) {
  lastState = state;
  renderClaimStrip(state);
  renderCvc(state);
  renderThisTurn(state);
  renderTreemap(state);
}

function renderClaimStrip(state) {
  const line = $("#claim-line");
  const meta = $("#claim-meta");
  if (state.empty || !state.latestTurn) {
    line.innerHTML = `<span class="empty">no turns captured yet — the map fills in once the agent finishes a turn that changes code.</span>`;
    meta.innerHTML = "";
    return;
  }
  const t = state.latestTurn;
  const claim = t.claim.best;
  line.innerHTML = claim
    ? `<span class="origin-tag ${esc(claim.origin)}">${claim.origin === "map-note" ? "map note" : "turn text"}</span>${esc(claim.text)}`
    : `<span class="empty">(no annotation for this turn)</span>`;
  meta.innerHTML = [
    `turn <b>${esc(t.turn.turn_id)}</b>`,
    `session <b>${esc(shortSid(t.turn.session_id))}</b>`,
    `branch <b>${esc(t.turn.branch ?? "—")}</b>`,
    `commit <b>${esc(t.turn.commit ?? "—")}</b>`,
    `<span class="fresh" data-ts="${esc(t.turn.ts)}">captured ${esc(relTime(t.turn.ts))}</span>`,
  ].join("");
}

function renderCvc(state) {
  const claimBody = $("#claim-body");
  const changeBody = $("#change-body");
  if (!state.latestTurn) {
    claimBody.innerHTML = `<div class="none">—</div>`;
    changeBody.innerHTML = `<div class="none">—</div>`;
    return;
  }
  const t = state.latestTurn;

  // left: the claim(s), both origins labelled — the origin comparison is the experiment
  const parts = [];
  if (t.claim.mapNote) parts.push(claimItem("map-note", "map note", t.claim.mapNote));
  if (t.claim.turnText) parts.push(claimItem("turn-text", "turn text", t.claim.turnText));
  claimBody.innerHTML = parts.length ? parts.join("") : `<div class="none">no claim recorded this turn</div>`;

  // right: what actually changed
  changeBody.innerHTML = renderChanges(t);
}

function claimItem(cls, label, a) {
  const targets = a.targets && a.targets.length ? `<div class="claim-targets">${esc(a.targets.join(", "))}</div>` : "";
  return `<div class="claim-item"><span class="origin-tag ${cls}">${label}</span><span class="claim-text">${esc(a.text)}</span>${targets}</div>`;
}

function renderChanges(t) {
  const byFile = new Map();
  for (const c of t.entityChanges) {
    if (!byFile.has(c.path)) byFile.set(c.path, []);
    byFile.get(c.path).push(c);
  }
  let html = "";
  if (byFile.size === 0) {
    html += `<div class="none">no entity changes</div>`;
  } else {
    for (const [file, changes] of [...byFile.entries()].sort()) {
      html += `<div class="file-group"><div class="file-name">${esc(file)}</div>`;
      for (const c of changes) {
        const isFile = !c.entity_id.includes("#");
        const label = isFile ? "file" : "";
        const delta = c.delta_loc ? `${c.delta_loc > 0 ? "+" : ""}${c.delta_loc} loc` : "";
        html += `<div class="chg ${esc(c.change)}"><span class="glyph">${GLYPH[c.change]}</span>` +
          `<span class="cname">${esc(c.name)}</span>` +
          `<span class="clabel">${esc(c.change)}${label ? " · " + label : ""}</span>` +
          `<span class="delta">${esc(delta)}</span></div>`;
      }
      html += `</div>`;
    }
  }

  if (t.edgeChanges.length) {
    html += `<div class="edges-head">edges</div>`;
    for (const e of t.edgeChanges) {
      html += `<div class="edge ${esc(e.change)}">${e.change === "added" ? "+" : "−"} ${esc(e.from)} <span class="arrow">→</span> ${esc(e.to)} <span class="arrow">(${esc(e.type)})</span></div>`;
    }
  }
  return html;
}

function renderThisTurn(state) {
  const list = $("#this-turn-list");
  if (!state.latestTurn || state.latestTurn.touchedFiles.length === 0) {
    list.innerHTML = `<li style="border:none;color:var(--muted);cursor:default">nothing touched</li>`;
    return;
  }
  list.innerHTML = state.latestTurn.touchedFiles
    .map((f) => `<li data-path="${esc(f)}">${esc(f)}</li>`)
    .join("");
  for (const li of list.querySelectorAll("li[data-path]")) {
    li.addEventListener("click", () => openDetail(li.dataset.path));
  }
}

// ---- treemap: stable ordered layout, glow overlay ----
let resizeTimer = null;
window.addEventListener("resize", () => {
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(() => lastState && renderTreemap(lastState), 150);
});

function renderTreemap(state) {
  const svg = d3.select("#treemap");
  const node = svg.node();
  const width = node.clientWidth || 800;
  const height = node.clientHeight || 460;
  svg.selectAll("*").remove();

  const files = state.entities.filter((e) => e.type === "file").map((e) => ({ id: e.id, path: e.path, loc: e.loc }));
  if (files.length === 0) return;

  const latestSeq = state.turns.length ? state.turns[state.turns.length - 1].seq : 0;
  const touched = new Set(state.latestTurn ? state.latestTurn.touchedFiles : []);
  const seqById = new Map(state.entities.map((e) => [e.id, e.lastTouchedSeq]));

  const rootData = buildHierarchy(files);
  // no .sort() -> children keep path order (stability). area = current loc.
  const root = d3.hierarchy(rootData).sum((d) => (d.children ? 0 : Math.max(1, d.loc)));
  d3.treemap().tile(d3.treemapSquarify).size([width, height]).paddingInner(1)(root);

  const interp = d3.interpolateRgb(cssVar("--tile"), cssVar("--glow-hot"));
  const leaves = root.leaves().filter((l) => l.data.id);

  const g = svg.selectAll("g.cell").data(leaves).join("g").attr("class", "cell").attr("transform", (d) => `translate(${d.x0},${d.y0})`);

  g.append("rect")
    .attr("class", (d) => "leaf" + (touched.has(d.data.path) ? " touched" : ""))
    .attr("width", (d) => Math.max(0, d.x1 - d.x0))
    .attr("height", (d) => Math.max(0, d.y1 - d.y0))
    .attr("fill", (d) => {
      const seq = seqById.has(d.data.id) ? seqById.get(d.data.id) : -1;
      const distance = seq < 0 ? DECAY_TURNS : latestSeq - seq;
      return interp(glow(distance));
    })
    .on("mousemove", (ev, d) => showTip(ev, d, state))
    .on("mouseleave", hideTip)
    .on("click", (ev, d) => {
      tel({ type: "click", target: "file" });
      openDetail(d.data.path);
    });

  // label only tiles big enough to read
  g.filter((d) => d.x1 - d.x0 > 46 && d.y1 - d.y0 > 16)
    .append("text")
    .attr("class", "leaf-label")
    .attr("x", 4)
    .attr("y", 12)
    .text((d) => d.data.name);

  $("#legend").innerHTML = `older <span class="ramp"></span> touched this turn · decays over ${DECAY_TURNS} turns`;
}

// ---- tooltip ----
const tip = $("#tooltip");
function showTip(ev, d, state) {
  const e = state.entities.find((x) => x.id === d.data.id);
  const fresh = e ? relTime(e.lastTouchedTs) : "";
  tip.innerHTML = `<div class="tt-path">${esc(d.data.path)}</div><div class="tt-sub">${esc(d.data.loc)} loc${fresh ? " · touched " + esc(fresh) : ""}</div>`;
  tip.hidden = false;
  tip.style.left = Math.min(ev.clientX + 12, window.innerWidth - 330) + "px";
  tip.style.top = ev.clientY + 12 + "px";
}
function hideTip() {
  tip.hidden = true;
}

// ---- detail sidebar ----
$("#detail-close").addEventListener("click", () => ($("#detail").hidden = true));
function openDetail(path) {
  const state = lastState;
  if (!state) return;
  const syms = state.entities
    .filter((e) => e.path === path && e.type !== "file")
    .sort((a, b) => a.span[0] - b.span[0]);
  const importsOut = state.edges.filter((e) => e.type === "imports" && e.from === path);
  const importsIn = state.edges.filter((e) => e.type === "imports" && e.to === path);
  const annos = state.annotations
    .filter((a) => (a.targets || []).includes(path))
    .sort((a, b) => (a.ts < b.ts ? 1 : -1));

  let html = `<h3>${esc(path)}</h3>`;

  html += section("symbols", syms.length
    ? syms.map((s) => `<div class="sym"><span><span class="stype">${esc(s.type)}</span> ${esc(s.name)}</span><span class="sloc">${esc(s.loc)} loc</span></div>`).join("")
    : `<div class="none">no symbols</div>`);

  html += section("imports out", importsOut.length
    ? importsOut.map((e) => `<div class="edge-line">→ ${esc(e.to)}</div>`).join("")
    : `<div class="none">none</div>`);

  html += section("imported by", importsIn.length
    ? importsIn.map((e) => `<div class="edge-line">← ${esc(e.from)}</div>`).join("")
    : `<div class="none">none</div>`);

  html += section("recent annotations", annos.length
    ? annos.slice(0, 8).map((a) => `<div class="anno"><div class="anno-text"><span class="origin-tag ${esc(a.origin)}">${a.origin === "map-note" ? "map note" : "turn text"}</span>${esc(a.text)}</div><div class="prov">turn ${esc(shortSid(a.session_id))}/${esc(a.turn_id)} · ${esc(a.commit ?? "—")} · ${esc(relTime(a.ts))}</div></div>`).join("")
    : `<div class="none">none</div>`);

  $("#detail-body").innerHTML = html;
  $("#detail").hidden = false;
}
function section(title, inner) {
  return `<div class="d-section"><h4>${esc(title)}</h4>${inner}</div>`;
}

// ---- freshness stamp ticks every second ----
setInterval(() => {
  const el = document.querySelector(".fresh[data-ts]");
  if (el) el.textContent = `captured ${relTime(el.dataset.ts)}`;
}, 1000);
