<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { boardSnapshot, memorySnapshot, shiftTrace } from '../nars/index.ts'
import { narsRevision } from '../narsLive.ts'
import { appliedId, displayPixels } from '../runtime.ts'
import { useScene } from '../scene/store.ts'
import { IMAGE_SIDE } from '../scene/types.ts'
import {
  createTower,
  type TowerChip,
  type TowerConceptNode,
  type TowerData,
  type TowerHandle,
  type TowerLayer,
  type TowerPickInfo,
  type TowerSentence,
  type TowerTracePoint,
} from './tower.ts'

const { items, selectedId, dragSample, addSample, endDrag, flash } = useScene()

const wrapRef = ref<HTMLDivElement | null>(null)
const autoRotate = ref(false)
const towerRef = ref<TowerHandle | null>(null)
const stats = ref({ layers: 0, chips: 0, concepts: 0, sentences: 0 })
const traceCount = ref(0)
const dropActive = ref(false)
const hover = ref<{ label: string; detail: string; x: number; y: number } | null>(null)
const selected = ref<TowerPickInfo | null>(null)

let rebuildTimer: ReturnType<typeof setTimeout> | null = null

/** 场景坐标 0..1 → 世界坐标 -5..5 */
const toWorld = (value: number) => (value - 0.5) * 10

function layerLabel(depth: number): string {
  if (depth === 0) return '原子'
  if (depth === 1) return '顺序对'
  if (depth === 2) return '集合'
  return `复合 ${depth}`
}

function buildData(): TowerData {
  const view = memorySnapshot()

  // 层 0：四叉树索引到的像素块（画幅参考）
  const chips: TowerChip[] = items.value.map((item) => ({
    id: item.id,
    label: item.label,
    x: toWorld(item.x),
    z: toWorld(item.y),
    size: Math.max(0.7, item.radius * 20),
    pixels: displayPixels(item),
    side: IMAGE_SIDE,
    selected: item.id === selectedId.value,
  }))

  // 概念按封装深度分层；带位置的句子放到对应层
  const layerMap = new Map<number, TowerLayer>()
  const ensureLayer = (depth: number): TowerLayer => {
    let layer = layerMap.get(depth)
    if (!layer) {
      layer = { depth, label: layerLabel(depth), concepts: [], sentences: [] }
      layerMap.set(depth, layer)
    }
    return layer
  }

  const orderedConcepts = [...view.concepts].sort(
    (left, right) =>
      right.confidence - left.confidence ||
      right.activity - left.activity ||
      left.complexity - right.complexity,
  )
  for (const concept of orderedConcepts) {
    const layer = ensureLayer(concept.depth)
    const sentenceCount =
      concept.counts.beliefs + concept.counts.desires + concept.counts.questions
    const node: TowerConceptNode = {
      key: concept.key,
      label: concept.label,
      kind: concept.kind,
      depth: concept.depth,
      detail: `${concept.kind} · ${sentenceCount} 句 · f ${concept.frequency.toFixed(2)} · c ${concept.confidence.toFixed(2)} · 深度 ${concept.depth} · 复杂度 ${concept.complexity}`,
    }
    layer.concepts.push(node)

    for (const instance of concept.instances) {
      const valueText = instance.value === null ? '' : ` · 值 ${instance.value.toFixed(2)}`
      const sentence: TowerSentence = {
        key: `${concept.key}|${instance.key}`,
        conceptKey: concept.key,
        label: instance.text,
        kind: concept.kind,
        x: instance.x,
        y: instance.y,
        value: instance.value,
        detail: `${concept.label} · ${instance.source} · (${instance.x.toFixed(2)}, ${instance.y.toFixed(2)})${valueText}`,
      }
      layer.sentences.push(sentence)
    }
  }

  const layers = [...layerMap.values()].sort((left, right) => left.depth - right.depth)
  const maxDepth = layers.length ? layers[layers.length - 1]!.depth : 0
  return { chips, layers, maxDepth }
}

function rebuild() {
  const data = buildData()
  stats.value = {
    layers: data.layers.length,
    chips: data.chips.length,
    concepts: data.layers.reduce((sum, layer) => sum + layer.concepts.length, 0),
    sentences: data.layers.reduce((sum, layer) => sum + layer.sentences.length, 0),
  }
  towerRef.value?.setData(data)
  updateScan()
  updateTrace()
}


/** 扫描头压在「当前喂给运行台」的像素块上 */
function updateScan() {
  const item = appliedId.value ? items.value.find((entry) => entry.id === appliedId.value) : undefined
  if (!item) {
    towerRef.value?.setScan(null)
    return
  }
  const scan = boardSnapshot()
  const size = Math.max(0.7, item.radius * 20)
  towerRef.value?.setScan({
    x: toWorld(item.x) + (scan.x - 0.5) * size,
    z: toWorld(item.y) + (scan.y - 0.5) * size,
    size,
  })
}

/** 最近 shift 轨迹：映射到当前喂给运行台的像素块上 */
function updateTrace() {
  const item = appliedId.value ? items.value.find((entry) => entry.id === appliedId.value) : undefined
  if (!item) {
    towerRef.value?.setTrace([])
    traceCount.value = 0
    return
  }
  const size = Math.max(0.7, item.radius * 20)
  const points: TowerTracePoint[] = shiftTrace().map((point) => ({
    x: toWorld(item.x) + (point.x - 0.5) * size,
    z: toWorld(item.y) + (point.y - 0.5) * size,
    dx: point.dx * size,
    dz: point.dy * size,
  }))
  towerRef.value?.setTrace(points)
  traceCount.value = points.length
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

/* ---------- 从素材库拖放 ---------- */

function onDragOver(event: DragEvent) {
  if (!dragSample.value) return
  event.preventDefault()
  if (event.dataTransfer) event.dataTransfer.dropEffect = 'copy'
  dropActive.value = true
  const point = towerRef.value?.pickDeck(event.clientX, event.clientY)
  towerRef.value?.setDropPreview(point ?? null)
}

function onDragLeave() {
  dropActive.value = false
  towerRef.value?.setDropPreview(null)
}

function onDrop(event: DragEvent) {
  const sample = dragSample.value
  endDrag()
  dropActive.value = false
  towerRef.value?.setDropPreview(null)
  if (!sample) return
  const point = towerRef.value?.pickDeck(event.clientX, event.clientY)
  if (!point) return
  const item = addSample(sample, {
    x: clamp(point.x / 10 + 0.5, 0.075, 0.925),
    y: clamp(point.z / 10 + 0.5, 0.075, 0.925),
  })
  if (item) flash(`「${item.label}」已喂进运行台`)
}

function scheduleRebuild() {
  if (rebuildTimer) clearTimeout(rebuildTimer)
  rebuildTimer = setTimeout(() => {
    rebuildTimer = null
    rebuild()
  }, 120)
}

const summary = computed(() => {
  narsRevision.value
  return `${stats.value.layers} 层 · ${stats.value.chips} 像素块 · ${stats.value.concepts} 概念 · ${stats.value.sentences} 句 · ${traceCount.value} 轨迹`
})

function toggleRotate() {
  autoRotate.value = !autoRotate.value
  towerRef.value?.setAutoRotate(autoRotate.value)
}

onMounted(() => {
  const wrap = wrapRef.value
  if (!wrap) return
  towerRef.value = createTower(wrap)
  towerRef.value.setAutoRotate(autoRotate.value)
  towerRef.value.setHoverHandler((info, clientX, clientY) => {
    if (!info) {
      hover.value = null
      return
    }
    const element = wrapRef.value
    if (!element) return
    const rect = element.getBoundingClientRect()
    const x = Math.min(Math.max(8, clientX - rect.left + 14), Math.max(8, rect.width - 280))
    const y = Math.min(Math.max(8, clientY - rect.top + 14), Math.max(8, rect.height - 104))
    hover.value = { label: info.label, detail: info.detail, x, y }
  })
  towerRef.value.setSelectHandler((info) => {
    selected.value = info
  })
  rebuild()
})

watch([narsRevision, selectedId, () => items.value.length], scheduleRebuild)
watch(items, scheduleRebuild, { deep: true })
// 每步只挪扫描头，不重建整棵树
watch(narsRevision, updateScan)
watch(narsRevision, updateTrace)
watch(appliedId, updateScan)
watch(appliedId, updateTrace)
watch(dragSample, (value) => {
  if (value) return
  dropActive.value = false
  towerRef.value?.setDropPreview(null)
})

onBeforeUnmount(() => {
  if (rebuildTimer) clearTimeout(rebuildTimer)
  towerRef.value?.setHoverHandler(null)
  towerRef.value?.setSelectHandler(null)
  towerRef.value?.dispose()
  towerRef.value = null
})
</script>

<template>
  <section class="panel stage">
    <header class="panel-head">
      <div>
        <h2 class="panel-title">3D 分层</h2>
        <p class="panel-sub">层按词项封装深度 · 概念在左 · 句子按落点</p>
      </div>
      <div class="head-actions">
        <span class="counts mono">{{ summary }}</span>
        <button class="btn tiny" @click="toggleRotate">{{ autoRotate ? '暂停旋转' : '自动旋转' }}</button>
      </div>
    </header>

    <div
      class="canvas-wrap"
      :class="{ 'drop-active': dropActive }"
      @dragenter.prevent="onDragOver"
      @dragover.prevent="onDragOver"
      @dragleave="onDragLeave"
      @drop.prevent="onDrop"
    >
      <div ref="wrapRef" class="tower" />
      <div
        v-if="hover"
        class="tip"
        :style="{ left: `${hover.x}px`, top: `${hover.y}px` }"
      >
        <b>{{ hover.label }}</b>
        <span>{{ hover.detail }}</span>
      </div>
      <div v-if="selected" class="selected" :title="`${selected.label} · ${selected.detail}`">
        <span class="selected-tag">已选</span>
        <b>{{ selected.label }}</b>
        <span class="selected-detail">{{ selected.detail }}</span>
      </div>
      <div class="hud">
        <div class="legend"><i class="dot atom" />原子</div>
        <div class="legend"><i class="dot sequence" />顺序对</div>
        <div class="legend"><i class="dot set" />集合</div>
      </div>
      <div v-if="dropActive" class="drop-hint">松手放到层 0 · 落点即位置</div>
      <div class="hint">左键旋转 · 右键平移（屏幕平面）· 中键平移（水平面）· 滚轮缩放</div>
      <p v-if="!stats.concepts" class="empty">
        还没有概念。先点几步，颜色、顺序对、集合会落到各自层。
      </p>
    </div>
  </section>
</template>

<style scoped>
.stage {
  min-width: 0;
}

.head-actions {
  display: flex;
  align-items: center;
  gap: 10px;
}

.counts {
  font-size: 11px;
  color: var(--faint);
}

.canvas-wrap {
  position: relative;
  flex: 1 1 auto;
  min-height: 0;
  overflow: hidden;
}

.tower {
  position: absolute;
  inset: 0;
}

.canvas-wrap.drop-active {
  outline: 1px dashed rgba(94, 240, 200, 0.55);
  outline-offset: -6px;
  border-radius: 10px;
}

.drop-hint {
  position: absolute;
  top: 50%;
  left: 50%;
  transform: translate(-50%, -50%);
  padding: 6px 14px;
  border-radius: 999px;
  background: rgba(6, 12, 17, 0.86);
  border: 1px solid rgba(94, 240, 200, 0.45);
  color: var(--cyan);
  font-size: 11.5px;
  pointer-events: none;
}

.hud {
  position: absolute;
  top: 12px;
  left: 14px;
  display: flex;
  gap: 12px;
  padding: 6px 10px;
  border-radius: 999px;
  background: rgba(6, 12, 17, 0.72);
  border: 1px solid var(--line);
  backdrop-filter: blur(6px);
  pointer-events: none;
}

.tip {
  position: absolute;
  z-index: 6;
  max-width: 260px;
  padding: 7px 10px;
  border-radius: 8px;
  background: rgba(6, 12, 17, 0.94);
  border: 1px solid rgba(94, 240, 200, 0.38);
  box-shadow: 0 10px 26px rgba(0, 0, 0, 0.45);
  pointer-events: none;
}

.tip b {
  display: block;
  margin-bottom: 3px;
  color: var(--cyan);
  font-family: var(--mono);
  font-size: 12px;
  font-weight: 600;
}

.tip span {
  display: block;
  color: var(--muted);
  font-size: 10.5px;
  line-height: 1.45;
  white-space: normal;
  word-break: break-word;
}

.selected {
  position: absolute;
  left: 14px;
  bottom: 34px;
  max-width: min(520px, 70%);
  display: flex;
  align-items: baseline;
  gap: 7px;
  padding: 5px 10px;
  border-radius: 8px;
  background: rgba(6, 12, 17, 0.86);
  border: 1px solid rgba(240, 180, 41, 0.42);
  color: var(--muted);
  font-size: 10.5px;
  pointer-events: none;
  overflow: hidden;
  white-space: nowrap;
}

.selected-tag {
  flex: 0 0 auto;
  color: var(--amber);
  font-size: 10px;
}

.selected b {
  flex: 0 0 auto;
  color: var(--ink);
  font-family: var(--mono);
  font-size: 11.5px;
  font-weight: 500;
}

.selected-detail {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  color: var(--faint);
}

.legend {
  display: flex;
  align-items: center;
  gap: 5px;
  font-size: 10.5px;
  color: var(--muted);
}

.dot {
  width: 7px;
  height: 7px;
  border-radius: 2px;
  display: inline-block;
}

.dot.atom {
  background: #e8eef2;
}

.dot.sequence {
  background: #7fe3d0;
}

.dot.set {
  background: #5ef0c8;
}

.hint {
  position: absolute;
  right: 14px;
  bottom: 10px;
  font-size: 10.5px;
  color: var(--faint);
  pointer-events: none;
}

.empty {
  position: absolute;
  left: 50%;
  bottom: 34px;
  transform: translateX(-50%);
  margin: 0;
  padding: 8px 14px;
  border-radius: 999px;
  background: rgba(6, 12, 17, 0.8);
  border: 1px solid var(--line);
  color: var(--muted);
  font-size: 11.5px;
  pointer-events: none;
  white-space: nowrap;
}
</style>
