// live codebase map — plain es module. shares decay + hierarchy + graph with the
// server (one implementation, served from /lib). d3/dagre are UMD globals.
import { glow, DECAY_TURNS } from "/lib/decay.js";
import { buildHierarchy } from "/lib/hierarchy.js";
import { buildGraphData, layoutGraph } from "/lib/graph.js";

const d3 = window.d3;
let lastState = null;
let viewMode = localStorage.getItem("codemap-view") || "map";
let graphExpand = null; // aggregation override: null = auto (>150 files groups by dir)
let graphHideTests = true; // test files shred the layout; hidden by default

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

// ---- view mode toggle ----
for (const btn of document.querySelectorAll("#view-toggle button")) {
  btn.classList.toggle("active", btn.dataset.mode === viewMode);
  btn.addEventListener("click", () => {
    viewMode = btn.dataset.mode;
    localStorage.setItem("codemap-view", viewMode);
    for (const b of document.querySelectorAll("#view-toggle button")) {
      b.classList.toggle("active", b.dataset.mode === viewMode);
    }
    tel({ type: "click", target: "view-" + viewMode });
    if (lastState) renderMapArea(lastState);
  });
}

// ---- render ----
function render(state) {
  lastState = state;
  renderClaimStrip(state);
  renderCvc(state);
  renderThisTurn(state);
  renderMapArea(state);
}

function renderMapArea(state) {
  const mapMode = viewMode === "map";
  document.getElementById("treemap").toggleAttribute("hidden", !mapMode);
  document.getElementById("graph").toggleAttribute("hidden", mapMode);
  // graph mode claims the viewport; the treemap keeps its compact panel
  document.getElementById("treemap-wrap").classList.toggle("graph-mode", !mapMode);
  if (mapMode) renderTreemap(state);
  else renderGraph(state);
}

function renderClaimStrip(state) {
  const line = $("#claim-line");
  const meta = $("#claim-meta");
  if (state.empty || !state.latestTurn) {
    // a scanned-but-never-agent-touched repo has entities but no turns
    line.innerHTML = state.entities && state.entities.length
      ? `<span class="empty">no agent turns yet — showing the scanned baseline. claims fill in when a turn lands.</span>`
      : `<span class="empty">no turns captured yet — the map fills in once the agent finishes a turn that changes code.</span>`;
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
  resizeTimer = setTimeout(() => {
    if (!lastState) return;
    if (viewMode === "map") {
      renderTreemap(lastState);
    } else if (!userZoomed) {
      // refit width unless the user has taken over the viewport
      graphFitted = false;
      renderGraph(lastState);
    }
  }, 150);
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

// ---- graph: dagre layered layout, dependency arrows, glow halo ----
let zoomBehavior = null;
let graphFitted = false;
let userZoomed = false;

function glowOf(seq, latestSeq) {
  return seq < 0 ? 0 : glow(latestSeq - seq);
}

function renderGraph(state) {
  const svg = d3.select("#graph");
  const root = d3.select("#graph-root");
  root.selectAll("*").remove();

  const files = state.entities
    .filter((e) => e.type === "file")
    .map((e) => ({ id: e.id, path: e.path, loc: e.loc, seq: e.lastTouchedSeq }));
  if (files.length === 0) {
    renderGraphLegend(null);
    return;
  }

  const opts = { hideTests: graphHideTests };
  if (graphExpand !== null) opts.aggregate = !graphExpand;
  const data = buildGraphData(files, state.edges, opts);
  const layout = layoutGraph(window.dagre, data);

  const latestSeq = state.turns.length ? state.turns[state.turns.length - 1].seq : 0;
  const interp = d3.interpolateRgb(cssVar("--grid"), cssVar("--glow-hot"));

  // fill = categorical color by directory group, fixed slot order by sorted
  // group name; groups past slot 8 fold to muted (never cycle hues)
  const groups = [...new Set(data.nodes.map((n) => n.group))].sort();
  const groupColor = (gr) => {
    const i = groups.indexOf(gr);
    return i >= 0 && i < 8 ? cssVar(`--cat-${i + 1}`) : cssVar("--muted");
  };

  // adjacency for hover highlight
  const nbr = new Map();
  const link = (a, b) => {
    if (!nbr.has(a)) nbr.set(a, new Set());
    nbr.get(a).add(b);
  };
  for (const e of layout.edges) {
    link(e.from, e.to);
    link(e.to, e.from);
  }

  const line = d3.line().x((p) => p.x).y((p) => p.y).curve(d3.curveBasis);
  root
    .selectAll("path.gedge")
    .data(layout.edges)
    .join("path")
    .attr("class", (d) => "gedge" + (d.types.includes("imports") ? "" : " references"))
    .attr("d", (d) => line(d.points))
    .attr("marker-end", "url(#arrow)");

  const g = root
    .selectAll("g.gnode")
    .data(layout.nodes)
    .join("g")
    .attr("class", "gnode")
    .attr("transform", (d) => `translate(${d.x - d.w / 2},${d.y - d.h / 2})`);

  g.append("rect")
    .attr("width", (d) => d.w)
    .attr("height", (d) => d.h)
    .attr("rx", 4)
    .attr("fill", (d) => groupColor(d.group))
    .attr("stroke", (d) => {
      const gl = glowOf(d.seq, latestSeq);
      return gl > 0 ? interp(gl) : cssVar("--hair");
    })
    .attr("stroke-width", (d) => {
      const gl = glowOf(d.seq, latestSeq);
      return gl > 0 ? 1.5 + 2.5 * gl : 1;
    });

  // label below the node: readable on the surface instead of fighting the fill
  // color inside small chips. 15ch at 10px fits the 58+44 rank pitch.
  g.append("text")
    .attr("x", (d) => d.w / 2)
    .attr("y", (d) => d.h + 12)
    .text((d) => (d.label.length > 15 ? d.label.slice(0, 14) + "…" : d.label));

  g.on("mouseenter", (ev, d) => {
    svg.classed("focus", true);
    root.selectAll("g.gnode").classed("hi", (n) => n.id === d.id || (nbr.get(d.id) ?? new Set()).has(n.id));
    root.selectAll("path.gedge").classed("hi", (e) => e.from === d.id || e.to === d.id);
  })
    .on("mouseleave", () => {
      svg.classed("focus", false);
      root.selectAll(".hi").classed("hi", false);
      hideTip();
    })
    .on("mousemove", (ev, d) => showGraphTip(ev, d, state))
    .on("click", (ev, d) => {
      if (d.files !== 1) return; // directory rollups have no file detail
      tel({ type: "click", target: "file" });
      openDetail(d.id);
    });

  // pan/zoom; transform survives SSE re-renders, refitted on structure toggles.
  // fit WIDTH only, never height — a tall layout is panned, not shrunk to confetti.
  const svgNode = svg.node();
  if (!zoomBehavior) {
    zoomBehavior = d3.zoom().scaleExtent([0.15, 4]).on("zoom", (ev) => {
      if (ev.sourceEvent) userZoomed = true; // manual pan/zoom wins over auto-refit
      root.attr("transform", ev.transform);
    });
    svg.call(zoomBehavior);
  }
  if (!graphFitted) {
    graphFitted = true;
    const vw = svgNode.clientWidth || 800;
    const k = Math.min(1, vw / (layout.width + 20));
    const tx = (vw - layout.width * k) / 2;
    svg.call(zoomBehavior.transform, d3.zoomIdentity.translate(Math.max(0, tx), 8).scale(k));
  }

  renderGraphLegend(data, layout.edges.length);
}

function renderGraphLegend(data, edgeCount) {
  let html =
    `<span class="edge-key"><span class="stroke"></span>imports</span>` +
    `<span class="edge-key"><span class="stroke dashed"></span>references</span>` +
    `<span>halo = touched recently</span>`;
  if (data) {
    html += `<span class="counts">${data.aggregated ? `${data.nodes.length} dirs` : `${data.fileCount} files`} · ${edgeCount} edges</span>`;
    if (data.hiddenTests > 0 || !graphHideTests) {
      html += `<button class="agg-toggle tests-toggle">${graphHideTests ? `show ${data.hiddenTests} test files` : "hide test files"}</button>`;
    }
    if (data.aggregated || data.fileCount > 150) {
      html += `<button class="agg-toggle expand-toggle">${data.aggregated ? `expand to ${data.fileCount} files` : "group by directory"}</button>`;
    }
  }
  $("#legend").innerHTML = html;
  const testsBtn = $("#legend .tests-toggle");
  if (testsBtn) {
    testsBtn.addEventListener("click", () => {
      graphHideTests = !graphHideTests;
      graphFitted = false; // structure change -> refit
      renderGraph(lastState);
    });
  }
  const expandBtn = $("#legend .expand-toggle");
  if (expandBtn && data) {
    expandBtn.addEventListener("click", () => {
      graphExpand = data.aggregated;
      graphFitted = false;
      renderGraph(lastState);
    });
  }
}

function showGraphTip(ev, d, state) {
  const sub = [];
  if (d.files !== 1) sub.push(`${d.files} files`);
  sub.push(`${d.loc} loc`);
  const e = state.entities.find((x) => x.id === d.id);
  if (e && e.lastTouchedSeq >= 0) sub.push(`touched ${relTime(e.lastTouchedTs)}`);
  tip.innerHTML = `<div class="tt-path">${esc(d.id)}</div><div class="tt-sub">${esc(sub.join(" · "))}</div>`;
  tip.hidden = false;
  tip.style.left = Math.min(ev.clientX + 12, window.innerWidth - 330) + "px";
  tip.style.top = ev.clientY + 12 + "px";
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
  const refsOut = state.edges.filter((e) => e.type === "references" && e.from === path);
  const refsIn = state.edges.filter((e) => e.type === "references" && e.to === path);
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

  // swift-style cross-file type references; only shown when present
  if (refsOut.length) {
    html += section("references", refsOut.map((e) => `<div class="edge-line">→ ${esc(e.to)}</div>`).join(""));
  }
  if (refsIn.length) {
    html += section("referenced by", refsIn.map((e) => `<div class="edge-line">← ${esc(e.from)}</div>`).join(""));
  }

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
