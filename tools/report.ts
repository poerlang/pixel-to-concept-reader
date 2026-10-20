// 观察报告：加载视觉记忆 → 让任意一张图在 Buffer 里激活一段时间 → 导出可切换的 HTML。
//
// 激活只在读取侧进行：不新增信念，不训练，不改 memory/visual.bin。

import { readFileSync, writeFileSync } from "node:fs";
import { Bag } from "../src/nars/bag.ts";
import type { Term } from "../src/nars/term.ts";
import { VisualExperience } from "../src/visual/learn.ts";
import { episodeObservations, traceShift } from "../src/visual/shift.ts";
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
  order: Array<{ name: string; priority: number }>;
};

type TermReport = { term: string; label: string; count: number };

type ConceptReport = {
  key: string;
  name: string;
  hits: number;
  priority: number;
  features: number;
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
  const match = /^shift_(vec|accel|closure)_(\d)(?:_(\d))?$/.exec(term);
  if (!match) return term;
  const [, kind, a, b] = match;
  if (kind === "closure") {
    return `closure ${["closed", "partial", "open"][Number(a)] ?? a}`;
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
  if (!/^shift_(vec|accel|closure|area|span)_/.test(term)) continue;
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
  const trace = traceShift(figure.grid);
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
      if (![...features].every((feature) => observedSet.has(feature))) continue;
      let areaRatio = 0;
      for (const term of conceptTerms.get(key)?.keys() ?? []) {
        const match = /^shift_area_([\d.]+)$/.exec(term);
        if (match) areaRatio = Math.max(areaRatio, Number(match[1]));
      }
      const target = Math.min(0.95, 0.4 + 2.5 * areaRatio + 0.02 * features.size);
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
      .map((item) => ({ name: item.name, priority: item.priority }));
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
  const concepts: ConceptReport[] = finalOrder.map((item) => {
    const counts = conceptTerms.get(item.key) ?? new Map<string, number>();
    const terms = [...counts.entries()].sort((a, b) => b[1] - a[1]);
    const pick = (prefix: string): TermReport[] => terms
      .filter(([term]) => term.startsWith(prefix))
      .slice(0, 4)
      .map(([term, count]) => ({ term, label: decodeShift(term), count }));
    return {
      key: item.key,
      name: item.name,
      hits: item.hits,
      priority: item.priority,
      features: conceptFeatures.get(item.key)?.size ?? 0,
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
    neutral: trace.steps.length === 0,
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
.stats { display:grid; grid-template-columns:repeat(3,minmax(0,1fr)); gap:8px; margin-top:16px; }
.stat { border:1px solid var(--line); background:var(--panel); padding:10px; }
.stat b { display:block; font-size:18px; color:var(--accent); }
.stat span { color:var(--muted); font-size:10px; }
.cycles { display:grid; grid-template-columns:repeat(auto-fit,minmax(170px,1fr)); gap:8px; }
.cycle { border:1px solid var(--line); background:var(--panel); padding:10px; }
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
@media (max-width:820px) { .layout { grid-template-columns:1fr; } aside { position:static; max-height:none; border-right:0; border-bottom:1px solid var(--line); } .thumbs { grid-template-columns:repeat(auto-fill,minmax(92px,1fr)); } .hero,.subs { grid-template-columns:1fr; } .stats { grid-template-columns:repeat(2,minmax(0,1fr)); } }
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
      </div>
    </div>
    <h2>buffer timeline</h2>
    <div class="cycles" id="timeline"></div>
    <h2>concepts by representation</h2>
    <p>每个概念列出记忆中最常出现的相对矢量与二阶差；这是子表征，不是形状标签。</p>
    <div id="cards"></div>
    <h2>reading</h2>
    <p class="note">概念的全部方向/长度/二阶差/闭合子表征都满足（AND）才进入 Buffer；面积/跨度与子表征覆盖数决定激活优先级。排序稳定只表示本次读取收敛，不写入 visual.bin。</p>
  </main>
</div>
<script>
const DATA = ${dataJson};
const MEMORY_CONCEPTS = ${visual.memory.size()};
const BINARY_KB = ${Math.round(bytes / 1024)};
const selected = ${JSON.stringify(initialId)};

const esc = (value) => String(value).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const sub = (list) => list.length ? list.map((item) => '<li><code>' + esc(item.label) + '</code><span>' + item.count + '</span></li>').join('') : '<li class="empty">—</li>';
const stat = (value, label) => '<div class="stat"><b>' + esc(value) + '</b><span>' + esc(label) + '</span></div>';

function render(id) {
  const target = DATA[id];
  if (!target) return;
  document.querySelectorAll('.thumb').forEach((node) => node.classList.toggle('active', node.dataset.id === id));
  document.getElementById('title').textContent = target.name;
  document.getElementById('image').innerHTML = target.svg;
  document.getElementById('stats').innerHTML = [
    stat(MEMORY_CONCEPTS, 'loaded concepts'),
    stat(target.observations, 'shift observations'),
    stat(target.episodes, 'shift episodes'),
    stat(target.cycles.length, 'cycles'),
    stat(target.steps, 'shift steps'),
    stat(target.stable ? 'yes' : 'no', 'buffer stable'),
    stat(target.neutral ? 'yes' : 'no', 'neutral start'),
    stat(BINARY_KB + ' KB', 'visual.bin'),
  ].join('');
  document.getElementById('timeline').innerHTML = target.cycles.map((cycle) => {
    const rows = cycle.order.slice(0, 6).map((item, index) => '<tr><td>' + (index + 1) + '</td><td>' + esc(item.name) + '</td><td>' + item.priority.toFixed(3) + '</td></tr>').join('');
    return '<section class="cycle"><h3>cycle ' + cycle.index + '</h3><table><thead><tr><th>#</th><th>concept</th><th>priority</th></tr></thead><tbody>' + rows + '</tbody></table></section>';
  }).join('');
  document.getElementById('cards').innerHTML = target.neutral
    ? '<p class="note">均匀场：没有首选方向。所有方向都是“可能的起点”，但没有一条被观测证据选中；所以这里不激活具体图形概念。</p>'
    : target.concepts.map((concept, index) => {
      return '<article class="card"><div class="rank">' + (index + 1) + '</div><div class="card-main"><div class="card-head"><strong>' + esc(concept.name) + '</strong><span class="meta">' + esc(concept.key) + ' · AND ' + concept.features + ' · hits ' + concept.hits + ' · priority ' + concept.priority.toFixed(3) + '</span></div><div class="bar"><i style="width:' + Math.min(100, concept.priority * 100).toFixed(1) + '%"></i></div><div class="subs"><div><h4>相对矢量 shift_vec</h4><ul>' + sub(concept.vec) + '</ul></div><div><h4>二阶差 shift_accel</h4><ul>' + sub(concept.accel) + '</ul></div><div><h4>闭合 shift_closure</h4><ul>' + sub(concept.closure) + '</ul></div><div><h4>面积 / 跨度</h4><ul>' + sub(concept.area) + sub(concept.span) + '</ul></div></div></div></article>';
    }).join('');
}

document.querySelectorAll('.thumb').forEach((button) => button.addEventListener('click', () => render(button.dataset.id)));
render(selected);
</script>
</body>
</html>`;

writeFileSync("test_report.html", html, "utf8");
console.log("report: test_report.html");
console.log(`targets: ${reports.length}`);
console.log(`initial: ${initial.id} ${initial.name}`);
console.log(`memory: ${visual.memory.size()} concepts / ${bytes} bytes`);
