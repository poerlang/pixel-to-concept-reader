// 观察报告：加载视觉记忆 → 让任意一张图在 Buffer 里激活一段时间 → 导出可切换的 HTML。
//
// 激活只在读取侧进行：不新增信念，不训练，不改 memory/visual.bin。

import { readFileSync, writeFileSync } from "node:fs";
import { Bag } from "../src/nars/bag.ts";
import type { Term } from "../src/nars/term.ts";
import { VisualExperience } from "../src/visual/learn.ts";
import { episodeObservations } from "../src/visual/shift.ts";
import { askTrace } from "../src/visual/ask.ts";
import { evidenceFor, evidenceIndex, type EvidencePoint } from "./report-evidence.ts";
import { allFigures } from "./visual-fixtures.ts";
import type { Figure } from "../src/visual/types.ts";

const BUFFER_CAPACITY = 12;
const MAX_CYCLES = 10;

type Activation = {
  key: string;
  name: string;
  priority: number;
  durability: number;
  quality: number;
  hits: number;
};

type CycleReport = {
  index: number;
  order: Array<{ name: string; priority: number; key: string }>;
};

type TermReport = { term: string; label: string; count: number };

type ConceptReport = {
  key: string;
  name: string;
  hits: number;
  priority: number;
  features: number;
  matched: number;
  coverage: number;
  full: boolean;
  evidence: EvidencePoint[];
  vec: TermReport[];
  accel: TermReport[];
  closure: TermReport[];
  area: TermReport[];
  span: TermReport[];
};

type TargetReport = {
  id: string;
  name: string;
  svg: string;
  observations: number;
  episodes: number;
  neutral: boolean;
  steps: number;
  cycles: CycleReport[];
  stable: boolean;
  concepts: ConceptReport[];
};

const termName = (term: Term): string => {
  if (term.copula === "[]" && term.comps?.[0]) return termName(term.comps[0]);
  return term.key;
};

const decodeShift = (term: string): string => {
  const metric = /^shift_(area|span)_([\d.]+)$/.exec(term);
  if (metric) return `${metric[1]} ${metric[2]}`;
  const match = /^shift_(vec|accel|closure|point)_(\d)(?:_(\d))?$/.exec(term);
  if (!match) return term;
  const [, kind, a, b] = match;
  if (kind === "closure") {
    return `closure ${["closed", "partial", "open"][Number(a)] ?? a}`;
  }
  if (kind === "point") {
    return `coarse point mass bucket ${a}`;
  }
  const dirs = ["E", "SE", "S", "SW", "W", "NW", "N", "NE"];
  return `${kind === "vec" ? "vec" : "accel"} ${dirs[Number(a)] ?? a} · len ${b}`;
};

const escape = (value: string): string =>
  value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

const figureSvg = (figure: Figure): string => {
  const cells: string[] = [];
  for (let y = 0; y < 16; y++) {
    for (let x = 0; x < 16; x++) {
      if (!figure.grid[y * 16 + x]) continue;
      cells.push(`<rect x="${x}" y="${y}" width="1" height="1" fill="#f5f5f5"/>`);
    }
  }
  return `<svg viewBox="0 0 16 16" role="img" aria-label="${escape(figure.name)}" xmlns="http://www.w3.org/2000/svg"><rect width="16" height="16" fill="#050505"/>${cells.join("")}</svg>`;
};

const visual = VisualExperience.load();
const { simple, complex } = allFigures();
const targets = [...simple, ...complex];

// 词项 → 经验概念；经验概念 → 它的子表征。
const conceptTerms = new Map<string, Map<string, number>>();
const conceptFeatures = new Map<string, Set<string>>();
for (const belief of visual.memory.beliefs()) {
  const subject = belief.term.comps?.[0];
  const predicate = belief.term.comps?.[1];
  if (!subject || !predicate) continue;
  const term = termName(predicate);
  if (!/^shift_(vec|accel|closure|point|area|span)_/.test(term)) continue;
  const key = subject.key;
  if (!conceptTerms.has(key)) conceptTerms.set(key, new Map());
  const counts = conceptTerms.get(key)!;
  counts.set(term, (counts.get(term) ?? 0) + 1);
  // 面积/跨度是激活权重，不进入 AND 条件；否则采样一偏就整类不匹配。
  if (!/^shift_(area|span)_/.test(term)) {
    if (!conceptFeatures.has(key)) conceptFeatures.set(key, new Set());
    conceptFeatures.get(key)!.add(term);
  }
}

const nameOf = (key: string): string => visual.names.get(key) ?? key;

const activate = (figure: Figure): TargetReport => {
  const trace = askTrace(figure.grid);
  const observed = episodeObservations(trace).flat();
  const observedSet = new Set(observed);
  const buffer = new Bag<Activation>(BUFFER_CAPACITY);
  const cycles: CycleReport[] = [];
  let stableAt: number | null = null;
  let previousTop: string[] = [];

  for (let cycle = 0; cycle < MAX_CYCLES; cycle++) {
    for (const item of buffer.all()) item.priority *= 0.88;

    for (const [key, features] of conceptFeatures) {
      if (features.size === 0) continue;
      let matched = 0;
      for (const feature of features) if (observedSet.has(feature)) matched++;
      if (matched === 0) continue;
      const coverage = matched / features.size;
      let areaRatio = 0;
      for (const term of conceptTerms.get(key)?.keys() ?? []) {
        const match = /^shift_area_([\d.]+)$/.exec(term);
        if (match) areaRatio = Math.max(areaRatio, Number(match[1]));
      }
      const full = matched === features.size;
      const target = full
        ? Math.min(0.98, 0.3 + 0.5 * areaRatio + 0.02 * features.size)
        : 0.02 + 0.03 * coverage;
      const existing = buffer.all().find((item) => item.key === key);
      if (existing) {
        existing.priority = existing.priority * 0.65 + target * 0.35;
        existing.hits++;
      } else {
        buffer.put({
          key,
          name: nameOf(key),
          priority: target * 0.8,
          durability: 0.9,
          quality: 0.5,
          hits: 1,
        });
      }
    }

    const order = buffer.all()
      .sort((a, b) => b.priority - a.priority || b.hits - a.hits)
      .map((item) => ({ name: item.name, priority: item.priority, key: item.key }));
    cycles.push({ index: cycle + 1, order });

    const top = order.slice(0, Math.min(5, order.length)).map((item) => item.name);
    if (top.length === previousTop.length && top.every((name, i) => name === previousTop[i])) {
      if (stableAt === null) stableAt = cycle + 1;
    } else {
      stableAt = null;
    }
    previousTop = top;
    if (stableAt !== null && cycle + 1 - stableAt >= 2) break;
  }

  const finalOrder = buffer.all().sort((a, b) => b.priority - a.priority || b.hits - a.hits);
  const index = evidenceIndex(trace);
  const concepts: ConceptReport[] = finalOrder.map((item) => {
    const counts = conceptTerms.get(item.key) ?? new Map<string, number>();
    const terms = [...counts.entries()].sort((a, b) => b[1] - a[1]);
    const featureSet = conceptFeatures.get(item.key) ?? new Set<string>();
    const matchedFeatures = [...featureSet].filter((feature) => observedSet.has(feature));
    const matched = matchedFeatures.length;
    const pick = (prefix: string): TermReport[] => terms
      .filter(([term]) => term.startsWith(prefix))
      .slice(0, 4)
      .map(([term, count]) => ({ term, label: decodeShift(term), count }));
    return {
      key: item.key,
      name: item.name,
      hits: item.hits,
      priority: item.priority,
      features: featureSet.size,
      matched,
      coverage: featureSet.size ? matched / featureSet.size : 0,
      full: matched === featureSet.size,
      evidence: evidenceFor(index, matchedFeatures),
      vec: pick("shift_vec_"),
      accel: pick("shift_accel_"),
      closure: pick("shift_closure_"),
      area: pick("shift_area_"),
      span: pick("shift_span_"),
    };
  });

  return {
    id: figure.id,
    name: figure.name,
    svg: figureSvg(figure),
    observations: observed.length,
    episodes: trace.episodes.length,
    neutral: trace.steps.length === 0
      && trace.points.length === 1
      && (((trace.points[0] as { mass?: number }).mass ?? 0) >= 16 * 16),
    steps: trace.steps.length,
    cycles,
    stable: stableAt !== null,
    concepts,
  };
};

const reports = targets.map(activate);
const byId = new Map(reports.map((report) => [report.id, report]));
const initialId = byId.has("circle_1") ? "circle_1" : reports[0]!.id;
const initial = byId.get(initialId)!;
const bytes = readFileSync("memory/visual.bin").length;
const dataJson = JSON.stringify(Object.fromEntries(reports.map((report) => [report.id, report]))).replace(/</g, "\\u003c");

const TOOLTIPS = {
  vec: "SHIFT VEC：Shift 一步的相对矢量。方向归一化为 8 个方位，长度相对本 episode 的中位步长；不含绝对坐标。",
  accel: "SHIFT ACCEL：相邻两个 Shift 矢量之差。接近 0 表示近似直行，非 0 表示转向/曲率。",
  closure: "SHIFT CLOSURE：episode 首尾距离 / 路径长度。closed 接近闭合，partial 半开，open 接近开放链。",
  point: "COARSE POINT：没有第二步的单个粗点；记录质量档，用于小圆点等极小图形。",
  area: "AREA：粗点质量总和 / 16×16 感受野面积。它是 FULL 概念的激活权重之一。",
  span: "SPAN：粗点包围盒最大边 / 16。表示图形在感受野里的相对尺度。",
  full: "FULL：方向/长度/二阶差/闭合全部满足，按面积与覆盖数正常激活。",
  partial: "PARTIAL：只满足一部分子表征，只给极低优先级激活，不按完整候选处理。",
  hits: "HITS：该概念在 Buffer 激活周期里被命中的次数。",
  priority: "PRIORITY：Buffer 优先级。FULL 由面积/覆盖决定；PARTIAL 很低。",
  loaded: "LOADED CONCEPTS：从 memory/visual.bin 加载的视觉经验概念数。",
  observations: "SHIFT OBSERVATIONS：这次观察产生的相对 Shift 词项数。",
  episodes: "SHIFT EPISODES：Shift 轨迹被跳跃或方向断裂切成的段数；段之间不产生加速度。",
  cycles: "CYCLES：激活 Buffer 的轮数；直到排序相对稳定。",
  steps: "SHIFT STEPS：本次 Shift 的步数。",
  stable: "BUFFER STABLE：Buffer 排序是否连续保持稳定。",
  neutral: "NEUTRAL START：均匀场只有一个粗点、没有首选方向；不是所有图形概念都成立。",
  binary: "VISUAL.BIN：磁盘上的二进制视觉记忆快照。",
  timeline: "BUFFER TIMELINE：每个激活周期后 Buffer 的概念优先级排序；观察它是否收敛。",
  concepts: "CONCEPTS BY REPRESENTATION：按概念列出其相对矢量、二阶差、闭合、面积/跨度的显著子项。",
  reading: "READING：说明 FULL / PARTIAL 的激活规则；不是分类概率。",
} as const;

const buttons = reports.map((report) => `<button class="thumb${report.id === initialId ? " active" : ""}" data-id="${escape(report.id)}" type="button">
  <div class="thumb-image">${report.svg}</div>
  <span>${escape(report.name)}</span>
</button>`).join("\n");

const html = `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Shift Experience Report</title>
<style>
:root { color-scheme: dark; --bg:#08090b; --panel:#111318; --panel2:#0d0f13; --line:#252a33; --text:#e8e8ea; --muted:#8b93a1; --accent:#d8ff5f; }
* { box-sizing: border-box; }
body { margin:0; background:var(--bg); color:var(--text); font:14px/1.55 ui-monospace, SFMono-Regular, Consolas, monospace; }
h1 { font-size:clamp(20px,3vw,34px); line-height:1.1; margin:0 0 8px; letter-spacing:-.04em; }
h2 { font-size:13px; margin:26px 0 10px; color:var(--accent); text-transform:uppercase; letter-spacing:.08em; }
h3 { font-size:12px; margin:0 0 8px; color:var(--muted); }
h4 { font-size:10px; margin:0 0 6px; color:var(--muted); text-transform:uppercase; letter-spacing:.06em; }
p { color:var(--muted); }
.layout { display:grid; grid-template-columns:300px minmax(0,1fr); min-height:100vh; }
aside { border-right:1px solid var(--line); background:var(--panel2); padding:22px 16px 40px; overflow:auto; max-height:100vh; position:sticky; top:0; }
.brand { margin-bottom:20px; }
.brand p { margin:4px 0 0; font-size:11px; }
.thumbs { display:grid; grid-template-columns:1fr 1fr; gap:8px; }
.thumb { appearance:none; border:1px solid var(--line); background:var(--panel); color:var(--text); padding:6px; text-align:left; cursor:pointer; font:inherit; }
.thumb:hover { border-color:#4b5566; }
.thumb.active { border-color:var(--accent); background:#151a12; }
.thumb-image { background:#050505; margin-bottom:5px; }
.thumb-image svg { width:100%; display:block; image-rendering:pixelated; }
.thumb span { display:block; color:var(--muted); font-size:10px; line-height:1.3; }
.thumb.active span { color:var(--accent); }
main { padding:38px clamp(18px,4vw,54px) 72px; max-width:1100px; }
.hero { display:grid; grid-template-columns:220px 1fr; gap:24px; align-items:start; }
.image { background:var(--panel); border:1px solid var(--line); padding:10px; }
.image svg { width:100%; display:block; image-rendering:pixelated; }
.image svg .evidence-layer { pointer-events:none; }
.stats { display:grid; grid-template-columns:repeat(3,minmax(0,1fr)); gap:8px; margin-top:16px; }
.stat { border:1px solid var(--line); background:var(--panel); padding:10px; }
.stat b { display:block; font-size:18px; color:var(--accent); }
.stat span { color:var(--muted); font-size:10px; }
.hint { margin:8px 0 0; font-size:10px; color:var(--muted); }
.cycles { display:grid; grid-template-columns:repeat(3,minmax(0,1fr)) minmax(190px,1.16fr); gap:8px; }
.cycle { border:1px solid var(--line); background:var(--panel); padding:10px; }
.cycles tr[data-evidence] { cursor:crosshair; }
.cycles tr[data-evidence]:hover { background:#2a1718; box-shadow:inset 3px 0 #ff4b3e; }
table { width:100%; border-collapse:collapse; font-size:11px; }
th,td { text-align:left; padding:3px 5px; border-top:1px solid var(--line); }
th { color:var(--muted); font-weight:400; }
.card { display:grid; grid-template-columns:38px 1fr; gap:10px; border:1px solid var(--line); background:var(--panel); padding:12px; margin:8px 0; }
.rank { color:var(--accent); font-size:20px; line-height:1; }
.card-head { display:flex; gap:10px; flex-wrap:wrap; align-items:baseline; }
.meta { color:var(--muted); font-size:10px; }
.bar { height:3px; background:#222630; margin:8px 0 10px; }
.bar i { display:block; height:100%; background:var(--accent); }
.subs { display:grid; grid-template-columns:1fr 1fr; gap:16px; }
ul { list-style:none; margin:0; padding:0; }
li { display:flex; justify-content:space-between; gap:8px; padding:2px 0; border-bottom:1px solid #1b1f26; }
code { color:#cdd6e3; }
li span { color:var(--muted); }
.empty { color:var(--muted); }
.note { border-left:2px solid var(--accent); padding:9px 12px; color:var(--muted); background:#0d1013; }
[data-tip] { cursor:help; }
.term { border-bottom:1px dotted var(--muted); }
.tip { position:fixed; z-index:100; max-width:360px; padding:9px 11px; background:#161b22; color:#dbe4f0; border:1px solid #3a4658; box-shadow:0 12px 30px rgba(0,0,0,.45); font-size:12px; line-height:1.55; pointer-events:none; }
.tip[hidden] { display:none; }
@media (max-width:820px) { .layout { grid-template-columns:1fr; } aside { position:static; max-height:none; border-right:0; border-bottom:1px solid var(--line); } .thumbs { grid-template-columns:repeat(auto-fill,minmax(92px,1fr)); } .hero,.subs { grid-template-columns:1fr; } .stats { grid-template-columns:repeat(2,minmax(0,1fr)); } .cycles { grid-template-columns:1fr 1fr; } }
</style>
</head>
<body>
<div class="layout">
  <aside>
    <div class="brand"><h1>Shift Experience</h1><p>加载经验 · 点击图像切换</p></div>
    <h2>images</h2>
    <div class="thumbs">${buttons}</div>
  </aside>
  <main>
    <div class="hero">
      <div class="image" id="image">${initial.svg}</div>
      <div>
        <h1 id="title">${escape(initial.name)}</h1>
        <p>加载 <code>memory/visual.bin</code>；观察图，激活只读，不训练、不改写快照。</p>
        <div class="stats" id="stats"></div>
        <p class="hint">悬停下方 buffer timeline 的行：图像上的红色格子是这一行 Shift 证据到达的位置。</p>
      </div>
    </div>
    <h2 data-tip="${escape(TOOLTIPS.timeline)}">buffer timeline</h2>
    <div class="cycles" id="timeline"></div>
    <h2 data-tip="${escape(TOOLTIPS.concepts)}">concepts by representation</h2>
    <p>每个概念列出记忆中最常出现的相对矢量与二阶差；这是子表征，不是形状标签。</p>
    <div id="cards"></div>
    <h2 data-tip="${escape(TOOLTIPS.reading)}">reading</h2>
    <p class="note">方向/长度/二阶差/闭合全部满足 → 正常激活（FULL）；只满足一部分 → 极低激活（PARTIAL），不按完整候选处理。面积/跨度与子表征覆盖数决定完整激活的优先级。排序稳定只表示本次读取收敛，不写入 visual.bin。</p>
  </main>
</div>
<div class="tip" id="tip" role="tooltip" hidden></div>
<script>
const DATA = ${dataJson};
const MEMORY_CONCEPTS = ${visual.memory.size()};
const BINARY_KB = ${Math.round(bytes / 1024)};
const TIPS = ${JSON.stringify(TOOLTIPS)};
const selected = ${JSON.stringify(initialId)};

const esc = (value) => String(value).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const tipFor = (label) => label.startsWith('vec ') ? TIPS.vec : label.startsWith('accel ') ? TIPS.accel : label.startsWith('closure ') ? TIPS.closure : label.startsWith('area ') ? TIPS.area : label.startsWith('span ') ? TIPS.span : TIPS.point;
const sub = (list) => list.length ? list.map((item) => '<li><code class="term" data-tip="' + esc(tipFor(item.label)) + '">' + esc(item.label) + '</code><span>' + item.count + '</span></li>').join('') : '<li class="empty">—</li>';
const stat = (value, label, tip) => '<div class="stat" data-tip="' + esc(tip || label) + '"><b>' + esc(value) + '</b><span>' + esc(label) + '</span></div>';
const meta = (text, tip) => '<span class="term" data-tip="' + esc(tip) + '">' + esc(text) + '</span>';

function render(id) {
  const target = DATA[id];
  if (!target) return;
  if (window.parent !== window) window.parent.postMessage({ type: 'visual-select', id }, '*');
  document.querySelectorAll('.thumb').forEach((node) => node.classList.toggle('active', node.dataset.id === id));
  document.getElementById('title').textContent = target.name;
  document.getElementById('image').innerHTML = target.svg;
  currentEvidence = new Map(target.concepts.map((concept) => [concept.key, concept.evidence]));
  document.getElementById('stats').innerHTML = [
    stat(MEMORY_CONCEPTS, 'loaded concepts', TIPS.loaded),
    stat(target.observations, 'shift observations', TIPS.observations),
    stat(target.episodes, 'shift episodes', TIPS.episodes),
    stat(target.cycles.length, 'cycles', TIPS.cycles),
    stat(target.steps, 'shift steps', TIPS.steps),
    stat(target.stable ? 'yes' : 'no', 'buffer stable', TIPS.stable),
    stat(target.neutral ? 'yes' : 'no', 'neutral start', TIPS.neutral),
    stat(BINARY_KB + ' KB', 'visual.bin', TIPS.binary),
  ].join('');
  document.getElementById('timeline').innerHTML = target.cycles.map((cycle) => {
    const rows = cycle.order.slice(0, 6).map((item, index) => '<tr data-key="' + esc(item.key) + '"><td>' + (index + 1) + '</td><td>' + esc(item.name) + '</td><td>' + item.priority.toFixed(3) + '</td></tr>').join('');
    return '<section class="cycle"><h3 data-tip="' + esc(TIPS.cycles) + '">cycle ' + cycle.index + '</h3><table><thead><tr><th>#</th><th data-tip="' + esc(TIPS.priority) + '">concept</th><th data-tip="' + esc(TIPS.priority) + '">priority</th></tr></thead><tbody>' + rows + '</tbody></table></section>';
  }).join('');
  document.getElementById('cards').innerHTML = target.neutral
    ? '<p class="note">均匀场：没有首选方向。所有方向都是“可能的起点”，但没有一条被观测证据选中；所以这里不激活具体图形概念。</p>'
    : target.concepts.map((concept, index) => {
      const state = concept.full ? meta('FULL', TIPS.full) : meta('PARTIAL ' + concept.matched + '/' + concept.features, TIPS.partial);
      return '<article class="card"><div class="rank">' + (index + 1) + '</div><div class="card-main"><div class="card-head"><strong>' + esc(concept.name) + '</strong><span class="meta">' + esc(concept.key) + ' · ' + state + ' · ' + meta('hits ' + concept.hits, TIPS.hits) + ' · ' + meta('priority ' + concept.priority.toFixed(3), TIPS.priority) + '</span></div><div class="bar"><i style="width:' + Math.min(100, concept.priority * 100).toFixed(1) + '%"></i></div><div class="subs"><div><h4><span class="term" data-tip="' + esc(TIPS.vec) + '">SHIFT VEC</span> / 相对矢量</h4><ul>' + sub(concept.vec) + '</ul></div><div><h4><span class="term" data-tip="' + esc(TIPS.accel) + '">SHIFT ACCEL</span> / 二阶差</h4><ul>' + sub(concept.accel) + '</ul></div><div><h4><span class="term" data-tip="' + esc(TIPS.closure) + '">SHIFT CLOSURE</span> / 闭合</h4><ul>' + sub(concept.closure) + '</ul></div><div><h4><span class="term" data-tip="' + esc(TIPS.area) + '">AREA</span> / <span class="term" data-tip="' + esc(TIPS.span) + '">SPAN</span></h4><ul>' + sub(concept.area) + sub(concept.span) + '</ul></div></div></div></article>';
    }).join('');
}

const tip = document.getElementById('tip');
let pinned = false;
let pinnedEl = null;
let currentEvidence = new Map();

function clearEvidence() {
  const layer = document.querySelector('#image svg .evidence-layer');
  if (layer) layer.remove();
}

function showEvidence(key) {
  clearEvidence();
  const svg = document.querySelector('#image svg');
  const points = currentEvidence.get(key) || [];
  if (!svg || !points.length) return;
  const ns = 'http://www.w3.org/2000/svg';
  const layer = document.createElementNS(ns, 'g');
  layer.setAttribute('class', 'evidence-layer');
  for (const point of points) {
    const rect = document.createElementNS(ns, 'rect');
    rect.setAttribute('x', String(point.x - 0.5));
    rect.setAttribute('y', String(point.y - 0.5));
    rect.setAttribute('width', '1');
    rect.setAttribute('height', '1');
    rect.setAttribute('fill', '#ff3b30');
    rect.setAttribute('fill-opacity', '0.72');
    rect.setAttribute('stroke', '#ffb4ad');
    rect.setAttribute('stroke-width', '0.08');
    const title = document.createElementNS(ns, 'title');
    title.textContent = 'Shift 到达 (' + point.x.toFixed(1) + ', ' + point.y.toFixed(1) + ')';
    rect.appendChild(title);
    layer.appendChild(rect);
  }
  svg.appendChild(layer);
}

function showTip(el) {
  const text = el.getAttribute('data-tip');
  if (!text) return;
  tip.textContent = text;
  tip.hidden = false;
  const rect = el.getBoundingClientRect();
  const maxWidth = Math.min(360, window.innerWidth - 24);
  tip.style.maxWidth = maxWidth + 'px';
  const left = Math.min(window.innerWidth - maxWidth - 12, Math.max(12, rect.left));
  let top = rect.bottom + 8;
  if (top + tip.offsetHeight > window.innerHeight - 12) {
    top = Math.max(12, rect.top - tip.offsetHeight - 8);
  }
  tip.style.left = left + 'px';
  tip.style.top = top + 'px';
}

function hideTip() {
  tip.hidden = true;
}

document.addEventListener('mouseover', (event) => {
  const el = event.target.closest && event.target.closest('[data-tip]');
  if (el && !pinned) showTip(el);
});

document.addEventListener('mouseout', (event) => {
  if (event.target.closest && event.target.closest('[data-tip]') && !pinned) hideTip();
});

document.addEventListener('click', (event) => {
  const el = event.target.closest && event.target.closest('[data-tip]');
  if (el) {
    event.stopPropagation();
    if (pinned && pinnedEl === el) {
      pinned = false;
      pinnedEl = null;
      hideTip();
    } else {
      pinned = true;
      pinnedEl = el;
      showTip(el);
    }
  } else {
    pinned = false;
    pinnedEl = null;
    hideTip();
  }
});

document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape') {
    pinned = false;
    hideTip();
  }
});

document.addEventListener('scroll', () => {
  if (!pinned) hideTip();
}, true);

document.querySelectorAll('.thumb').forEach((button) => button.addEventListener('click', () => render(button.dataset.id)));

const timelineEl = document.getElementById('timeline');
timelineEl.addEventListener('mouseover', (event) => {
  const row = event.target.closest && event.target.closest('tr[data-key]');
  if (row) showEvidence(row.dataset.key);
});
timelineEl.addEventListener('mouseout', (event) => {
  const row = event.target.closest && event.target.closest('tr[data-key]');
  if (row && !row.contains(event.relatedTarget)) clearEvidence();
});
timelineEl.addEventListener('mouseleave', clearEvidence);

render(selected);
</script>
</body>
</html>`;

writeFileSync("test_report.html", html, "utf8");
console.log("report: test_report.html");
console.log(`targets: ${reports.length}`);
console.log(`initial: ${initial.id} ${initial.name}`);
console.log(`memory: ${visual.memory.size()} concepts / ${bytes} bytes`);
