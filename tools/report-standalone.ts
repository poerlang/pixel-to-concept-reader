// 把已生成的 test_report.html 封装为独立发布文件。
//
// 报告本身不引用外部脚本/样式/图片；这里只做校验并复制到 test_report_v2.html，
// 方便别人直接打开或放到静态站点。

import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const source = resolve("test_report.html");
const html = readFileSync(source, "utf8");

const external = [
  /<script[^>]+src\s*=/i,
  /<link[^>]+href\s*=/i,
  /url\(\s*["']?https?:/i,
  /<(?:img|source|audio|video)[^>]+src\s*=\s*["']https?:/i,
].find((pattern) => pattern.test(html));

if (external) {
  throw new Error(`报告仍引用外部资源：${external}`);
}

writeFileSync("test_report_v2.html", html, "utf8");
console.log(`standalone: test_report_v2.html (${html.length} bytes)`);
