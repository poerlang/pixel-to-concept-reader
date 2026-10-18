// 测试报告：把一次 200 张测试渲染成一个自包含的 HTML（缩略图用 canvas 画，不依赖图片文件）。
//
// 页面里三块：
//   1. 识别错误的缩略图列表（点一张看它当时的脑内状态）；
//   2. 那一帧的各层概念（层 =词项句法深度，与 tower.ts 同一口径）+ 本样本出现次数；
//   3. 全局概念排行（按出现次数，暂时不做别的排序）。
// 数据由 tools/baby.ts test 收集；这里只做只读投影，不参与推理。

import type { Term } from "../nars/term.ts";

export type ConceptUse = {
  label: string;
  layer: number;
  count: number;
  f: number;
  c: number;
};

export type PartReport = {
  cx: number;
  cy: number;
  r: number;
  cells: number;
  fill: number;
};

export type SampleReport = {
  index: number;
  digit: number;
  pred: number | null;
  f: number;
  c: number;
  runnerUp: number | null;
  grid: number[];
  parts: PartReport[];
  shifts: Array<{ ax: number; ay: number; bx: number; by: number; chain: number }>;
  correct: boolean;
  scores: Array<{ digit: number; f: number; c: number; expectation: number }>;
  termTotal: number;
  groupCounts: number[];
  layers: ConceptUse[][];
  hypotheses: Array<{ source: string; label: string; f: number; c: number; expectation: number; enabled: boolean }>;
  shiftComparison?: { pairs: number; direction: number; step: number };
  partitions?: Array<{ label: string; closed: number }>;
  curriculumMatch?: { figure: string; matches: number; total: number } | null;
  alternatives?: Array<{ name: string; count: number }>;
};

export type ReportData = {
  generated: string;
  accuracy: { correct: number; total: number };
  confusion: number[][];
  classTotals: number[];
  samples: SampleReport[];
  ranking: ConceptUse[];
  memory: {
    jsonBytes: number;
    binaryBytes: number;
    concepts: number;
    beliefs: number;
    roundTrip: boolean;
  };
  params: {
    trainPer: number;
    testOffset: number;
    testPer: number;
    classifier: string;
  };
};

export const LAYER_NAMES = ["loop Gray", "Shift", "恒常 / 闭合", "loop 布局", "圈 ∩ 空"];

/**词项key → 人能读的短标签（只做排版，不改 key 的身份） */
export function prettyTerm(term: Term): string {
  if (term.atom) return term.key;
  const comps = term.comps ?? [];
  if (term.copula === "[]") return `[${prettyTerm(comps[0]!)}]`;
  if (term.copula === "¬") return `¬${prettyTerm(comps[0]!)}`;
  if (term.copula === "→") return `${prettyTerm(comps[0]!)} → ${prettyTerm(comps[1]!)}`;
  if (term.copula === "↔") return `${prettyTerm(comps[0]!)} ↔ ${prettyTerm(comps[1]!)}`;
  if (term.copula === "∩") return `(${comps.map((part) => prettyTerm(part)).join(" ∩ ")})`;
  return term.key;
}

const escapeHtml = (text: string): string =>
  text.replace(/[&<>"]/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[char] ?? char);

export function renderReport(data: ReportData): string {
  const json = JSON.stringify(data).replace(/</g, "\\u003c");
  const percent = ((data.accuracy.correct / Math.max(1, data.accuracy.total)) * 100).toFixed(1);
  const errors = data.samples.filter((sample) => !sample.correct).length;
  const binaryKb = (data.memory.binaryBytes / 1024).toFixed(1);
  return `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta http-equiv="Cache-Control" content="no-store, no-cache, must-revalidate">
<meta http-equiv="Pragma" content="no-cache">
<title>测试报告（v8 结构词项）</title>
<style>
:root{--bg:#0b1014;--panel:#0e151c;--line:#1d2a36;--text:#dee8f2;--dim:#7f93a6;--cyan:#63d9ff;--red:#ff7a7a;--green:#7ee0a8}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--text);font:13px/1.5 "Segoe UI","Microsoft YaHei",sans-serif}
header{padding:14px 18px;border-bottom:1px solid var(--line);display:flex;gap:22px;align-items:baseline;flex-wrap:wrap}
h1{font-size:16px;margin:0}
.stats{color:var(--dim);font-size:12px}
.stats b{color:var(--text);font-size:14px}
a{color:var(--cyan)}
main{display:grid;grid-template-columns:minmax(320px,430px) 1fr;gap:16px;padding:14px 18px;align-items:start}
section{border:1px solid var(--line);border-radius:6px;background:var(--panel);padding:12px}
h2{font-size:13px;margin:0 0 10px;color:#9fb3c6;font-weight:600}
.tabs{display:flex;gap:6px;margin:0 0 9px;flex-wrap:wrap}
.tabs button{background:#0b1218;border:1px solid var(--line);color:var(--dim);border-radius:4px;padding:5px 11px;cursor:pointer;font-size:12px}
.tabs button.active{border-color:var(--cyan);color:var(--text);background:#10202b}
.hint{color:var(--dim);font-size:11px;margin:0 0 8px}
.gallery{display:grid;grid-template-columns:1fr 1fr;gap:8px;max-height:70vh;overflow:auto;padding-right:4px}
.card{display:flex;gap:8px;align-items:center;text-align:left;background:#101a22;border:1px solid var(--line);border-radius:5px;color:var(--text);padding:6px;cursor:pointer}
.card:hover{border-color:var(--cyan)}
.card.active{border-color:var(--cyan);box-shadow:0 0 0 1px var(--cyan) inset}
.card canvas{width:52px;height:52px;image-rendering:pixelated;border-radius:3px;background:#000;flex:none}
.card .meta{min-width:0}
.card .meta div{white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.card .bad{color:var(--red)}
.card .ok{color:var(--green)}
.card.right{border-color:rgba(126,224,168,.35)}
.card.right.active{border-color:var(--green);box-shadow:0 0 0 1px var(--green) inset}
.card.wrong{border-color:rgba(255,122,122,.3)}
.card .truth{color:var(--dim);font-size:11px}
.detail{display:flex;gap:16px;flex-wrap:wrap;align-items:flex-start}
.detail canvas{width:176px;height:176px;image-rendering:pixelated;border:1px solid var(--line);border-radius:4px;background:#000}
.verdict{font-size:12px;color:var(--dim);line-height:1.8}
.verdict b{color:var(--text)}
.verdict .ok{color:var(--green)}
.verdict .bad{color:var(--red)}
.layers{display:grid;grid-template-columns:repeat(5,minmax(0,1fr));gap:8px;margin-top:12px}
.layer{background:#0b1218;border:1px solid var(--line);border-radius:5px;padding:8px;min-width:0;overflow:hidden}
.layer h3{font-size:12px;margin:0 0 6px;color:#9fb3c6;font-weight:600}
.rows{max-height:360px;overflow:auto}
.row{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:4px;padding:3px 0;border-bottom:1px solid #141f29;min-width:0}
.row .label{white-space:nowrap;overflow:hidden;text-overflow:ellipsis;font-family:Consolas,monospace;font-size:11px;min-width:0}
.row .count{color:var(--cyan);font-size:11px}
.row .truth{grid-column:1 / -1;color:var(--dim);font-size:10px}
.empty{color:var(--dim);font-size:11px;padding:6px 0}
table{border-collapse:collapse;width:100%;font-size:12px}
th,td{border:1px solid var(--line);padding:3px 5px;text-align:right}
th{color:var(--dim);font-weight:500}
td.hit{color:var(--green);font-weight:600}
td.miss{color:var(--red)}
.rankWrap{max-height:520px;overflow:auto;margin-top:8px}
.rankWrap td.label{text-align:left;font-family:Consolas,monospace;font-size:11px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:620px}
input[type=search]{background:#0b1218;border:1px solid var(--line);border-radius:4px;color:var(--text);padding:5px 8px;width:280px}
.filters{display:flex;gap:6px;align-items:center;flex-wrap:wrap}
.filters button{background:#0b1218;border:1px solid var(--line);color:var(--dim);border-radius:4px;padding:4px 9px;cursor:pointer}
.filters button.active{border-color:var(--cyan);color:var(--text)}
.footer{padding:10px 18px 22px;color:var(--dim);font-size:11px;border-top:1px solid var(--line);margin-top:10px}
@media (max-width:1100px){main{grid-template-columns:1fr}.layers{grid-template-columns:repeat(2,minmax(160px,1fr))}}
.parts{margin-top:10px;border-top:1px solid var(--line);padding-top:8px}
.chainWrap{margin-top:12px;border-top:1px solid var(--line);padding-top:10px}
.chainWrap h3{font-size:12px;color:#9fb3c6;margin:0 0 8px}
.chainTable{max-height:180px;overflow:auto}
.dot{display:inline-block;width:9px;height:9px;border-radius:50%;margin-right:5px;vertical-align:middle}
.flowWrap{margin-top:12px;border-top:1px solid var(--line);padding-top:10px}
.flowWrap h3{font-size:12px;color:#9fb3c6;margin:0 0 8px}
.flow{display:grid;grid-template-columns:repeat(5,minmax(145px,1fr));gap:18px;align-items:stretch}
.step{position:relative;background:#0b1218;border:1px solid var(--line);border-radius:5px;padding:8px;min-width:0}
.step::after{content:"→";position:absolute;right:-15px;top:50%;transform:translateY(-50%);color:#3d5568}
.step:last-child::after{content:""}
.step .no{font-size:10px;color:var(--cyan)}
.step .k{font-size:12px;color:#9fb3c6;margin:2px 0 3px}
.step .v{font-size:15px;color:var(--text);font-weight:600}
.step .note{font-size:10px;color:var(--dim);line-height:1.55;margin-top:4px}
.bars{display:flex;flex-direction:column;gap:3px;margin-top:5px}
.bar{display:grid;grid-template-columns:52px 1fr 64px;gap:4px;align-items:center;font-size:10px;color:var(--dim)}
.bar .track{height:6px;background:#14212c;border-radius:3px;overflow:hidden}
.bar .fill{height:100%;background:var(--cyan);border-radius:3px}
.bar.answer{color:var(--text)}
.bar.answer .fill{background:var(--green)}
.parts h3{font-size:12px;color:#9fb3c6;margin:0 0 6px}
.tip{position:fixed;display:none;max-width:390px;background:#121c25;border:1px solid #2b3d4e;border-radius:5px;padding:8px 10px;color:var(--text);font:12px/1.6 "Segoe UI","Microsoft YaHei",sans-serif;box-shadow:0 8px 24px rgba(0,0,0,.45);z-index:99;pointer-events:none}
.label[data-tip]{cursor:help;border-bottom:1px dotted #3d5568}
</style>
</head>
<body>
<header>
  <h1>测试报告 <span style="color:#63d9ff;font-size:12px">v8 · 结构词项</span></h1>
  <div class="stats"><b>${percent}%</b> · ${data.accuracy.correct}/${data.accuracy.total} · 错误 <b>${errors}</b> 张 · 概念 <b>${data.memory.concepts}</b> · 信念 <b>${data.memory.beliefs}</b> · 二进制 <b>${binaryKb} KB</b> · 往返 ${data.memory.roundTrip ? "✓" : "✗"}</div>
  <div class="stats">训练 ${data.params.trainPer}/类 · 测试 ${data.params.testOffset}–${data.params.testOffset + data.params.testPer - 1} · 分类读出 ${data.params.classifier} · <a href="nars.bin" download>下载 nars.bin</a></div>
</header>
<main>
  <section>
    <h2>样本（正确 / 错误；点缩略图看当时脑内状态）</h2>
    <div id="sampleTabs" class="tabs"></div>
    <div class="hint">鼠标悬停词项看解释；点上方“正确/错误”切换两组。</div>
    <div id="gallery" class="gallery"></div>
  </section>
  <section>
    <h2 id="detailTitle">这一帧的脑内状态</h2>
    <div class="detail">
      <canvas id="big" width="176" height="176"></canvas>
      <div id="verdict" class="verdict"></div>
    </div>
    <div class="flowWrap"><h3>这张图怎么得出结论（本次实际数据）</h3><div id="flow" class="flow"></div></div>
    <div class="chainWrap"><h3>Shift 链（箭头按链着色）</h3><div id="chains" class="chainTable"></div></div>
    <div id="layers" class="layers"></div>
    <div class="parts"><h3>圆候选（pdftest5 growDiscs；ACTIVE=0.3 / tol=0.1 / step=0.2 / r=0.6–8；只作候选，不决定类别；分类特征不含绝对圆心）</h3><div id="parts"></div></div>
  </section>
</main>
<section style="margin:0 18px 16px">
  <h2>概念排行（默认 L2 陈述；按出现次数，可切层）</h2>
  <div class="filters"><input id="search" type="search" placeholder="过滤概念…"><button data-layer="all">全部</button><button data-layer="0">L0</button><button data-layer="1">L1</button><button data-layer="2" class="active">L2</button><button data-layer="3">L3</button><button data-layer="4">L4</button></div>
  <div class="rankWrap"><table><thead><tr><th>#</th><th>层</th><th>概念</th><th>次数</th><th>f</th><th>c</th></tr></thead><tbody id="rank"></tbody></table></div>
</section>
<section style="margin:0 18px 16px">
  <h2>混淆矩阵（行 = 真值，列 = 答案）</h2>
  <div id="confusion"></div>
</section>
<div id="tip" class="tip"></div>
<div class="footer">
  出现次数 = 这一帧里该词项的数量（一个 loop / 一个 Shift 对贡献一次；不是引擎调用次数）。
  f = 该词项数 / 本帧词项总数；c = 0.900 观察置信度。标题里的 f/c 才是 frame ↔ digit 的相似判断。
  层 = 结构组：loop Gray / Shift / 恒常·闭合 / loop 布局。
 词项字典：<a href="../../docs/terms.md">docs/terms.md</a>。训练/识别只用结构词项；16×16 读数只在 growDiscs 和布局分档时作为输入，不写进记忆。二进制是训练后的记忆快照（不含测试帧）；页面只读。
</div>
<script>
const DATA = ${json};
const NAMES = ${JSON.stringify(LAYER_NAMES)};
const $ = function (sel) { return document.querySelector(sel); };
function el(tag, cls, text) { const node = document.createElement(tag); if (cls) node.className = cls; if (text !== undefined) node.textContent = text; return node; }
const CHAIN_COLORS = ["#ffc45a", "#63d9ff", "#ff8fb1", "#a8e06b", "#c9a7ff", "#ff9f6e", "#8fd6ff", "#f6e27a"];
function drawFrame(canvas, sample, size) {
  draw(canvas, sample.grid, size);
  const ctx = canvas.getContext("2d");
  const scale = size / 16;
  ctx.lineWidth = 1.5;
  for (const part of sample.parts || []) {
    ctx.beginPath(); ctx.arc(part.cx * scale, part.cy * scale, Math.max(2, part.r * scale), 0, Math.PI * 2);
    ctx.strokeStyle = "rgba(99,217,255,.85)"; ctx.stroke();
    ctx.beginPath(); ctx.arc(part.cx * scale, part.cy * scale, 1.6, 0, Math.PI * 2);
    ctx.fillStyle = "#63d9ff"; ctx.fill();
  }
  for (const shift of sample.shifts || []) {
    ctx.strokeStyle = CHAIN_COLORS[(shift.chain || 0) % CHAIN_COLORS.length];
    ctx.fillStyle = ctx.strokeStyle;
    const ax = shift.ax * scale, ay = shift.ay * scale, bx = shift.bx * scale, by = shift.by * scale;
    ctx.beginPath(); ctx.moveTo(ax, ay); ctx.lineTo(bx, by); ctx.stroke();
    const angle = Math.atan2(by - ay, bx - ax);
    ctx.beginPath(); ctx.moveTo(bx, by); ctx.lineTo(bx - 6 * Math.cos(angle - 0.4), by - 6 * Math.sin(angle - 0.4)); ctx.lineTo(bx - 6 * Math.cos(angle + 0.4), by - 6 * Math.sin(angle + 0.4)); ctx.closePath(); ctx.fill();
  }
}
function renderParts(sample) {
  const box = $("#parts"); box.innerHTML = "";
  if (!sample.parts || sample.parts.length === 0) { box.appendChild(el("div", "empty", "没有候选")); return; }
  const table = el("table");
  const head = el("tr");
  for (const name of ["#", "圆心", "半径", "覆盖格", "填充"]) head.appendChild(el("th", "", name));
  table.appendChild(head);
  sample.parts.forEach(function (part, i) {
    const row = el("tr");
    row.appendChild(el("td", "", String(i + 1)));
    row.appendChild(el("td", "", part.cx.toFixed(2) + ", " + part.cy.toFixed(2)));
    row.appendChild(el("td", "", part.r.toFixed(2)));
    row.appendChild(el("td", "", String(part.cells)));
    row.appendChild(el("td", "", part.fill.toFixed(2)));
    table.appendChild(row);
  });
  box.appendChild(table);
}
function draw(canvas, grid, size) {
  const off = document.createElement("canvas"); off.width = 16; off.height = 16;
  const octx = off.getContext("2d"); const image = octx.createImageData(16, 16);
  for (let i = 0; i < 256; i++) {
    const v = Math.max(0, Math.min(255, Math.round(grid[i] * 255)));
    image.data[i * 4] = v; image.data[i * 4 + 1] = v; image.data[i * 4 + 2] = v; image.data[i * 4 + 3] = 255;
  }
  octx.putImageData(image, 0, 0);
  canvas.width = size; canvas.height = size;
  const ctx = canvas.getContext("2d"); ctx.imageSmoothingEnabled = false; ctx.drawImage(off, 0, 0, size, size);
}
function verdictText(sample) {
  const pred = sample.pred === null ? "?" : ("digit_" + sample.pred);
  const runner = sample.runnerUp === null ? "无" : ("digit_" + sample.runnerUp);
  return "真值 digit_" + sample.digit + "　答案 " + pred + "　f=" + sample.f.toFixed(3) + " c=" + sample.c.toFixed(3) + "　次名 " + runner;
}
let selected = -1;
let activeTab = "wrong";
let layerFilter = "2";

function bareLabel(text) { return text.charAt(0) === "[" && text.charAt(text.length - 1) === "]" ? text.slice(1, -1) : text; }
function tipOf(text) {
  const name = bareLabel(text);
  if (name.indexOf("center_blank") >= 0) return "圈∩空复合词项：累计 shift diff（整圈/大半圈） + 中心空白 + 低/中幅 shift diff 的恒常。center_blank 只是成分，不是洞词项。";
  if (name === "big_shift_diff_set") return "标记：这一帧至少有一个大面积 Shift 差（集合存在）。";
  if (name === "closure") return "闭合：一条 Shift 链的首尾距离 ≤ (首半径+尾半径)×0.85，即“同·Shift首尾”。×N=闭合链条数。";
  if (name === "closures_n") return "闭合链的条数；和 closure 的计数重复，只是显式的数量词项。";
  if (name.startsWith("loop_size_")) return "loop 覆盖格数分档：0 ≤2；1 3–4；2 5–8；3 9–16；4 >16。每个候选 loop 发一个。";
  if (name.startsWith("loop_fill_")) return "loop 填充率 = 覆盖格/圆面积：0 ≤0.4；1 0.4–0.6；2 0.6–0.8；3 >0.8。×N=本帧有多少 loop 在这一档。";
  if (name.startsWith("loops_")) return "这一帧的 loop 候选总数（上限 8）。";
  if (name.startsWith("chains_")) return "把 loop 连成链的条数（上限 4）。";
  if (name.startsWith("chain_len_")) return "一条链包含的 loop 数（上限 5）；每条链发一个词项。";
  if (name.startsWith("shifts_")) return "全帧 Shift 步数（链上相邻 loop 的对数，上限 8）。";
  if (name.startsWith("shift_start_")) return "标记：这条链至少有一个 Shift。后缀恒为 1，不含方向/步长信息。";
  if (name.startsWith("big_shift_diff_n_")) return "大面积 Shift 差的个数（上限 8）；后缀 k 是数量。";
  if (name.startsWith("shift_diff_accum")) return "链级累计 shift diff：方向 + 四分之一圈数 + 路径/平均半径的跨度档；小的 shift diff 累积成大圈时才有意义。";
  if (name.startsWith("big_shift_diff_")) return "大面积 Shift 差：连续两个 Shift 的方向/步长差，感受野面积 ≥ 全帧平均 loop 面积。t=l/r/s 是 shift diff 方向，s=0/1/2 是步长比档。";
  if (name.startsWith("small_shift_diff_")) return "小面积 Shift 差：同样看连续两个 Shift 的方向/步长，但感受野面积 < 全帧平均 loop 面积。t=l/r/s，s=0/1/2。";
    if (name.startsWith("eff_")) return "路径效率 = 总步长 / 首尾直线距离：0 ≤0.7；1 0.7–1.3；2 1.3–2.2；3 >2.2；越大越绕。";
  if (name.startsWith("step_rel_")) return "平均步长 / 首尾平均半径：0 ≤0.5；1 0.5–1；2 1–1.8；3 >1.8。";
    if (name.startsWith("const_")) return "恒常：连续两个 Shift 的 shift diff 方向相同、步长相近。high = |shift diff 夹角|>0.5 rad；low = ≤0.5 rad，即“同·Shift差·高/低”。";
  if (name.startsWith("lzone_")) return "loop 圆心在物体框 4×4 中的相对格子（x 从左到右，y 从上到下）；不是像素坐标。";
  if (name.startsWith("lzsize_")) return "同 4×4 格子 + 该 loop 的覆盖格分档：0 ≤2；1 3–4；2 5–8；3 >8。";
  if (name.startsWith("lzfill_")) return "同 4×4 格子 + 该 loop 的填充率分档：0 ≤0.5；1 0.5–0.75；2 >0.75。";
  if (name.startsWith("lrel_")) return "两个 loop 的相对方向：right/left/above/below 表示第二个相对第一个的位置。";
  if (name.startsWith("ldist_")) return "两 loop 圆心距 / 平均半径：0 ≤1；1 1–2；2 2–4；3 4–7；4 >7。";
  if (name.startsWith("lratio_")) return "两 loop 覆盖格比：big >1.5；small <0.67；same 其余。";
  if (name.startsWith("loverlap_")) return "两 loop 是否重叠：圆心距 < (r1+r2)×0.6 算 yes。";
  return "结构词项：" + name + "（详见 docs/terms.md）";
}

function flowStep(no, key, value, note) {
  const box = el("div", "step");
  box.appendChild(el("div", "no", no));
  box.appendChild(el("div", "k", key));
  box.appendChild(el("div", "v", value));
  if (note) box.appendChild(el("div", "note", note));
  return box;
}

function renderFlow(sample) {
  const box = $("#flow"); box.innerHTML = "";
  const active = sample.grid.filter(function (value) { return value > 0.3; }).length;
  const groups = sample.groupCounts || [0, 0, 0, 0];
  const groupNames = ["loop", "Shift", "恒常/闭合", "布局", "圈∩空"];
  box.appendChild(flowStep("① 输入", "16×16 读数", active + " 个亮点", "只进通道，不作记忆"));
  box.appendChild(flowStep("② 候选", "growDiscs loop", sample.parts.length + " 个", sample.shifts.length + " 步 Shift；圆只是候选"));
  box.appendChild(flowStep("③ 结构", "结构词项（含重复关系）", (sample.termTotal || 0) + " 个",
    "④ 只用每个词项的有/无；分组：" + groupNames.map(function (name, at) { return name + " " + Math.round(groups[at] || 0); }).join(" · ")));

  const compare = flowStep("④ 比较", "NAL 比较 / 修订", "10 个 digit 类",
    "frame = 当前帧的临时词项，不是像素数组。它和 digit_0…digit_9 逐词项比较，再修订成 frame ↔ digit_d；条长=f，答案按 e=c(f−0.5)+0.5 取最高。");
  const bars = el("div", "bars");
  (sample.scores || []).slice(0, 5).forEach(function (score) {
    const row = el("div", "bar" + (score.digit === sample.pred ? " answer" : ""));
    row.appendChild(el("span", "", "digit_" + score.digit));
    const track = el("span", "track");
    const fill = el("span", "fill");
    fill.style.width = Math.max(2, Math.min(100, score.f * 100)) + "%";
    track.appendChild(fill); row.appendChild(track);
    row.appendChild(el("span", "", "f=" + score.f.toFixed(2) + " c=" + score.c.toFixed(2)));
    bars.appendChild(row);
  });
  compare.appendChild(bars);
  if (sample.shiftComparison) {
    compare.appendChild(el("div", "empty", "同链 Shift 比较（com）：方向 " + sample.shiftComparison.direction + "/" + sample.shiftComparison.pairs + " · 步长 " + sample.shiftComparison.step + "/" + sample.shiftComparison.pairs));
  }
  box.appendChild(compare);
  if (sample.hypotheses && sample.hypotheses.length) {
    const hyps = el("div", "hyps");
    hyps.appendChild(el("div", "hyp", "解释竞争（只显示，不直接改答案）"));
    for (const hypothesis of sample.hypotheses) {
      const row = el("div", "hyp");
      row.appendChild(el("span", "", hypothesis.source + "  f=" + hypothesis.f.toFixed(2) + " c=" + hypothesis.c.toFixed(2) + (hypothesis.enabled ? " · 启用" : " · 仅显示")));
      row.appendChild(el("span", "e", "E=" + hypothesis.expectation.toFixed(2)));
      hyps.appendChild(row);
    }
    box.appendChild(hyps);
  }
  if (sample.alternatives && sample.alternatives.length) {
    box.appendChild(el("div", "empty", "观察集：" + sample.alternatives.map((alt) => alt.name + " " + alt.count).join(" · ")));
  }
  if (sample.curriculumMatch) {
    const match = el("div", "empty", "经典图命中：" + sample.curriculumMatch.figure + " " + sample.curriculumMatch.matches + "/" + sample.curriculumMatch.total);
    box.appendChild(match);
  }
  if (sample.partitions && sample.partitions.length) {
    const parts = el("div", "hyps");
    parts.appendChild(el("div", "hyp", "划分假设（链级，只显示）"));
    for (const part of sample.partitions) {
      const row = el("div", "hyp");
      row.appendChild(el("span", "", part.label));
      row.appendChild(el("span", "e", "闭合块=" + part.closed));
      parts.appendChild(row);
    }
    box.appendChild(parts);
  }

  const answer = sample.pred === null ? "?" : "digit_" + sample.pred;
  const runner = sample.runnerUp === null ? "无" : "digit_" + sample.runnerUp;
  box.appendChild(flowStep("⑤ 问句", "frame ↔ ?x", answer,
    "取期望最高；次名 " + runner + " · f=" + sample.f.toFixed(3) + " c=" + sample.c.toFixed(3)));
}

function renderChains(sample) {
  const box = $("#chains"); box.innerHTML = "";
  const groups = new Map();
  for (const shift of sample.shifts || []) {
    const id = shift.chain || 0;
    if (!groups.has(id)) groups.set(id, []);
    groups.get(id).push(shift);
  }
  if (groups.size === 0) { box.appendChild(el("div", "empty", "没有 Shift 链")); return; }
  const table = el("table");
  const head = el("tr");
  for (const name of ["链", "颜色", "步数", "起点", "终点"]) head.appendChild(el("th", "", name));
  table.appendChild(head);
  for (const [id, shifts] of [...groups.entries()].sort(function (a, b) { return a[0] - b[0]; })) {
    const row = el("tr");
    row.appendChild(el("td", "", "#" + (Number(id) + 1)));
    const color = el("td");
    const dot = el("span", "dot");
    dot.style.background = CHAIN_COLORS[Number(id) % CHAIN_COLORS.length];
    color.appendChild(dot);
    color.appendChild(el("span", "", CHAIN_COLORS[Number(id) % CHAIN_COLORS.length]));
    row.appendChild(color);
    row.appendChild(el("td", "", String(shifts.length)));
    const first = shifts[0];
    const last = shifts[shifts.length - 1];
    row.appendChild(el("td", "", "(" + first.ax.toFixed(1) + "," + first.ay.toFixed(1) + ")"));
    row.appendChild(el("td", "", "(" + last.bx.toFixed(1) + "," + last.by.toFixed(1) + ")"));
    table.appendChild(row);
  }
  box.appendChild(table);
  box.appendChild(el("div", "empty", "同色 = 一条链；同一区域出现多色 = 多个候选/多条链，不一定是同一笔。"));
}

function select(index) {
  const sample = DATA.samples[index];
  if (!sample) return;
  selected = index;
  for (const card of document.querySelectorAll(".card")) card.classList.toggle("active", Number(card.dataset.index) === index);
  $("#detailTitle").textContent = "这一帧的脑内状态 · 样本 #" + sample.index + (sample.correct ? " · 正确" : " · 错误");
  drawFrame($("#big"), sample, 176);
  renderParts(sample);
  $("#verdict").innerHTML = "";
  $("#verdict").appendChild(el("div", sample.correct ? "ok" : "bad", (sample.correct ? "✓ " : "✗ ") + verdictText(sample)));
  renderFlow(sample);
  renderChains(sample);
  const layers = $("#layers"); layers.innerHTML = "";
  for (let layer = 0; layer < 5; layer++) {
    const entries = sample.layers[layer] || [];
    const box = el("div", "layer");
    box.appendChild(el("h3", "", NAMES[layer] + " · " + entries.length));
    if (entries.length === 0) box.appendChild(el("div", "empty", "这一层没有被用到"));
    const rows = el("div", "rows");
    for (const entry of entries) {
      const row = el("div", "row");
      const label = el("span", "label", entry.label);
      label.dataset.tip = tipOf(entry.label);
      label.title = label.dataset.tip;
      row.appendChild(label);
      row.appendChild(el("span", "count", "×" + entry.count));
      row.appendChild(el("span", "truth", entry.c > 0 ? ("f=" + entry.f.toFixed(3) + " c=" + entry.c.toFixed(3)) : "—"));
      rows.appendChild(row);
    }
    box.appendChild(rows); layers.appendChild(box);
  }
}

function renderTabs() {
  const box = $("#sampleTabs"); box.innerHTML = "";
  const right = DATA.samples.filter(function (sample) { return sample.correct; }).length;
  const wrong = DATA.samples.length - right;
  if (wrong === 0 && activeTab === "wrong") activeTab = "right";
  const tabs = [{ key: "wrong", label: "错误 " + wrong }, { key: "right", label: "正确 " + right }];
  tabs.forEach(function (tab) {
    const button = el("button", tab.key === activeTab ? "active" : "", tab.label);
    button.addEventListener("click", function () {
      activeTab = tab.key; selected = -1;
      const siblings = box.querySelectorAll("button");
      for (const other of siblings) other.classList.toggle("active", other === button);
      renderGallery();
    });
    box.appendChild(button);
  });
}

function renderGallery() {
  const gallery = $("#gallery"); gallery.innerHTML = "";
  const visible = DATA.samples.filter(function (sample) { return activeTab === "right" ? sample.correct : !sample.correct; });
  if (visible.length === 0) { gallery.appendChild(el("div", "empty", "这个标签下没有样本")); return; }
  const indexes = new Set(visible.map(function (sample) { return DATA.samples.indexOf(sample); }));
  if (!indexes.has(selected)) selected = DATA.samples.indexOf(visible[0]);
  visible.forEach(function (sample) {
    const index = DATA.samples.indexOf(sample);
    const card = el("button", "card " + (sample.correct ? "right" : "wrong")); card.dataset.index = String(index);
    const canvas = el("canvas"); draw(canvas, sample.grid, 52);
    const meta = el("div", "meta");
    meta.appendChild(el("div", sample.correct ? "ok" : "bad", (sample.correct ? "✓ " : "✗ ") + "真 " + sample.digit + " → 判 " + (sample.pred === null ? "?" : sample.pred)));
    meta.appendChild(el("div", "truth", "f=" + sample.f.toFixed(2) + " c=" + sample.c.toFixed(2)));
    card.appendChild(canvas); card.appendChild(meta);
    card.addEventListener("click", function () { select(index); });
    gallery.appendChild(card);
  });
  select(selected);
}

const tipBox = $("#tip");
function moveTip(event) {
  if (tipBox.style.display !== "block") return;
  const pad = 14;
  const x = Math.min(window.innerWidth - tipBox.offsetWidth - pad, event.clientX + pad);
  const y = Math.min(window.innerHeight - tipBox.offsetHeight - pad, event.clientY + pad);
  tipBox.style.left = Math.max(pad, x) + "px";
  tipBox.style.top = Math.max(pad, y) + "px";
}
document.addEventListener("mouseover", function (event) {
  const target = event.target.closest ? event.target.closest("[data-tip]") : null;
  if (!target) return;
  tipBox.textContent = target.dataset.tip;
  tipBox.style.display = "block";
  moveTip(event);
});
document.addEventListener("mousemove", moveTip);
document.addEventListener("mouseout", function (event) {
  const target = event.target.closest ? event.target.closest("[data-tip]") : null;
  if (target) tipBox.style.display = "none";
});

function renderRanking(filter) {
  const body = $("#rank"); body.innerHTML = "";
  const needle = (filter || "").toLowerCase();
  const rows = DATA.ranking.filter(function (entry) {
    if (layerFilter !== "all" && entry.layer !== Number(layerFilter)) return false;
    return !needle || entry.label.toLowerCase().indexOf(needle) >= 0;
  }).sort(function (a, b) {
    return b.count - a.count || b.c - a.c || a.label.localeCompare(b.label);
  });
  rows.forEach(function (entry, index) {
    const row = el("tr");
    row.appendChild(el("td", "", String(index + 1)));
    row.appendChild(el("td", "", String(entry.layer)));
    const label = el("td", "label", entry.label); label.dataset.tip = tipOf(entry.label); label.title = label.dataset.tip;
    row.appendChild(label);
    row.appendChild(el("td", "", "×" + entry.count));
    row.appendChild(el("td", "", entry.c > 0 ? entry.f.toFixed(3) : "—"));
    row.appendChild(el("td", "", entry.c > 0 ? entry.c.toFixed(3) : "—"));
    body.appendChild(row);
  });
  if (rows.length === 0) { const row = el("tr"); const cell = el("td", "empty", "没有匹配的概念"); cell.colSpan = 6; row.appendChild(cell); body.appendChild(row); }
}
function renderConfusion() {
  const box = $("#confusion"); const table = el("table");
  const head = el("tr"); head.appendChild(el("th", "", "真 \\ 判"));
  for (let d = 0; d < 10; d++) head.appendChild(el("th", "", "digit_" + d));
  head.appendChild(el("th", "", "合计")); table.appendChild(head);
  for (let truth = 0; truth < 10; truth++) {
    const row = el("tr"); row.appendChild(el("th", "", "digit_" + truth));
    for (let pred = 0; pred < 10; pred++) {
      const count = DATA.confusion[truth][pred];
      const cell = el("td", truth === pred ? "hit" : (count > 0 ? "miss" : ""), String(count));
      if (count > 0 && truth !== pred) cell.style.background = "rgba(255,122,122," + Math.min(0.45, count / 20) + ")";
      row.appendChild(cell);
    }
    row.appendChild(el("td", "", String(DATA.classTotals[truth])));
    table.appendChild(row);
  }
  box.appendChild(table);
}
const requestedSample = DATA.samples.find(function (sample) { return sample.index === Number(new URLSearchParams(location.search).get("sample")); });
if (requestedSample) activeTab = requestedSample.correct ? "right" : "wrong";
renderTabs();
renderGallery();
if (requestedSample) select(DATA.samples.indexOf(requestedSample));
renderRanking("");
renderConfusion();
$("#search").addEventListener("input", function (event) { renderRanking(event.target.value); });
const layerButtons = document.querySelectorAll(".filters button");
layerButtons.forEach(function (button) {
  button.addEventListener("click", function () {
    layerFilter = button.dataset.layer;
    layerButtons.forEach(function (other) { other.classList.toggle("active", other === button); });
    renderRanking($("#search").value);
  });
});
</script>
</body>
</html>`;
}

/** 给 report.json 一个稳定的排序（次数降序，其次置信度降序，再按标签） */
export function rankConcepts(entries: ConceptUse[], limit: number): ConceptUse[] {
  return [...entries]
    .sort((a, b) => b.count - a.count || b.c - a.c || a.label.localeCompare(b.label))
    .slice(0, limit);
}

/** 预留：HTML 里若要把标签当文本插入，用这个；目前全部走 textContent。 */
export const escapeText = escapeHtml;
