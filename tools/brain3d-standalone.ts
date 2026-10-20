// 把 3D 认知场编译成一个自带 Three.js 与数据的 HTML 单文件。
//
//   node tools/brain3d-standalone.ts [input.html] [output.html]
//
// 默认输入 public/brain3d/index.html，输出 public/brain3d/brain3d.standalone.html。
// 依赖 pdftest4 的 rolldown（与 three.js 同一来源），只用于构建；运行时不依赖服务器。

import { existsSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

const ROOT = resolve("public/brain3d");
const input = resolve(process.argv[2] ?? `${ROOT}/index.html`);
const output = resolve(process.argv[3] ?? `${ROOT}/brain3d.standalone.html`);

if (!existsSync(input)) throw new Error(`没有 ${input}`);
if (!existsSync(`${ROOT}/data.js`)) throw new Error("没有 data.js；先跑 node tools/brain3d.ts");

const rolldownPath = resolve("../pdftest4/node_modules/rolldown/dist/index.mjs");
if (!existsSync(rolldownPath)) throw new Error(`没有 rolldown：${rolldownPath}`);
const { rolldown } = (await import(pathToFileURL(rolldownPath).href)) as {
  rolldown: (options: Record<string, unknown>) => Promise<{
    generate: (options: Record<string, unknown>) => Promise<{ output: Array<{ type: string; code?: string; fileName?: string }> }>;
    close: () => Promise<void>;
  }>;
};

const bundle = await rolldown({
  input: resolve(ROOT, "app.js"),
  platform: "browser",
});
const generated = await bundle.generate({
  format: "iife",
  name: "Brain3D",
  minify: true,
  sourcemap: false,
});
await bundle.close();

const chunks = generated.output.filter((item) => item.type === "chunk" && item.code);
if (chunks.length === 0) throw new Error("rolldown 没有产出 chunk");
const code = chunks.map((item) => item.code).join("\n").replace(/<\/script/gi, "<\\/script");

const html = readFileSync(input, "utf8");
const scriptTag = /<script\s+type="module"\s+src="\.\/app\.js"\s*><\/script>/i;
if (!scriptTag.test(html)) throw new Error("index.html 里找不到 app.js 的 module script");
const inlined = html.replace(scriptTag, () => `<script>\n${code}\n</script>`);
writeFileSync(output, inlined);

const kb = (bytes: number): string => `${Math.round(bytes / 1024)} KB`;
console.log(`单文件：${output}`);
console.log(`  HTML ${kb(Buffer.byteLength(inlined))} · JS ${kb(Buffer.byteLength(code))} · 源页 ${kb(statSync(input).size)}`);
console.log("  直接双击打开即可；不需要服务器、不需要 public/brain3d/vendor/。");
