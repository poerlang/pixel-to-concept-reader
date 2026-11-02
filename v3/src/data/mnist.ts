/**
 * MNIST 读取：复制自 pdftest6/public/mnist。
 * mnist.bin 是 9761 张 28×28、每像素 1 字节的原始灰度图直接拼接，无文件头；
 * 每张属于哪个数字由 mnist.json 的 segments 给出。
 */

export type MnistSegment = {
  digit: number
  start: number
  count: number
}

export type MnistMeta = {
  /** 边长，固定 28 */
  size: number
  /** 每张字节数，固定 784 */
  bytesPerImage: number
  /** 每类张数 */
  perDigit: number[]
  /** 总张数 */
  total: number
  segments: MnistSegment[]
}

export type MnistData = {
  meta: MnistMeta
  bytes: Uint8Array
}

const META_URL = `${import.meta.env.BASE_URL}mnist/mnist.json`
const BIN_URL = `${import.meta.env.BASE_URL}mnist/mnist.bin`

/** 单文件打包器注入的数据节点 id */
const EMBEDDED_META_ID = 'pdftest8-mnist-meta'
const EMBEDDED_BIN_ID = 'pdftest8-mnist-bin'

function base64ToBytes(text: string): Uint8Array {
  const binary = atob(text.replace(/\s+/g, ''))
  const bytes = new Uint8Array(binary.length)
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index)
  }
  return bytes
}

/** 读取打包器嵌入的 MNIST；开发服务器没有这两个节点，返回 null */
function readEmbeddedMnist(): MnistData | null {
  if (typeof document === 'undefined') return null
  const metaNode = document.getElementById(EMBEDDED_META_ID)
  const binNode = document.getElementById(EMBEDDED_BIN_ID)
  if (!metaNode?.textContent || !binNode?.textContent) return null

  const meta = JSON.parse(metaNode.textContent) as MnistMeta
  const bytes = base64ToBytes(binNode.textContent)
  const expected = meta.total * meta.bytesPerImage
  if (bytes.length !== expected) {
    throw new Error(`嵌入的 mnist.bin 长度 ${bytes.length}，期望 ${expected}`)
  }
  return { meta, bytes }
}

/** 拉取 meta + 二进制；单文件版直接读注入数据，不访问外部文件 */
export async function loadMnist(): Promise<MnistData> {
  const embedded = readEmbeddedMnist()
  if (embedded) return embedded

  const [metaResponse, binResponse] = await Promise.all([fetch(META_URL), fetch(BIN_URL)])
  if (!metaResponse.ok) throw new Error(`mnist.json 读取失败（${metaResponse.status}）`)
  if (!binResponse.ok) throw new Error(`mnist.bin 读取失败（${binResponse.status}）`)
  const meta = (await metaResponse.json()) as MnistMeta
  const bytes = new Uint8Array(await binResponse.arrayBuffer())
  const expected = meta.total * meta.bytesPerImage
  if (bytes.length !== expected) {
    throw new Error(`mnist.bin 长度 ${bytes.length}，期望 ${expected}`)
  }
  return { meta, bytes }
}

/** 取第 index 张的 784 字节（拷贝，可安全修改） */
export function readPixels(data: MnistData, index: number): Uint8Array {
  const offset = index * data.meta.bytesPerImage
  return data.bytes.slice(offset, offset + data.meta.bytesPerImage)
}

/** 第 index 张属于哪个数字 */
export function digitAt(meta: MnistMeta, index: number): number {
  for (const segment of meta.segments) {
    if (index >= segment.start && index < segment.start + segment.count) return segment.digit
  }
  return -1
}

/** 从某数字的区间里随机抽 count 张（不重复） */
export function sampleIndices(meta: MnistMeta, digit: number, count: number): number[] {
  const segment = meta.segments.find((entry) => entry.digit === digit)
  if (!segment) return []
  const picked: number[] = []
  const seen = new Set<number>()
  let guard = 0
  while (picked.length < count && guard < count * 40) {
    guard += 1
    const index = segment.start + Math.floor(Math.random() * segment.count)
    if (seen.has(index)) continue
    seen.add(index)
    picked.push(index)
  }
  return picked
}
