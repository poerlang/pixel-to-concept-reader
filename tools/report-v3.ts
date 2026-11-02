// 把三个只读报告合成一个单 HTML 文件：测试报告 / 粗点演算 / Shift 逐帧。
//
// 三个子页面都已经自包含；这里用内联 iframe srcdoc 合并，避免引入外部文件。

import { readFileSync, writeFileSync } from "node:fs";

const pages = [
  { id: "report", title: "测试报告", source: "test_report_v2.html", file: readFileSync("test_report_v2.html", "utf8") },
  { id: "coarse", title: "粗点演算", source: "coarse_player.html", file: readFileSync("coarse_player.html", "utf8") },
  { id: "trace", title: "Shift 逐帧", source: "trace_player.html", file: readFileSync("trace_player.html", "utf8") },
];

const attr = (value: string): string => value
  .replace(/&/g, "&amp;")
  .replace(/"/g, "&quot;")
  .replace(/</g, "&lt;")
  .replace(/>/g, "&gt;");

const tabs = pages.map((page, index) =>
  `<button class="tab${index === 0 ? " active" : ""}" type="button" data-tab="${page.id}">${page.title}</button>`).join("");
const frames = pages.map((page, index) =>
  `<iframe class="view${index === 0 ? " active" : ""}" id="${page.id}" title="${page.title}" data-source="${page.source}" srcdoc="${attr(page.file)}"></iframe>`).join("\n");

const html = `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Pixel to Concept Reader v3</title>
<style>
:root{color-scheme:dark;--bg:#08090b;--panel:#111318;--line:#252a33;--text:#e8e8ea;--muted:#8b93a1;--accent:#d8ff5f}
*{box-sizing:border-box}
html,body{height:100%}
body{margin:0;background:var(--bg);color:var(--text);font:13px/1.4 ui-monospace,Consolas,monospace}
header{height:54px;display:flex;align-items:center;gap:18px;padding:0 18px;border-bottom:1px solid var(--line);background:var(--panel)}
h1{font-size:15px;margin:0;letter-spacing:-.02em;white-space:nowrap}
h1 small{font-size:10px;color:var(--accent);font-weight:400}
nav{display:flex;gap:6px;flex-wrap:wrap}
button{appearance:none;border:1px solid #3a4658;background:#151a21;color:var(--muted);padding:6px 10px;font:inherit;cursor:pointer}
button:hover{border-color:#6b7788;color:var(--text)}
button.active{border-color:var(--accent);color:var(--accent)}
main{height:calc(100vh - 54px);position:relative}
iframe{display:none;width:100%;height:100%;border:0;background:var(--bg)}
iframe.active{display:block}
footer{padding:4px 18px;color:var(--muted);font-size:10px;border-top:1px solid var(--line);background:var(--panel)}
a{color:var(--accent)}
</style>
</head>
<body>
<header>
  <h1>Pixel to Concept Reader <small>v3 · 单文件</small></h1>
  <nav>${tabs}</nav>
</header>
<main>${frames}</main>
<footer>三个视图共用同一份内联数据，不依赖外部文件。粗点演算和 Shift 逐帧只读，不训练、不改写记忆。</footer>
<script>
const tabs = [...document.querySelectorAll('.tab')];
const views = [...document.querySelectorAll('iframe.view')];
let selectedId = 'circle_1';

function broadcast() {
  const message = { type: 'visual-select', id: selectedId };
  for (const view of views) {
    if (view.id === 'coarse' || view.id === 'trace') view.contentWindow?.postMessage(message, '*');
  }
}

function select(id) {
  for (const tab of tabs) tab.classList.toggle('active', tab.dataset.tab === id);
  for (const view of views) view.classList.toggle('active', view.id === id);
  history.replaceState(null, '', '#' + id);
  broadcast();
}
for (const tab of tabs) tab.addEventListener('click', () => select(tab.dataset.tab));
window.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'visual-select' && typeof event.data.id === 'string') {
    selectedId = event.data.id;
    broadcast();
  }
});
for (const view of views) view.addEventListener('load', broadcast);
const initial = location.hash.slice(1);
if (initial && views.some((view) => view.id === initial)) select(initial);
</script>
</body>
</html>`;

writeFileSync("test_report_v3.html", html, "utf8");
console.log(`report: test_report_v3.html`);
for (const page of pages) console.log(`  ${page.title}: ${page.source} (${page.file.length} bytes inline)`);
