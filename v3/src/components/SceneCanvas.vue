<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import type { QuadNode } from '../lib/quadtree.ts'
import { boardSnapshot, shiftTrace } from '../nars/index.ts'
import { narsRevision } from '../narsLive.ts'
import { appliedId } from '../runtime.ts'
import { useScene } from '../scene/store.ts'
import { IMAGE_SIDE, type SceneItem } from '../scene/types.ts'

type Point = { x: number; y: number }

const {
  items,
  selectedId,
  pending,
  dragSample,
  quadtree,
  showQuadtree,
  showLabels,
  addSample,
  removeItem,
  select,
  updateItem,
  endDrag,
  flash,
} = useScene()

const wrapRef = ref<HTMLDivElement | null>(null)
const canvasRef = ref<HTMLCanvasElement | null>(null)
const hoverId = ref<string | null>(null)
/** 指针是否压在某个形状右下角的缩放手柄上 */
const handleHover = ref(false)
const pointer = ref<Point | null>(null)
const busy = ref(false)

/** 画布尺寸（CSS 像素）与 world 在画布中的落位 */
const viewport = { w: 0, h: 0, dpr: 1 }
const world = { x: 0, y: 0, size: 0 }

let frame = 0
const mode = ref<'idle' | 'drag' | 'resize'>('idle')
let activeId: string | null = null
let dragOffset: Point = { x: 0, y: 0 }
let observer: ResizeObserver | null = null

const cursor = computed(() => {
  if (pending.value) return 'crosshair'
  // 右下角手柄：悬停或正在拖着改大小，都显示缩放用的双箭头
  if (mode.value === 'resize' || handleHover.value) return 'nwse-resize'
  if (mode.value === 'drag' || busy.value) return 'grabbing'
  if (hoverId.value) return 'grab'
  return 'default'
})

/* ---------- 位图缓存：同一个 Uint8Array 只转一次 ---------- */

const bitmapCache = new WeakMap<Uint8Array, { normal: HTMLCanvasElement; inverted: HTMLCanvasElement }>()

function makeBitmap(pixels: Uint8Array, invert: boolean): HTMLCanvasElement {
  const canvas = document.createElement('canvas')
  canvas.width = IMAGE_SIDE
  canvas.height = IMAGE_SIDE
  const context = canvas.getContext('2d')
  if (!context) return canvas
  const image = context.createImageData(IMAGE_SIDE, IMAGE_SIDE)
  for (let index = 0; index < IMAGE_SIDE * IMAGE_SIDE; index++) {
    const value = pixels[index] ?? 0
    const shown = invert ? 255 - value : value
    const offset = index * 4
    image.data[offset] = shown
    image.data[offset + 1] = shown
    image.data[offset + 2] = shown
    image.data[offset + 3] = 255
  }
  context.putImageData(image, 0, 0)
  return canvas
}

function bitmapFor(pixels: Uint8Array, invert: boolean): HTMLCanvasElement {
  let pair = bitmapCache.get(pixels)
  if (!pair) {
    pair = { normal: makeBitmap(pixels, false), inverted: makeBitmap(pixels, true) }
    bitmapCache.set(pixels, pair)
  }
  return invert ? pair.inverted : pair.normal
}

/* ---------- 绘制 ---------- */

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  const radius = Math.max(0, Math.min(r, w / 2, h / 2))
  ctx.beginPath()
  ctx.moveTo(x + radius, y)
  ctx.arcTo(x + w, y, x + w, y + h, radius)
  ctx.arcTo(x + w, y + h, x, y + h, radius)
  ctx.arcTo(x, y + h, x, y, radius)
  ctx.arcTo(x, y, x + w, y, radius)
  ctx.closePath()
}

function syncViewport() {
  const wrap = wrapRef.value
  if (!wrap) return
  viewport.w = wrap.clientWidth
  viewport.h = wrap.clientHeight
  viewport.dpr = Math.min(2, window.devicePixelRatio || 1)
}

function drawQuadtree(ctx: CanvasRenderingContext2D) {
  const size = world.size
  quadtree.value.forEachNode((node: QuadNode<SceneItem>) => {
    if (node.depth === 0) return
    const x = world.x + node.x0 * size
    const y = world.y + node.y0 * size
    const w = (node.x1 - node.x0) * size
    const h = (node.y1 - node.y0) * size
    ctx.strokeStyle = `rgba(94, 240, 200, ${(0.07 + node.depth * 0.07).toFixed(3)})`
    ctx.lineWidth = 1
    ctx.strokeRect(Math.round(x) + 0.5, Math.round(y) + 0.5, Math.round(w), Math.round(h))
  })
}

function drawItem(ctx: CanvasRenderingContext2D, item: SceneItem) {
  const size = world.size
  const cx = world.x + item.x * size
  const cy = world.y + item.y * size
  const radius = item.radius * size
  const x = cx - radius
  const y = cy - radius
  const side = radius * 2
  const corner = Math.max(3, side * 0.1)
  const isSelected = item.id === selectedId.value
  const isHover = item.id === hoverId.value

  ctx.save()

  roundRect(ctx, x, y, side, side, corner)
  ctx.fillStyle = 'rgba(9, 15, 21, 0.96)'
  ctx.fill()

  if (side > 7) {
    ctx.save()
    roundRect(ctx, x, y, side, side, corner)
    ctx.clip()
    ctx.imageSmoothingEnabled = false
    const pad = Math.max(1, side * 0.025)
    ctx.drawImage(bitmapFor(item.pixels, item.invert), x + pad, y + pad, side - pad * 2, side - pad * 2)
    ctx.restore()
  }

  roundRect(ctx, x, y, side, side, corner)
  ctx.lineWidth = isSelected ? 2 : 1
  ctx.strokeStyle = isSelected
    ? '#5ef0c8'
    : isHover
      ? 'rgba(94, 240, 200, 0.5)'
      : 'rgba(255, 255, 255, 0.13)'
  ctx.stroke()

  if (isSelected) {
    const handle = Math.max(5, Math.min(9, side * 0.09))
    ctx.fillStyle = '#5ef0c8'
    ctx.fillRect(x + side - handle - 2, y + side - handle - 2, handle, handle)
  }

  if (showLabels.value && side > 16) {
    ctx.font = '10px "Segoe UI", system-ui, sans-serif'
    ctx.textAlign = 'center'
    ctx.textBaseline = 'top'
    ctx.fillStyle = 'rgba(142, 163, 176, 0.92)'
    ctx.fillText(item.label, cx, y + side + 4, side + 30)
  }

  ctx.restore()
}

function drawGhost(ctx: CanvasRenderingContext2D, pixels: Uint8Array, point: Point) {
  const size = world.size
  const radius = 0.075 * size
  const side = radius * 2
  const x = world.x + point.x * size - radius
  const y = world.y + point.y * size - radius
  const corner = Math.max(3, side * 0.1)

  ctx.save()
  ctx.globalAlpha = 0.72
  roundRect(ctx, x, y, side, side, corner)
  ctx.fillStyle = 'rgba(94, 240, 200, 0.1)'
  ctx.fill()
  ctx.save()
  ctx.clip()
  ctx.imageSmoothingEnabled = false
  ctx.drawImage(bitmapFor(pixels, false), x, y, side, side)
  ctx.restore()
  roundRect(ctx, x, y, side, side, corner)
  ctx.setLineDash([4, 3])
  ctx.strokeStyle = 'rgba(94, 240, 200, 0.75)'
  ctx.lineWidth = 1
  ctx.stroke()
  ctx.restore()
}

/** 扫描轨迹：细线 + 落点粒子 + 差刻度 + 当前 shift 矢量；只给 2D 调试看 */
function drawScanTrail(ctx: CanvasRenderingContext2D) {
  const item = items.value.find((entry) => entry.id === appliedId.value)
  const points = shiftTrace()
  if (!item || points.length < 2) return
  const size = world.size
  const radius = item.radius * size
  const side = radius * 2
  const pad = Math.max(1, side * 0.025)
  const inner = Math.max(1, side - pad * 2)
  const left = world.x + (item.x - item.radius) * size + pad
  const top = world.y + (item.y - item.radius) * size + pad
  const mapX = (value: number) => left + Math.min(1, Math.max(0, value)) * inner
  const mapY = (value: number) => top + Math.min(1, Math.max(0, value)) * inner
  const now = performance.now() * 0.004

  ctx.save()
  ctx.beginPath()
  ctx.rect(left, top, inner, inner)
  ctx.clip()

  // 轨迹：越旧越淡，整体保持细线
  for (let index = 1; index < points.length; index++) {
    const previous = points[index - 1]!
    const current = points[index]!
    const warmth = index / points.length
    ctx.beginPath()
    ctx.moveTo(mapX(previous.x), mapY(previous.y))
    ctx.lineTo(mapX(current.x), mapY(current.y))
    ctx.strokeStyle = `rgba(94, 240, 200, ${(0.07 + warmth * 0.28).toFixed(3)})`
    ctx.lineWidth = Math.max(0.8, inner * (0.005 + warmth * 0.006))
    ctx.stroke()
  }

  // 差刻度：相邻两次 shift 的变化量，用短垂线表示；接近 0 时变青
  for (let index = 2; index < points.length; index++) {
    const previous = points[index - 1]!
    const current = points[index]!
    const ddx = current.dx - previous.dx
    const ddy = current.dy - previous.dy
    const magnitude = Math.hypot(ddx, ddy)
    if (magnitude < 1e-5) continue
    const cx = mapX(current.x)
    const cy = mapY(current.y)
    const length = Math.min(5, 1.5 + magnitude * 18)
    const nx = -ddy / magnitude
    const ny = ddx / magnitude
    ctx.beginPath()
    ctx.moveTo(cx - nx * length, cy - ny * length)
    ctx.lineTo(cx + nx * length, cy + ny * length)
    ctx.strokeStyle =
      magnitude < 0.06 ? 'rgba(94, 240, 200, 0.38)' : 'rgba(240, 180, 41, 0.5)'
    ctx.lineWidth = 1.2
    ctx.stroke()
  }

  // 落点粒子：只画最近一段，避免堆叠
  const first = Math.max(0, points.length - 18)
  for (let index = first; index < points.length; index++) {
    const point = points[index]!
    const age = (index - first) / Math.max(1, points.length - first)
    const last = index === points.length - 1
    const pulse = 0.5 + 0.5 * Math.sin(now + index * 0.7)
    const radiusPx = Math.max(1.2, inner * (last ? 0.018 : 0.008 + age * 0.006))
    ctx.beginPath()
    ctx.arc(mapX(point.x), mapY(point.y), radiusPx * (0.85 + pulse * 0.3), 0, Math.PI * 2)
    ctx.fillStyle = last
      ? `rgba(240, 180, 41, ${0.62 + pulse * 0.3})`
      : `rgba(94, 240, 200, ${0.16 + age * 0.32})`
    ctx.fill()
  }

  // 当前 shift 矢量：从最后一个落点指向下一步方向
  const last = points[points.length - 1]!
  const tipX = Math.min(1, Math.max(0, last.x + last.dx))
  const tipY = Math.min(1, Math.max(0, last.y + last.dy))
  const fromX = mapX(last.x)
  const fromY = mapY(last.y)
  const toX = mapX(tipX)
  const toY = mapY(tipY)
  const dx = toX - fromX
  const dy = toY - fromY
  const length = Math.hypot(dx, dy)
  if (length > 2) {
    ctx.beginPath()
    ctx.moveTo(fromX, fromY)
    ctx.lineTo(toX, toY)
    ctx.strokeStyle = 'rgba(240, 180, 41, 0.65)'
    ctx.lineWidth = Math.max(1, inner * 0.007)
    ctx.stroke()
    const ux = dx / length
    const uy = dy / length
    const head = Math.max(3, inner * 0.022)
    ctx.beginPath()
    ctx.moveTo(toX, toY)
    ctx.lineTo(toX - ux * head - uy * head * 0.45, toY - uy * head + ux * head * 0.45)
    ctx.lineTo(toX - ux * head + uy * head * 0.45, toY - uy * head - ux * head * 0.45)
    ctx.closePath()
    ctx.fillStyle = 'rgba(240, 180, 41, 0.75)'
    ctx.fill()
  }
  ctx.restore()

  // 工业 HUD：贴着画幅上沿，克制、单色、固定尺寸
  const hudWidth = Math.min(148, Math.max(112, inner * 0.62))
  const hudHeight = 22
  const hudX = left + 2
  const hudY = top - hudHeight - 4 > world.y + 2 ? top - hudHeight - 4 : top + 3
  ctx.save()
  ctx.fillStyle = 'rgba(6, 12, 17, 0.78)'
  ctx.strokeStyle = 'rgba(94, 240, 200, 0.22)'
  ctx.lineWidth = 1
  ctx.beginPath()
  ctx.rect(hudX, hudY, hudWidth, hudHeight)
  ctx.fill()
  ctx.stroke()
  ctx.font = '9px "Cascadia Mono", "Consolas", monospace'
  ctx.textBaseline = 'middle'
  ctx.fillStyle = 'rgba(94, 240, 200, 0.72)'
  ctx.fillText('SHIFT', hudX + 7, hudY + 7.5)
  ctx.fillStyle = 'rgba(240, 180, 41, 0.85)'
  ctx.fillText(`Δ ${last.dx.toFixed(2)} ${last.dy.toFixed(2)}`, hudX + 7, hudY + 17)
  ctx.fillStyle = 'rgba(142, 163, 176, 0.8)'
  ctx.textAlign = 'right'
  ctx.fillText(`${points.length}`, hudX + hudWidth - 7, hudY + 7.5)
  ctx.fillText('TRACE', hudX + hudWidth - 7, hudY + 17)
  ctx.restore()
}

/** 扫描头：画在「当前喂给运行台的对象」上，坐标取自 NARS 视野 */
function drawScanHead(ctx: CanvasRenderingContext2D) {
  const item = items.value.find((entry) => entry.id === appliedId.value)
  if (!item) return
  const snapshot = boardSnapshot()
  const size = world.size
  const radius = item.radius * size
  const side = radius * 2
  const pad = Math.max(1, side * 0.025)
  const inner = Math.max(1, side - pad * 2)
  const x = world.x + (item.x - item.radius) * size + pad + snapshot.x * inner
  const y = world.y + (item.y - item.radius) * size + pad + snapshot.y * inner
  const ring = Math.max(4.5, side * 0.055)

  ctx.save()
  ctx.lineWidth = 4
  ctx.strokeStyle = 'rgba(3, 10, 13, 0.72)'
  ctx.beginPath()
  ctx.arc(x, y, ring, 0, Math.PI * 2)
  ctx.stroke()

  ctx.lineWidth = 2
  ctx.strokeStyle = '#5ef0c8'
  ctx.beginPath()
  ctx.arc(x, y, ring, 0, Math.PI * 2)
  ctx.stroke()

  ctx.fillStyle = '#5ef0c8'
  ctx.beginPath()
  ctx.arc(x, y, Math.max(1.6, ring * 0.16), 0, Math.PI * 2)
  ctx.fill()
  ctx.restore()
}

function draw() {
  const canvas = canvasRef.value
  const ctx = canvas?.getContext('2d')
  if (!canvas || !ctx) return
  const { w, h, dpr } = viewport
  if (w <= 0 || h <= 0) return

  const pixelWidth = Math.max(1, Math.round(w * dpr))
  const pixelHeight = Math.max(1, Math.round(h * dpr))
  if (canvas.width !== pixelWidth) canvas.width = pixelWidth
  if (canvas.height !== pixelHeight) canvas.height = pixelHeight
  canvas.style.width = `${w}px`
  canvas.style.height = `${h}px`

  ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
  ctx.clearRect(0, 0, w, h)

  const size = Math.max(140, Math.min(w, h) - 48)
  world.x = (w - size) / 2
  world.y = (h - size) / 2
  world.size = size

  roundRect(ctx, world.x, world.y, size, size, 16)
  ctx.fillStyle = 'rgba(7, 12, 17, 0.92)'
  ctx.fill()

  ctx.save()
  roundRect(ctx, world.x, world.y, size, size, 16)
  ctx.clip()

  ctx.strokeStyle = 'rgba(255, 255, 255, 0.045)'
  ctx.lineWidth = 1
  ctx.beginPath()
  for (let step = 1; step < 8; step++) {
    const x = Math.round(world.x + (size * step) / 8) + 0.5
    const y = Math.round(world.y + (size * step) / 8) + 0.5
    ctx.moveTo(x, world.y)
    ctx.lineTo(x, world.y + size)
    ctx.moveTo(world.x, y)
    ctx.lineTo(world.x + size, y)
  }
  ctx.stroke()

  if (showQuadtree.value) drawQuadtree(ctx)

  for (const item of items.value) drawItem(ctx, item)

  drawScanTrail(ctx)
  drawScanHead(ctx)

  const ghost = dragSample.value ?? pending.value
  if (ghost && pointer.value) drawGhost(ctx, ghost.pixels, pointer.value)

  ctx.restore()

  roundRect(ctx, world.x + 0.5, world.y + 0.5, size - 1, size - 1, 16)
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.1)'
  ctx.lineWidth = 1
  ctx.stroke()
}

function requestDraw() {
  if (frame) return
  frame = requestAnimationFrame(() => {
    frame = 0
    draw()
  })
}

/* ---------- 交互 ---------- */

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

function toWorld(event: PointerEvent | WheelEvent | MouseEvent): Point | null {
  const canvas = canvasRef.value
  if (!canvas || world.size <= 1) return null
  const rect = canvas.getBoundingClientRect()
  const px = event.clientX - rect.left
  const py = event.clientY - rect.top
  return { x: (px - world.x) / world.size, y: (py - world.y) / world.size }
}

function insideItem(item: SceneItem, point: Point): boolean {
  return Math.abs(item.x - point.x) <= item.radius && Math.abs(item.y - point.y) <= item.radius
}

/** 落点是否在 28×28 画板内 */
function insideBoard(point: Point): boolean {
  return point.x >= 0 && point.x <= 1 && point.y >= 0 && point.y <= 1
}

/** 用四叉树先筛，再按层序取最上面的；圆查询漏掉的角由线性扫描兜底 */
function hitTest(point: Point): SceneItem | null {
  let best: SceneItem | null = null
  for (const candidate of quadtree.value.queryCircle(point.x, point.y, 0.001)) {
    if (!insideItem(candidate.data, point)) continue
    if (!best || items.value.indexOf(candidate.data) > items.value.indexOf(best)) best = candidate.data
  }
  if (best) return best
  for (const item of items.value) {
    if (insideItem(item, point)) best = item
  }
  return best
}

function nearHandle(item: SceneItem, point: Point): boolean {
  if (world.size <= 1) return false
  const tolerance = 13 / world.size
  return (
    Math.abs(point.x - (item.x + item.radius)) <= tolerance &&
    Math.abs(point.y - (item.y + item.radius)) <= tolerance
  )
}

function onPointerDown(event: PointerEvent) {
  const canvas = canvasRef.value
  if (!canvas) return
  const point = toWorld(event)
  if (!point) return
  canvas.setPointerCapture(event.pointerId)
  const inBoard = insideBoard(point)

  // 手里握着素材时，点击画布优先落子（哪怕落在别的对象上）
  if (pending.value && inBoard) {
    addSample(pending.value, point)
    mode.value = 'idle'
    requestDraw()
    return
  }
  if (!inBoard) {
    select(null)
    mode.value = 'idle'
    requestDraw()
    return
  }

  const hit = hitTest(point)

  if (hit) {
    select(hit.id)
    activeId = hit.id
    busy.value = true
    if (nearHandle(hit, point)) {
      mode.value = 'resize'
    } else {
      mode.value = 'drag'
      dragOffset = { x: point.x - hit.x, y: point.y - hit.y }
    }
  } else if (pending.value) {
    addSample(pending.value, point)
    mode.value = 'idle'
  } else {
    select(null)
    mode.value = 'idle'
  }
  requestDraw()
}

function onPointerMove(event: PointerEvent) {
  const point = toWorld(event)
  if (!point) return
  pointer.value = point

  if (mode.value === 'drag' && activeId) {
    const item = items.value.find((entry) => entry.id === activeId)
    if (item) {
      item.x = clamp(point.x - dragOffset.x, item.radius, 1 - item.radius)
      item.y = clamp(point.y - dragOffset.y, item.radius, 1 - item.radius)
    }
  } else if (mode.value === 'resize' && activeId) {
    const item = items.value.find((entry) => entry.id === activeId)
    if (item) {
      const distance = Math.max(Math.abs(point.x - item.x), Math.abs(point.y - item.y))
      item.radius = clamp(distance, 0.028, 0.42)
      item.x = clamp(item.x, item.radius, 1 - item.radius)
      item.y = clamp(item.y, item.radius, 1 - item.radius)
    }
  } else {
    refreshHover(event)
  }
  requestDraw()
}

/** 按指针位置刷新悬停对象，以及指针是否压在它的右下角缩放手柄上 */
function refreshHover(event: PointerEvent | WheelEvent) {
  const point = toWorld(event)
  if (!point || point.x < 0 || point.x > 1 || point.y < 0 || point.y > 1) {
    hoverId.value = null
    handleHover.value = false
    return
  }
  const hover = hitTest(point)
  hoverId.value = hover?.id ?? null
  handleHover.value = hover ? nearHandle(hover, point) : false
}

function onPointerUp(event: PointerEvent) {
  const canvas = canvasRef.value
  if (canvas?.hasPointerCapture(event.pointerId)) canvas.releasePointerCapture(event.pointerId)
  mode.value = 'idle'
  activeId = null
  busy.value = false
  // 缩放结束后手柄可能已经不在指针下面，重新算一次悬停
  refreshHover(event)
  requestDraw()
}

function onPointerLeave() {
  if (mode.value !== 'idle') return
  pointer.value = null
  hoverId.value = null
  handleHover.value = false
  requestDraw()
}

function onWheel(event: WheelEvent) {
  const point = toWorld(event)
  if (!point) return
  const hit = hitTest(point)
  if (!hit) return
  event.preventDefault()
  const next = clamp(hit.radius * (event.deltaY > 0 ? 0.92 : 1.08), 0.028, 0.42)
  updateItem(hit.id, {
    radius: next,
    x: clamp(hit.x, next, 1 - next),
    y: clamp(hit.y, next, 1 - next),
  })
  // 滚轮改大小后手柄位置跟着变，悬停指针状态也要重算
  refreshHover(event)
  requestDraw()
}

/* ---------- 从素材库拖放 ---------- */

function onDragOver(event: DragEvent) {
  if (!dragSample.value) return
  event.preventDefault()
  if (event.dataTransfer) event.dataTransfer.dropEffect = 'copy'
  const point = toWorld(event)
  pointer.value = point && insideBoard(point) ? point : null
  requestDraw()
}

function onDragLeave() {
  if (!dragSample.value) return
  pointer.value = null
  requestDraw()
}

function onDrop(event: DragEvent) {
  const sample = dragSample.value
  const point = toWorld(event)
  endDrag()
  pointer.value = null
  if (!sample || !point || !insideBoard(point)) {
    requestDraw()
    return
  }
  const item = addSample(sample, point)
  if (item) flash(`「${item.label}」已喂进运行台`)
  requestDraw()
}

function onKeyDown(event: KeyboardEvent) {
  const target = event.target as HTMLElement | null
  if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)) return
  if (event.key === 'Escape') {
    pending.value = null
    select(null)
    requestDraw()
  } else if ((event.key === 'Delete' || event.key === 'Backspace') && selectedId.value) {
    event.preventDefault()
    removeItem(selectedId.value)
    requestDraw()
  }
}

function setQuadtreeVisible(event: Event) {
  showQuadtree.value = (event.target as HTMLInputElement).checked
  requestDraw()
}

function setLabelsVisible(event: Event) {
  showLabels.value = (event.target as HTMLInputElement).checked
  requestDraw()
}

/* ---------- 生命周期 ---------- */

watch(items, requestDraw, { deep: true })
watch([selectedId, hoverId, showQuadtree, showLabels], requestDraw)
watch(pending, requestDraw)
// 运行台每走一步，扫描头都要跟着挪
watch(narsRevision, requestDraw)
watch(appliedId, requestDraw)
watch(dragSample, (value) => {
  if (!value) pointer.value = null
  requestDraw()
})

onMounted(() => {
  const wrap = wrapRef.value
  if (!wrap) return
  observer = new ResizeObserver(() => {
    syncViewport()
    requestDraw()
  })
  observer.observe(wrap)
  syncViewport()
  window.addEventListener('keydown', onKeyDown)
  requestDraw()
})

onBeforeUnmount(() => {
  observer?.disconnect()
  observer = null
  window.removeEventListener('keydown', onKeyDown)
  if (frame) cancelAnimationFrame(frame)
})
</script>

<template>
  <section class="panel stage">
    <header class="panel-head">
      <div>
        <h2 class="panel-title">四叉树场景</h2>
        <p class="panel-sub">拖入素材 · 拖拽移动 · 滚轮缩放 · 右下角手柄改大小</p>
      </div>
      <div class="toggles">
        <label class="toggle">
          <input type="checkbox" :checked="showQuadtree" @change="setQuadtreeVisible" />
          四叉树划分
        </label>
        <label class="toggle">
          <input type="checkbox" :checked="showLabels" @change="setLabelsVisible" />
          标签
        </label>
      </div>
    </header>

    <div
      ref="wrapRef"
      class="canvas-wrap"
      :style="{ cursor }"
      @dragenter.prevent
      @dragover.prevent="onDragOver"
      @dragleave="onDragLeave"
      @drop.prevent="onDrop"
    >
      <canvas
        ref="canvasRef"
        @pointerdown="onPointerDown"
        @pointermove="onPointerMove"
        @pointerup="onPointerUp"
        @pointercancel="onPointerUp"
        @pointerleave="onPointerLeave"
        @wheel="onWheel"
      />
      <p v-if="!items.length" class="empty">
        {{ pending ? '在画布上点一下，把素材放进来' : '从左侧把素材拖到这里' }}
      </p>
      <div v-if="pending" class="placing">放置：{{ pending.label }}</div>
    </div>
  </section>
</template>

<style scoped>
.stage {
  min-width: 0;
}

.toggles {
  display: flex;
  gap: 12px;
}

.toggle {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  font-size: 11.5px;
  color: var(--muted);
  cursor: pointer;
  user-select: none;
}

.toggle input {
  accent-color: #5ef0c8;
  width: 13px;
  height: 13px;
}

.canvas-wrap {
  position: relative;
  flex: 1 1 auto;
  min-height: 0;
}

canvas {
  position: absolute;
  inset: 0;
  display: block;
  touch-action: none;
}

.empty {
  position: absolute;
  inset: 0;
  display: grid;
  place-items: center;
  margin: 0;
  pointer-events: none;
  color: var(--faint);
  font-size: 12.5px;
  letter-spacing: 0.02em;
}

.placing {
  position: absolute;
  top: 14px;
  left: 50%;
  transform: translateX(-50%);
  padding: 5px 12px;
  border-radius: 999px;
  background: rgba(94, 240, 200, 0.14);
  border: 1px solid rgba(94, 240, 200, 0.4);
  color: var(--cyan);
  font-size: 11.5px;
  pointer-events: none;
  backdrop-filter: blur(6px);
}
</style>
