/**
 * 打包当前工作台为一个真正独立的 HTML：
 *   1. Vite + vite-plugin-singlefile 把 JS/CSS 内联成 dist/index.html
 *   2. 把 public/mnist 的 meta 与二进制嵌进 HTML
 *   3. 运行时 loadMnist() 优先读嵌入数据，file:// 下不需要任何外部文件
 *
 * 运行：npm run pack:html
 * 输出：dist/pdftest8-standalone.html
 */

import { build } from 'vite'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'

const root = process.cwd()
const tempRoot = path.join(root, '.pack-tmp')
await mkdir(tempRoot, { recursive: true })
// 某些 Windows 环境的系统临时目录不可写；让 esbuild 用工作区临时目录
process.env.TMP = tempRoot
process.env.TEMP = tempRoot
// vite.config.ts 会据此关闭压缩并使用 esnext，避免 esbuild 清理临时压缩文件时报 Access denied
process.env.PACK_STANDALONE = '1'

await build({ root, logLevel: 'warn' })

const htmlPath = path.join(root, 'dist', 'index.html')
const metaPath = path.join(root, 'public', 'mnist', 'mnist.json')
const binPath = path.join(root, 'public', 'mnist', 'mnist.bin')
const outputPath = path.join(root, 'dist', 'pdftest8-standalone.html')

let html = await readFile(htmlPath, 'utf8')
const meta = await readFile(metaPath, 'utf8')
const binary = await readFile(binPath)

const metaSafe = meta.replace(/<\/script/gi, '<\\/script')
const base64 = binary.toString('base64')

if (/id=["']pdftest8-mnist-(?:meta|bin)["']/i.test(html)) {
  throw new Error('dist/index.html 已经包含 MNIST 注入节点，拒绝重复打包')
}
if (!/<\/body>/i.test(html)) throw new Error('dist/index.html 缺少 </body>')

const injection = `
  <!-- pdftest8 standalone data：运行时优先读这两个节点 -->
  <script id="pdftest8-mnist-meta" type="application/json">${metaSafe}</script>
  <script id="pdftest8-mnist-bin" type="application/octet-stream">${base64}</script>
`

html = html.replace(/<\/body>/i, `${injection}</body>`)

const externalRefs = [...html.matchAll(/<(?:script|link)\b[^>]*?(?:src|href)=["']([^"']+)["'][^>]*>/gi)]
  .map((match) => match[1] ?? '')
  .filter((url) => url && !url.startsWith('data:') && !url.startsWith('#'))

if (externalRefs.length > 0) {
  throw new Error(`单文件仍引用外部资源：${externalRefs.join(', ')}`)
}

await writeFile(outputPath, html, 'utf8')

const mb = (bytes: number) => `${(bytes / 1024 / 1024).toFixed(2)} MB`
console.log(`standalone: ${path.relative(root, outputPath)}`)
console.log(`  html: ${mb(Buffer.byteLength(html))}`)
console.log(`  mnist: ${mb(binary.byteLength)} (base64 ${mb(base64.length)})`)
console.log('  external refs: none')
