// 粗点演算动画：为测试报告里的所有图像准备只读数据，并合成单文件页面。
//
// 父页面（test_report_v3.html）选中图像后，通过 postMessage 切换当前图像；
// 独立打开时也可以用下拉框切换。

import { writeFileSync } from "node:fs";
import { VisualPulse, enclosingCircle } from "../src/visual/ask.ts";
import type { AskReport } from "../src/visual/ask.ts";
import type { Point } from "../src/visual/shift.ts";
import { allFigures } from "./visual-fixtures.ts";

type CompactReport = [number, number, number, number, number];

type FigureData = {
  id: string;
  name: string;
  grid: number[];
  asks: Array<{
    ask: number;
    seed: Point;
    center: Point;
    mass: number;
    anchors: Point[];
    selected: Point[];
    average: Point;
    centroid: Point;
    vector: Point;
    reports: CompactReport[];
  }>;
};

const figures = [...allFigures().simple, ...allFigures().complex];
const data: Record<string, FigureData> = {};

for (const figure of figures) {
  const pulse = new VisualPulse(figure.grid, 16, { maxSteps: 2400, coarseSpacing: 1.5, interiorOnly: true });
  pulse.run(2400);
  data[figure.id] = {
    id: figure.id,
    name: figure.name,
    grid: figure.grid,
    asks: pulse.coarsePoints.map((entry) => ({
      ask: entry.ask,
      seed: entry.seed,
      center: entry.center,
      mass: entry.mass,
      anchors: entry.anchors,
      selected: entry.selected,
      average: entry.average,
      centroid: entry.centroid,
      vector: entry.vector,
      reports: entry.reports.map((report: AskReport): CompactReport => [
        report.at.x,
        report.at.y,
        report.satisfied ? 1 : 0,
        report.depth,
        report.validAnchor ? 1 : 0,
      ]),
    })),
  };
}

const defaultId = data.thick_ring_4 ? "thick_ring_4" : Object.keys(data)[0]!;
const figureOptions = Object.values(data)
  .map((figure) => `<option value="${figure.id}">${figure.name}</option>`)
  .join("");

const html = `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>粗点演算</title>
<style>
:root{color-scheme:dark;--bg:#08090b;--panel:#111318;--line:#252a33;--text:#e8e8ea;--muted:#8b93a1;--accent:#d8ff5f;--route:#ff9a92;--blue:#6ecbff;--red:#ff4b3e}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--text);font:14px/1.6 ui-monospace,SFMono-Regular,Consolas,monospace}
main{max-width:1180px;margin:0 auto;padding:28px 22px 60px}
header{border-bottom:1px solid var(--line);padding-bottom:14px;margin-bottom:20px}
h1{font-size:clamp(22px,4vw,38px);line-height:1.1;margin:0 0 6px;letter-spacing:-.04em}
h1 small{font-size:14px;color:var(--accent)}
p{color:var(--muted);margin:0}
a{color:var(--accent)}
.wrap{display:grid;grid-template-columns:minmax(280px,430px) minmax(0,1fr);gap:20px;align-items:start}
.board{background:#050505;border:1px solid var(--line);padding:10px}
.board svg{width:100%;display:block;image-rendering:pixelated}
.info{border:1px solid var(--line);background:var(--panel);padding:14px}
.info h2{font-size:13px;margin:0 0 10px;color:var(--accent);text-transform:uppercase;letter-spacing:.08em}
.meta{color:var(--muted);font-size:11px;margin-bottom:10px}
.term{display:inline-block;border:1px solid #3a4658;background:#161b22;padding:2px 6px;margin:2px 4px 2px 0;color:var(--accent);font-size:11px}
.formula{border-top:1px solid var(--line);padding-top:10px;margin-top:10px}
.formula h3{font-size:11px;color:var(--muted);text-transform:uppercase;letter-spacing:.08em;margin:12px 0 4px}
.formula pre{margin:0;white-space:pre-wrap;color:#cdd6e3;font-size:11px;line-height:1.65}
.formula .dim{color:var(--muted)}
.formula .hot{color:var(--red)}
.controls{display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin-top:16px}
button{appearance:none;border:1px solid #3a4658;background:#151a21;color:var(--text);padding:7px 12px;cursor:pointer;font:inherit}
button:hover{border-color:var(--accent)}
select{appearance:none;border:1px solid #3a4658;background:#151a21;color:var(--text);padding:7px 10px;font:inherit;max-width:260px}
input[type=range]{accent-color:var(--accent);width:min(100%,420px)}
.legend{color:var(--muted);font-size:10px;margin-top:8px}
.legend i{display:inline-block;width:8px;height:8px;border-radius:50%;margin:0 4px 0 10px;vertical-align:middle}
@media(max-width:760px){.wrap{grid-template-columns:1fr}}
</style>
</head>
<body>
<main>
<header>
<h1>粗点演算 <small id="figure-name"></small></h1>
<p>用满足点的局部协方差求笔画切向；沿法向取两侧最近的合法边界点，用两侧中点/半径画圆。询问点在中央或贴边都不会只取半条笔画。</p>
</header>
<div class="wrap">
  <div>
    <div class="board" id="board"></div>
    <div class="legend"><i style="background:var(--red)"></i>当前种子 <i style="background:var(--blue)"></i>满足回报 <i style="background:var(--route)"></i>不满足回报 <i style="background:#fff"></i>两侧边界 / 平均点</div>
  </div>
  <section class="info">
    <h2 id="frame-title">frame</h2>
    <div class="meta" id="frame-meta"></div>
    <div id="frame-terms"></div>
    <div class="formula" id="formula"></div>
  </section>
</div>
<div class="controls">
  <select id="figure-select">${figureOptions}</select>
  <button id="prev" type="button">← prev</button>
  <button id="play" type="button">▶ play</button>
  <button id="next" type="button">next →</button>
  <input id="range" type="range" min="0" step="1" value="0">
  <span class="meta" id="counter"></span>
</div>
</main>
<script>
const DATA = ${JSON.stringify(data)};
const DEFAULT_ID = ${JSON.stringify(defaultId)};
let currentId = DEFAULT_ID;
let frames = [];
let index = 0;
let timer = null;
let reportsLayer;
let circleLayer;
let vectorLayer;
let anchorsLayer;
let focusLayer;

const esc = (value) => String(value).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const dot = (point, color, radius, opacity) => '<circle cx="' + point.x.toFixed(2) + '" cy="' + point.y.toFixed(2) + '" r="' + radius + '" fill="' + color + '" opacity="' + opacity + '"/>';

function buildFrames(figure) {
  const out = [];
  for (const entry of figure.asks) {
    const reports = entry.reports.map((r) => ({ at: { x: r[0], y: r[1] }, satisfied: !!r[2], depth: r[3], validAnchor: !!r[4] }));
    const maxDepth = reports.reduce((max, report) => Math.max(max, report.depth), 0);
    const push = (kind, selectedReports, extra = {}) => {
      out.push({ frame: out.length + 1, ask: entry.ask, kind, seed: entry.seed, reports: selectedReports, anchors: [], selected: entry.selected, average: entry.average, centroid: entry.centroid, vector: entry.vector, ...extra });
    };
    push('ask', [], { depth: 0, maxDepth });
    for (let depth = 1; depth <= maxDepth; depth++) push('wave', reports.filter((report) => report.depth <= depth), { depth, maxDepth });
    const circle = { x: (entry.selected[0].x + entry.selected[1].x) / 2, y: (entry.selected[0].y + entry.selected[1].y) / 2, radius: Math.hypot(entry.selected[0].x - entry.selected[1].x, entry.selected[0].y - entry.selected[1].y) / 2 };
    push('anchors', reports, { anchors: entry.anchors, circle, center: { x: circle.x, y: circle.y } });
    push('coarse', reports, { anchors: entry.anchors, circle, center: entry.center, mass: entry.mass });
  }
  return out;
}

function buildBoard(figure) {
  const cells = figure.grid.map((value, index) => {
    const x = index % 16;
    const y = Math.floor(index / 16);
    return '<rect x="' + x + '" y="' + y + '" width="1" height="1" fill="' + (value ? '#e8e8ea' : '#050505') + '"/>';
  }).join('');
  const seen = new Set();
  const points = figure.asks.flatMap((entry) => entry.reports).filter((report) => {
    const key = report[0] + ',' + report[1];
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  }).map((report) => '<circle cx="' + report[0].toFixed(2) + '" cy="' + report[1].toFixed(2) + '" r="0.1" fill="#7f8a99"/>').join('');
  document.getElementById('board').innerHTML = '<svg id="board-svg" viewBox="0 0 16 16" role="img" aria-label="' + esc(figure.name) + '">' +
    '<g id="cells">' + cells + '</g>' +
    '<g id="reported-points">' + points + '</g>' +
    '<g id="reports"></g><g id="circle"></g><g id="vector"></g><g id="anchors"></g><g id="focus"></g></svg>';
  reportsLayer = document.getElementById('reports');
  circleLayer = document.getElementById('circle');
  vectorLayer = document.getElementById('vector');
  anchorsLayer = document.getElementById('anchors');
  focusLayer = document.getElementById('focus');
}

function renderBoard(frame) {
  reportsLayer.innerHTML = frame.reports.map((report) => dot(report.at, report.satisfied ? '#6ecbff' : '#ff9a92', 0.18, 0.85)).join('');
  circleLayer.innerHTML = frame.circle
    ? '<circle cx="' + frame.circle.x.toFixed(2) + '" cy="' + frame.circle.y.toFixed(2) + '" r="' + frame.circle.radius.toFixed(2) + '" fill="none" stroke="#ff9a92" stroke-width="0.08" stroke-dasharray="0.25 0.18"/>'
    : '';
  anchorsLayer.innerHTML = frame.anchors.map((point) => dot(point, '#ffffff', 0.24, 0.95)).join('');
  if (frame.selected) anchorsLayer.innerHTML += frame.selected.map((point) => '<circle cx="' + point.x.toFixed(2) + '" cy="' + point.y.toFixed(2) + '" r="0.3" fill="none" stroke="#ffffff" stroke-width="0.09"/>').join('');
  if (frame.average) anchorsLayer.innerHTML += dot(frame.average, '#ffffff', 0.22, 1);
  vectorLayer.innerHTML = frame.selected && frame.selected.length === 2
    ? '<line x1="' + frame.selected[0].x.toFixed(2) + '" y1="' + frame.selected[0].y.toFixed(2) + '" x2="' + frame.selected[1].x.toFixed(2) + '" y2="' + frame.selected[1].y.toFixed(2) + '" stroke="#ffd166" stroke-width="0.08" stroke-dasharray="0.2 0.14"/>'
    : '';
  const focus = frame.kind === 'coarse' && frame.center ? frame.center : frame.seed;
  focusLayer.innerHTML = dot(focus, '#ff4b3e', frame.kind === 'coarse' ? 0.5 : 0.34, 0.95);
}

const term = (text) => text ? '<code class="term">' + esc(text) + '</code>' : '';

function renderFormula(frame) {
  const rows = [];
  if (frame.kind === 'ask') {
    rows.push('<h3>① 发问</h3><pre>seed = (' + frame.seed.x.toFixed(2) + ', ' + frame.seed.y.toFixed(2) + ')\\n问句：这里是不是目标色？\\n能量从 ' + (frame.maxDepth ?? 0) + ' 层预算开始，沿四邻接散播。</pre>');
  }
  if (frame.kind === 'wave') {
    const sat = frame.reports.filter((report) => report.satisfied).length;
    const unsat = frame.reports.length - sat;
    rows.push('<h3>② 沿链回报 depth ' + frame.depth + '/' + frame.maxDepth + '</h3><pre>已回报点 = ' + frame.reports.length + '\\n满足 = ' + sat + '    不满足 = ' + unsat + '\\n满足点衰减慢，不满足点衰减快；\\n每条回报都保留回到发问者的 path。</pre>');
  }
  if (frame.kind === 'anchors') {
    const direct = frame.reports.filter((report) => !report.satisfied && report.depth <= 1).length;
    const invalid = frame.reports.filter((report) => !report.satisfied && report.depth > 1 && !report.validAnchor).length;
    rows.push('<h3>③ 取两侧边界</h3><pre>' +
      '询问点 = (' + frame.seed.x.toFixed(2) + ', ' + frame.seed.y.toFixed(2) + ')\\n' +
      '排除直连不满足点：' + direct + ' 个（depth ≤ 1）\\n' +
      '排除无满足中介的不满足点：' + invalid + ' 个\\n' +
      '用满足点协方差求笔画切向，取法向两侧最近的合法边界点\\n' +
      '选中两侧：\\n' + frame.selected.map((point) => '  (' + point.x.toFixed(2) + ', ' + point.y.toFixed(2) + ')').join('\\n') + '\\n' +
      '按两侧边界点画直径圆（询问点只作夹持验证）\\n' +
      'center = 两侧中点 = (' + frame.circle.x.toFixed(2) + ', ' + frame.circle.y.toFixed(2) + ')\\n' +
      'radius = |两侧距离| / 2 = ' + frame.circle.radius.toFixed(3) + '\\n' +
      '询问点在中央或贴近边缘，都不会只取半条笔画。</pre>');
  }
  if (frame.kind === 'coarse') {
    rows.push('<h3>④ 形成粗点</h3><pre>圆内满足点（粗点成员） = ' + (frame.mass ?? 0) + '\\n粗点中心 = 圆内满足点均值 = (' + frame.center.x.toFixed(2) + ', ' + frame.center.y.toFixed(2) + ')\\n<span class="hot">mass = ' + (frame.mass ?? 0) + '</span>\\n这个粗点进入下一次 Shift；下一次发问从周围按兴趣优先级选。</pre>');
  }
  document.getElementById('formula').innerHTML = rows.join('');
}

function render() {
  if (!frames.length) return;
  const frame = frames[index];
  renderBoard(frame);
  document.getElementById('frame-title').textContent = 'ask ' + frame.ask + ' · ' + frame.kind + ' · ' + frame.frame + '/' + frames.length;
  document.getElementById('frame-meta').textContent = 'seed (' + frame.seed.x.toFixed(2) + ', ' + frame.seed.y.toFixed(2) + ')';
  document.getElementById('frame-terms').innerHTML = ['? target color', frame.kind === 'wave' ? 'reports ' + frame.reports.length : '', frame.kind === 'anchors' ? 'two-sided boundaries' : '', frame.kind === 'coarse' ? 'coarse mass ' + frame.mass : ''].filter(Boolean).map(term).join('');
  renderFormula(frame);
  document.getElementById('range').value = String(index);
  document.getElementById('counter').textContent = (index + 1) + ' / ' + frames.length;
}

function setIndex(next) {
  if (!frames.length) return;
  index = Math.max(0, Math.min(frames.length - 1, next));
  render();
}

function selectFigure(id) {
  const figure = DATA[id];
  if (!figure) return;
  currentId = id;
  document.getElementById('figure-name').textContent = figure.name;
  document.getElementById('figure-select').value = id;
  buildBoard(figure);
  frames = buildFrames(figure);
  index = 0;
  document.getElementById('range').max = String(Math.max(0, frames.length - 1));
  render();
}

document.getElementById('prev').addEventListener('click', () => setIndex(index - 1));
document.getElementById('next').addEventListener('click', () => setIndex(index + 1));
document.getElementById('range').addEventListener('input', (event) => setIndex(Number(event.target.value)));
document.getElementById('figure-select').addEventListener('change', (event) => selectFigure(event.target.value));
document.getElementById('play').addEventListener('click', (event) => {
  if (timer) {
    clearInterval(timer);
    timer = null;
    event.target.textContent = '▶ play';
    return;
  }
  if (index >= frames.length - 1) setIndex(0);
  timer = setInterval(() => {
    if (index >= frames.length - 1) {
      clearInterval(timer);
      timer = null;
      document.getElementById('play').textContent = '▶ play';
      return;
    }
    setIndex(index + 1);
  }, 650);
  event.target.textContent = '⏸ pause';
});
document.addEventListener('keydown', (event) => {
  if (event.key === 'ArrowLeft') setIndex(index - 1);
  if (event.key === 'ArrowRight') setIndex(index + 1);
  if (event.key === ' ') {
    event.preventDefault();
    document.getElementById('play').click();
  }
});
window.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'visual-select') selectFigure(event.data.id);
});
selectFigure(DEFAULT_ID);
</script>
</body>
</html>`;

writeFileSync("coarse_player.html", html, "utf8");
console.log(`coarse_player.html · ${Object.keys(data).length} figures · ${data[defaultId]!.asks.length} coarse on default`);
