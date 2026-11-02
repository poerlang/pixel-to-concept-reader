import { computed, ref, watch } from 'vue'
import { QuadTree } from '../lib/quadtree.ts'
import { PIXEL_COUNT, type LibrarySample, type SceneItem } from './types.ts'

/** localStorage 键 */
const STORAGE_KEY = 'pdftest8::scene::v1'
/** 场景对象上限 */
const MAX_ITEMS = 300
/** 自动保存防抖 */
const AUTOSAVE_DELAY = 900

const items = ref<SceneItem[]>([])
const selectedId = ref<string | null>(null)
/** 素材库里被点选、等待放置的样本 */
const pending = ref<LibrarySample | null>(null)
/** 正从素材库拖向场景的样本（HTML5 拖拽期间读不到 dataTransfer） */
const dragSample = ref<LibrarySample | null>(null)
const showQuadtree = ref(true)
const showLabels = ref(false)
const savedAt = ref<number | null>(null)
const notice = ref('')

/** 四叉树随对象位置重建（拖动时每帧重建，对象量级 300 以内足够快） */
const quadtree = computed(() => {
  const tree = new QuadTree<SceneItem>(4, 6)
  for (const item of items.value) {
    tree.insert({ x: item.x, y: item.y, span: item.radius, data: item })
  }
  return tree
})

const treeStats = computed(() => {
  const tree = quadtree.value
  return {
    items: items.value.length,
    nodes: tree.nodeCount,
    depth: tree.depth,
    leaves: tree.leafCount,
  }
})

const selected = computed(() => items.value.find((item) => item.id === selectedId.value) ?? null)
const selectedIndex = computed(() => items.value.findIndex((item) => item.id === selectedId.value))

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

let idSeed = 0
function makeId(): string {
  idSeed += 1
  return `it-${Date.now().toString(36)}-${idSeed.toString(36)}`
}

let noticeTimer: ReturnType<typeof setTimeout> | null = null
/** 顶部短提示 */
function flash(message: string) {
  notice.value = message
  if (noticeTimer) clearTimeout(noticeTimer)
  noticeTimer = setTimeout(() => {
    notice.value = ''
  }, 2600)
}

/** 从中心向外找一个不重叠的位置 */
function findFreeSpot(radius: number): { x: number; y: number } {
  const candidates: { x: number; y: number }[] = [{ x: 0.5, y: 0.5 }]
  for (let ring = 1; ring <= 5; ring++) {
    for (let step = 0; step < 8; step++) {
      const angle = (Math.PI * 2 * step) / 8 + ring * 0.5
      candidates.push({
        x: 0.5 + Math.cos(angle) * 0.1 * ring,
        y: 0.5 + Math.sin(angle) * 0.1 * ring,
      })
    }
  }
  for (const spot of candidates) {
    const x = clamp(spot.x, radius, 1 - radius)
    const y = clamp(spot.y, radius, 1 - radius)
    const overlapped = items.value.some(
      (item) =>
        Math.abs(item.x - x) < item.radius + radius && Math.abs(item.y - y) < item.radius + radius,
    )
    if (!overlapped) return { x, y }
  }
  return { x: radius + Math.random() * (1 - radius * 2), y: radius + Math.random() * (1 - radius * 2) }
}

/** 把一条素材放进场景；不给坐标就自动找空位 */
function addSample(sample: LibrarySample, at?: { x: number; y: number }): SceneItem | null {
  if (items.value.length >= MAX_ITEMS) {
    flash(`场景最多 ${MAX_ITEMS} 个对象`)
    return null
  }
  const radius = 0.075
  const spot = at ? { x: at.x, y: at.y } : findFreeSpot(radius)
  const item: SceneItem = {
    id: makeId(),
    kind: sample.kind,
    label: sample.label,
    source: sample.source,
    x: clamp(spot.x, radius, 1 - radius),
    y: clamp(spot.y, radius, 1 - radius),
    radius,
    invert: false,
    pixels: sample.pixels.slice(),
  }
  items.value.push(item)
  selectedId.value = item.id
  pending.value = null
  return item
}

function removeItem(id: string) {
  const index = items.value.findIndex((item) => item.id === id)
  if (index < 0) return
  items.value.splice(index, 1)
  if (selectedId.value === id) selectedId.value = items.value[Math.min(index, items.value.length - 1)]?.id ?? null
}

function updateItem(id: string, patch: Partial<Omit<SceneItem, 'id'>>) {
  const item = items.value.find((entry) => entry.id === id)
  if (!item) return
  Object.assign(item, patch)
}

function setPixels(id: string, pixels: Uint8Array) {
  const item = items.value.find((entry) => entry.id === id)
  if (!item) return
  item.pixels = pixels
}

function duplicateItem(id: string) {
  const item = items.value.find((entry) => entry.id === id)
  if (!item) return
  if (items.value.length >= MAX_ITEMS) {
    flash(`场景最多 ${MAX_ITEMS} 个对象`)
    return
  }
  const copy: SceneItem = {
    ...item,
    id: makeId(),
    x: clamp(item.x + 0.045, item.radius, 1 - item.radius),
    y: clamp(item.y + 0.045, item.radius, 1 - item.radius),
    pixels: item.pixels.slice(),
  }
  items.value.push(copy)
  selectedId.value = copy.id
}

function bringToFront(id: string) {
  const index = items.value.findIndex((item) => item.id === id)
  if (index < 0 || index === items.value.length - 1) return
  const [item] = items.value.splice(index, 1)
  if (item) items.value.push(item)
}

function sendToBack(id: string) {
  const index = items.value.findIndex((item) => item.id === id)
  if (index <= 0) return
  const [item] = items.value.splice(index, 1)
  if (item) items.value.unshift(item)
}

function select(id: string | null) {
  selectedId.value = id
}

/** 开始从素材库拖一个样本 */
function beginDrag(sample: LibrarySample) {
  dragSample.value = sample
}

/** 拖拽结束（放下、取消或离开都算） */
function endDrag() {
  dragSample.value = null
}

function clearScene() {
  if (!items.value.length) return
  items.value = []
  selectedId.value = null
  flash('场景已清空')
}

/** ---------- 存取 ---------- */

type SavedItem = {
  id: string
  kind: SceneItem['kind']
  label: string
  source: string
  x: number
  y: number
  radius: number
  invert: boolean
  pixels: string
}

type SavedScene = {
  version: 1
  savedAt: number
  items: SavedItem[]
}

function encodePixels(pixels: Uint8Array): string {
  let binary = ''
  const chunk = 0x8000
  for (let offset = 0; offset < pixels.length; offset += chunk) {
    binary += String.fromCharCode(...pixels.subarray(offset, offset + chunk))
  }
  return btoa(binary)
}

function decodePixels(text: string): Uint8Array {
  const binary = atob(text)
  const pixels = new Uint8Array(binary.length)
  for (let index = 0; index < binary.length; index++) pixels[index] = binary.charCodeAt(index)
  return pixels
}

function serialize(): SavedScene {
  return {
    version: 1,
    savedAt: Date.now(),
    items: items.value.map((item) => ({
      id: item.id,
      kind: item.kind,
      label: item.label,
      source: item.source,
      x: item.x,
      y: item.y,
      radius: item.radius,
      invert: item.invert,
      pixels: encodePixels(item.pixels),
    })),
  }
}

function deserialize(raw: unknown): SceneItem[] {
  if (!raw || typeof raw !== 'object') throw new Error('不是场景文件')
  const data = raw as Partial<SavedScene>
  if (!Array.isArray(data.items)) throw new Error('缺少 items 字段')
  const restored: SceneItem[] = []
  for (const entry of data.items.slice(0, MAX_ITEMS)) {
    const source = entry as Partial<SavedItem>
    if (
      typeof source.id !== 'string' ||
      (source.kind !== 'mnist' && source.kind !== 'shape') ||
      typeof source.x !== 'number' ||
      typeof source.y !== 'number' ||
      typeof source.radius !== 'number' ||
      typeof source.pixels !== 'string'
    ) {
      throw new Error('对象字段不完整')
    }
    const pixels = decodePixels(source.pixels)
    if (pixels.length !== PIXEL_COUNT) throw new Error('像素长度不是 784')
    restored.push({
      id: source.id,
      kind: source.kind,
      label: typeof source.label === 'string' ? source.label : '未命名',
      source: typeof source.source === 'string' ? source.source : '',
      x: clamp(source.x, 0, 1),
      y: clamp(source.y, 0, 1),
      radius: clamp(source.radius, 0.02, 0.5),
      invert: source.invert === true,
      pixels,
    })
  }
  return restored
}

function replaceItems(next: SceneItem[]) {
  items.value = next
  selectedId.value = next[0]?.id ?? null
}

/** 写 localStorage */
function save(silent = false): boolean {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(serialize()))
    savedAt.value = Date.now()
    if (!silent) flash(`已保存 ${items.value.length} 个对象`)
    return true
  } catch (error) {
    flash(`保存失败：${(error as Error).message}`)
    return false
  }
}

/** 读 localStorage，返回是否读到了内容 */
function loadFromStorage(): boolean {
  let text: string | null = null
  try {
    text = localStorage.getItem(STORAGE_KEY)
  } catch {
    return false
  }
  if (!text) return false
  try {
    replaceItems(deserialize(JSON.parse(text)))
    savedAt.value = Date.now()
    return true
  } catch (error) {
    flash(`本地存档损坏：${(error as Error).message}`)
    return false
  }
}

/** 导出 JSON 文件 */
function exportFile() {
  const payload = JSON.stringify(serialize(), null, 2)
  const blob = new Blob([payload], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = `scene-${stamp}.json`
  anchor.click()
  URL.revokeObjectURL(url)
  flash('已导出 JSON')
}

/** 导入 JSON 文件 */
async function importFile(file: File) {
  const text = await file.text()
  const next = deserialize(JSON.parse(text))
  replaceItems(next)
  save(true)
  flash(`已导入 ${next.length} 个对象`)
}

/** 自动保存：对象有任何改动，停顿 900ms 后落盘 */
let saveTimer: ReturnType<typeof setTimeout> | null = null
watch(
  items,
  () => {
    if (saveTimer) clearTimeout(saveTimer)
    saveTimer = setTimeout(() => {
      saveTimer = null
      save(true)
    }, AUTOSAVE_DELAY)
  },
  { deep: true },
)

export function useScene() {
  return {
    items,
    selected,
    selectedId,
    selectedIndex,
    pending,
    dragSample,
    showQuadtree,
    showLabels,
    savedAt,
    notice,
    quadtree,
    treeStats,
    addSample,
    removeItem,
    updateItem,
    setPixels,
    duplicateItem,
    bringToFront,
    sendToBack,
    select,
    beginDrag,
    endDrag,
    clearScene,
    save,
    loadFromStorage,
    exportFile,
    importFile,
    flash,
  }
}
