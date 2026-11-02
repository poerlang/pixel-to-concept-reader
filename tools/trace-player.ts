// 只读的 Shift 逐帧播放器：把一次 trace 拆成帧，展示每一步的原始差值和计算过程。
//
// 不参与推理，不写 memory；只导出 trace_player.html。

import { writeFileSync } from "node:fs";
import type { Point, ShiftTrace } from "../src/visual/shift.ts";
import { accelerations, episodeObservations } from "../src/visual/shift.ts";
import { askShift } from "../src/visual/ask.ts";
import { allFigures } from "./visual-fixtures.ts";

const SIZE = 16;
const DIRS = ["E", "SE", "S", "SW", "W", "NW", "N", "NE"] as const;

type StepGeometry = {
  dx: number;
  dy: number;
  distance: number;
  angle: number;
  bin: number;
  label: string;
  relative: number;
  lengthBin: number;
};

type AccelGeometry = {
  dx: number;
  dy: number;
  magnitude: number;
  bin: number;
  directionBin: number;
  label: string;
  accelBin: number;
};

type Summary = {
  closureTerm?: string;
  spanTerm?: string;
  areaTerm?: string;
  pointTerm?: string;
  first?: Point;
  last?: Point;
  pathLength?: number;
  closureRatio?: number;
  spanValue?: number;
  areaValue?: number;
  pointMass?: number;
};

type Frame = {
  frame: number;
  episode: number;
  local: number;
  kind: "start" | "step" | "end";
  to: Point;
  from?: Point;
  step?: StepGeometry;
  accel?: AccelGeometry;
  vecTerm?: string;
  accelTerm?: string;
  summary?: Summary;
  path: Point[];
  visited: Point[];
};

type PlayerData = {
  figure: string;
  name: string;
  frames: Frame[];
  points: Array<Point & { mass: number }>;
  grid: number[];
  episodes: number;
};

const median = (values: number[]): number => {
  if (!values.length) return 1;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)]!;
};

const directionBin = (dx: number, dy: number): number => {
  const angle = Math.atan2(dy, dx);
  const normalized = (angle + Math.PI * 2) % (Math.PI * 2);
  return Math.round(normalized / (Math.PI / 4)) % 8;
};

const relativeLengthBin = (value: number, scale: number): number =>
  value < scale * 0.75 ? 0 : value <= scale * 1.25 ? 1 : 2;

const relativeAccelBin = (value: number, scale: number): number =>
  value < scale * 0.25 ? 0 : value <= scale * 0.75 ? 1 : 2;

const closureBin = (ratio: number): number => ratio < 0.25 ? 0 : ratio < 0.7 ? 1 : 2;

function stepGeometry(from: Point, to: Point, scale: number): StepGeometry {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const distance = Math.hypot(dx, dy);
  const bin = directionBin(dx, dy);
  return {
    dx,
    dy,
    distance,
    angle: Math.atan2(dy, dx) * 180 / Math.PI,
    bin,
    label: DIRS[bin]!,
    relative: distance / scale,
    lengthBin: relativeLengthBin(distance, scale),
  };
}

function accelGeometry(step: StepGeometry, previous: StepGeometry, scale: number): AccelGeometry {
  const dx = step.dx - previous.dx;
  const dy = step.dy - previous.dy;
  const magnitude = Math.hypot(dx, dy);
  const accelBin = relativeAccelBin(magnitude, scale);
  const bin = directionBin(dx, dy);
  return {
    dx,
    dy,
    magnitude,
    bin,
    directionBin: accelBin === 0 ? 0 : bin,
    label: DIRS[bin]!,
    accelBin,
  };
}

function summaryOf(episode: ShiftTrace["episodes"][number], terms: string[]): Summary {
  const closureTerm = terms.find((term) => term.startsWith("shift_closure_"));
  const spanTerm = terms.find((term) => term.startsWith("shift_span_"));
  const areaTerm = terms.find((term) => term.startsWith("shift_area_"));
  const pointTerm = terms.find((term) => term.startsWith("shift_point_"));
  const first = episode.points[0];
  const last = episode.points.at(-1);
  const lengths = episode.steps.map((step) => Math.hypot(step.dx, step.dy));
  const pathLength = lengths.reduce((sum, value) => sum + value, 0);
  const closureRatio = first && last && pathLength
    ? Math.hypot(last.x - first.x, last.y - first.y) / pathLength
    : 0;
  const xs = episode.points.map((point) => point.x);
  const ys = episode.points.map((point) => point.y);
  const width = Math.max(...xs) - Math.min(...xs);
  const height = Math.max(...ys) - Math.min(...ys);
  const spanValue = Math.max(width, height) / SIZE;
  const mass = episode.points.reduce((sum, point) => sum + ((point as { mass?: number }).mass ?? 1), 0);
  return {
    closureTerm,
    spanTerm,
    areaTerm,
    pointTerm,
    first,
    last,
    pathLength,
    closureRatio,
    spanValue,
    areaValue: mass / (SIZE * SIZE),
    pointMass: mass,
  };
}

function buildFrames(trace: ShiftTrace): Frame[] {
  const observations = episodeObservations(trace);
  const frames: Frame[] = [];
  const visited: Point[] = [];

  for (let e = 0; e < trace.episodes.length; e++) {
    const episode = trace.episodes[e]!;
    const terms = observations[e] ?? [];
    const lengths = episode.steps.map((step) => Math.hypot(step.dx, step.dy));
    const scale = median(lengths);
    const accels = accelerations(episode.steps);
    const vecTerms = terms.slice(0, episode.steps.length);
    const accelTerms = terms.slice(episode.steps.length, episode.steps.length + accels.length);
    const summaryTerms = terms.slice(episode.steps.length + accels.length);
    const summary = summaryOf(episode, summaryTerms);
    let previous: StepGeometry | null = null;

    for (let i = 0; i < episode.points.length; i++) {
      const point = episode.points[i]!;
      visited.push(point);
      const frame: Frame = {
        frame: frames.length + 1,
        episode: e + 1,
        local: i + 1,
        kind: i === 0 ? "start" : i === episode.points.length - 1 ? "end" : "step",
        to: point,
        path: episode.points.slice(0, i + 1),
        visited: [...visited],
      };

      if (i > 0) {
        const step = episode.steps[i - 1]!;
        const geometry = stepGeometry(step.from, step.to, scale);
        frame.from = step.from;
        frame.step = geometry;
        frame.vecTerm = vecTerms[i - 1];
        if (previous) {
          frame.accel = accelGeometry(geometry, previous, scale);
          frame.accelTerm = accelTerms[i - 2];
        }
        previous = geometry;
      }

      if (i === episode.points.length - 1) frame.summary = summary;
      frames.push(frame);
    }
  }
  return frames;
}

function boardSvg(data: PlayerData): string {
  const cells = data.grid.map((value, index) => {
    const x = index % SIZE;
    const y = Math.floor(index / SIZE);
    return `<rect x="${x}" y="${y}" width="1" height="1" fill="${value ? "#e8e8ea" : "#050505"}"/>`;
  }).join("");
  const points = data.points.map((point) =>
    `<circle cx="${point.x.toFixed(3)}" cy="${point.y.toFixed(3)}" r="0.11" fill="#7f8a99" opacity=".9"/>`).join("");
  return `<svg id="board" viewBox="0 0 16 16" role="img" aria-label="${data.name}">
  <g id="cells">${cells}</g>
  <g id="all-points">${points}</g>
  <g id="trail"></g>
  <g id="visited"></g>
  <g id="current"></g>
</svg>`;
}

const figures = [...allFigures().simple, ...allFigures().complex];
const requested = process.argv[2] ?? "thick_ring_4";
const defaultFigure = figures.find((item) => item.id === requested) ?? figures.find((item) => item.id === "thick_ring_4") ?? figures[0]!;
const data: Record<string, PlayerData & { svg: string }> = {};

for (const figure of figures) {
  const trace = askShift(figure.grid, 16, { maxSteps: 2400, coarseSpacing: 1.5, interiorOnly: true });
  const frames = buildFrames(trace);
  const points = trace.points.map((point) => ({ ...point, mass: (point as { mass?: number }).mass ?? 1 }));
  const base: PlayerData = {
    figure: figure.id,
    name: figure.name,
    frames,
    points,
    grid: figure.grid,
    episodes: trace.episodes.length,
  };
  data[figure.id] = { ...base, svg: boardSvg(base) };
}

const initial = data[defaultFigure.id]!;
const figureOptions = Object.values(data).map((item) => `<option value="${item.figure}">${item.name}</option>`).join("");

const html = `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Shift 逐帧</title>
<style>
:root{color-scheme:dark;--bg:#08090b;--panel:#111318;--line:#252a33;--text:#e8e8ea;--muted:#8b93a1;--accent:#d8ff5f;--route:#ff9a92;--red:#ff4b3e;--blue:#6ecbff}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--text);font:14px/1.6 ui-monospace,SFMono-Regular,Consolas,monospace}
main{max-width:1180px;margin:0 auto;padding:28px 22px 60px}
header{border-bottom:1px solid var(--line);padding-bottom:16px;margin-bottom:20px}
h1{font-size:clamp(22px,4vw,38px);line-height:1.1;margin:0 0 6px;letter-spacing:-.04em}
h1 small{font-size:14px;color:var(--accent);letter-spacing:0}
p{color:var(--muted);margin:0}
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
.summary{border:1px solid #4f3b24;background:#1b1510;padding:9px;margin-top:10px}
.summary strong{color:#ffb26b}
.controls{display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin-top:16px}
button{appearance:none;border:1px solid #3a4658;background:#151a21;color:var(--text);padding:7px 12px;cursor:pointer;font:inherit}
button:hover{border-color:var(--accent)}\nselect{appearance:none;border:1px solid #3a4658;background:#151a21;color:var(--text);padding:7px 10px;font:inherit;max-width:260px}
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
<h1>Shift 逐帧 <small id="figure-name">${initial.name}</small></h1>
<p>一帧一个粗点。图像上红色是当前到达格，蓝色是已访问粗点；右侧显示这一帧实际产生的差值与计算过程。</p>
<p><a href="coarse_player.html">→ 先看粗点是怎么由问句脉冲算出来的</a></p>
</header>
<div class="wrap">
  <div>
    <div class="board" id="board">${initial.svg}</div>
    <div class="legend"><i style="background:#7f8a99"></i>粗点 <i style="background:var(--blue)"></i>已访问 <i style="background:var(--red)"></i>当前到达 <i style="background:var(--route)"></i>当前 episode 路径</div>
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
const DIRS = ${JSON.stringify(DIRS)};
const DEFAULT_ID = ${JSON.stringify(defaultFigure.id)};
let currentId = DEFAULT_ID;
let frames = DATA[currentId].frames;
let index = 0;
let timer = null;

const board = document.getElementById('board');
let trail;
let visitedLayer;
let currentLayer;

function bindLayers() {
  trail = document.getElementById('trail');
  visitedLayer = document.getElementById('visited');
  currentLayer = document.getElementById('current');
}

function pointText(point) {
  return '(' + point.x.toFixed(1) + ', ' + point.y.toFixed(1) + ')';
}

function polyline(points) {
  return points.map((point) => point.x.toFixed(2) + ',' + point.y.toFixed(2)).join(' ');
}

function renderBoard(frame) {
  trail.innerHTML = '<polyline points="' + polyline(frame.path) + '" fill="none" stroke="#ff9a92" stroke-width="0.14" stroke-opacity="0.8"/>';
  visitedLayer.innerHTML = frame.visited.map((point) => '<circle cx="' + point.x.toFixed(2) + '" cy="' + point.y.toFixed(2) + '" r="0.14" fill="#6ecbff" opacity="0.85"/>').join('');
  currentLayer.innerHTML = '<circle cx="' + frame.to.x.toFixed(2) + '" cy="' + frame.to.y.toFixed(2) + '" r="0.42" fill="#ff4b3e" stroke="#ffd7d2" stroke-width="0.08"/>';
}

function term(text) {
  return text ? '<code class="term">' + text + '</code>' : '';
}

function renderFormula(frame) {
  const rows = [];
  if (frame.kind === 'start') {
    rows.push('<h3>episode start</h3><pre>从剩余粗点中取 y 最小、其次 x 最小的点：' + pointText(frame.to) + '\\n本帧没有上一步，所以没有 vec / accel。</pre>');
  }
  if (frame.step) {
    const s = frame.step;
    rows.push('<h3>① shift_vec：这一步</h3><pre>' +
      'from = ' + pointText(frame.from) + '\\n' +
      'to   = ' + pointText(frame.to) + '\\n' +
      'd = to - from = (' + s.dx.toFixed(3) + ', ' + s.dy.toFixed(3) + ')\\n' +
      '|d| = √(' + s.dx.toFixed(3) + '² + ' + s.dy.toFixed(3) + '²) = ' + s.distance.toFixed(3) + '\\n' +
      'θ = atan2(dy,dx) = ' + s.angle.toFixed(1) + '°\\n' +
      'dir = round(θ / (π/4)) mod 8 = ' + s.bin + ' → ' + s.label + '\\n' +
      'scale = median(本 episode 所有步长) = ' + (s.distance / s.relative).toFixed(3) + '\\n' +
      'len = |d| / scale = ' + s.relative.toFixed(3) + ' → lenBin ' + s.lengthBin + '\\n' +
      '<span class="hot">' + term(frame.vecTerm) + '</span></pre>');
  }
  if (frame.accel) {
    const a = frame.accel;
    rows.push('<h3>② shift_accel：相邻两步的差</h3><pre>' +
      'd_i     = (' + frame.step.dx.toFixed(3) + ', ' + frame.step.dy.toFixed(3) + ')\\n' +
      'd_{i-1} = (' + (frame.step.dx - a.dx).toFixed(3) + ', ' + (frame.step.dy - a.dy).toFixed(3) + ')\\n' +
      'a = d_i - d_{i-1} = (' + a.dx.toFixed(3) + ', ' + a.dy.toFixed(3) + ')\\n' +
      '|a| = ' + a.magnitude.toFixed(3) + '\\n' +
      'accelBin = |a| < 0.25·scale ? 0 : |a| <= 0.75·scale ? 1 : 2 = ' + a.accelBin + '\\n' +
      'accelDir = ' + (a.accelBin === 0 ? '0 (零向量约定 E)' : a.directionBin + ' → ' + a.label) + '\\n' +
      '<span class="hot">' + term(frame.accelTerm) + '</span></pre>');
  } else if (frame.step) {
    rows.push('<h3>② shift_accel</h3><pre class="dim">本 episode 的第一步：没有 d_{i-1}，所以不产生 accel。</pre>');
  }
  if (frame.summary) {
    const s = frame.summary;
    if (s.pointTerm) {
      rows.push('<h3>③ 单粗点</h3><pre>没有第二步；' + term(s.pointTerm) + ' mass=' + s.pointMass + '</pre>');
    }
    if (s.closureTerm) {
      rows.push('<h3>③ episode 闭合</h3><pre>' +
        'first = ' + pointText(s.first) + '\\n' +
        'last  = ' + pointText(s.last) + '\\n' +
        'path  = Σ|d_i| = ' + s.pathLength.toFixed(3) + '\\n' +
        'closure = |last-first| / path = ' + s.closureRatio.toFixed(3) + '\\n' +
        'bin = closure < 0.25 ? 0 : closure < 0.7 ? 1 : 2 = ' + (s.closureRatio < 0.25 ? 0 : s.closureRatio < 0.7 ? 1 : 2) + '\\n' +
        '<span class="hot">' + term(s.closureTerm) + '</span></pre>');
    }
    if (s.spanTerm) {
      rows.push('<h3>④ span / area</h3><pre>' +
        'span = max(bbox_w, bbox_h) / 16 = ' + s.spanValue.toFixed(3) + ' → ' + term(s.spanTerm) + '\\n' +
        'area = Σ粗点质量 / (16×16) = ' + s.areaValue.toFixed(3) + ' → ' + term(s.areaTerm) + '</pre>');
    }
  }
  document.getElementById('formula').innerHTML = rows.join('');
}

function render() {
  const frame = frames[index];
  renderBoard(frame);
  document.getElementById('frame-title').textContent = 'EP ' + frame.episode + ' · frame ' + frame.frame + '/' + frames.length;
  document.getElementById('frame-meta').textContent = 'local point ' + frame.local + ' · kind ' + frame.kind + ' · ' + pointText(frame.to);
  document.getElementById('frame-terms').innerHTML = [frame.vecTerm, frame.accelTerm, frame.summary?.closureTerm, frame.summary?.spanTerm, frame.summary?.areaTerm, frame.summary?.pointTerm].filter(Boolean).map(term).join('');
  renderFormula(frame);
  document.getElementById('range').value = String(index);
  document.getElementById('counter').textContent = (index + 1) + ' / ' + frames.length;
}

function setIndex(next) {
  index = Math.max(0, Math.min(frames.length - 1, next));
  render();
}

function selectFigure(id) {
  const next = DATA[id];
  if (!next) return;
  currentId = id;
  frames = next.frames;
  index = 0;
  board.innerHTML = next.svg;
  bindLayers();
  document.getElementById('figure-name').textContent = next.name;
  document.getElementById('figure-select').value = id;
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

writeFileSync("trace_player.html", html, "utf8");
console.log(`trace_player.html · ${figures.length} figures · default ${initial.name} · ${initial.frames.length} frames · ${initial.episodes} episodes`);
