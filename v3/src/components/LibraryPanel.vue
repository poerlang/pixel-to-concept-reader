<script setup lang="ts">
import { computed, onMounted, ref, shallowRef } from 'vue'
import { loadMnist, readPixels, sampleIndices, type MnistData } from '../data/mnist.ts'
import { shapePixels, shapeSequence } from '../data/patterns.ts'
import { useScene } from '../scene/store.ts'
import type { LibrarySample } from '../scene/types.ts'
import PixelThumb from './PixelThumb.vue'

type LibEntry = LibrarySample & { digit?: number }
type FilterKey = 'all' | 'shape' | number

const { addSample, pending, beginDrag, endDrag } = useScene()

const entries = shallowRef<LibEntry[]>([])
const loading = ref(true)
const error = ref('')
const filter = ref<FilterKey>('all')

/** 每个数字抽几张 */
const perDigit = 8

let mnist: MnistData | null = null

const shapeEntries: LibEntry[] = shapeSequence.map((spec) => ({
  key: `shape:${spec.name}`,
  kind: 'shape',
  label: spec.label,
  source: `shape:${spec.name}`,
  pixels: shapePixels(spec.name),
}))

const chips: { key: FilterKey; text: string }[] = [
  { key: 'all', text: '全部' },
  { key: 'shape', text: '形状' },
  ...Array.from({ length: 10 }, (_, digit) => ({ key: digit as FilterKey, text: String(digit) })),
]

const filtered = computed(() => {
  if (filter.value === 'all') return entries.value
  if (filter.value === 'shape') return entries.value.filter((entry) => entry.kind === 'shape')
  return entries.value.filter((entry) => entry.digit === filter.value)
})

const mnistCount = computed(() => entries.value.filter((entry) => entry.kind === 'mnist').length)

function rebuildMnist() {
  if (!mnist) return
  const next: LibEntry[] = [...shapeEntries]
  for (let digit = 0; digit < 10; digit++) {
    for (const index of sampleIndices(mnist.meta, digit, perDigit)) {
      next.push({
        key: `mnist:${index}`,
        kind: 'mnist',
        label: `数字 ${digit}`,
        source: `mnist:${index}`,
        pixels: readPixels(mnist, index),
        digit,
      })
    }
  }
  entries.value = next
}

function setFilter(key: FilterKey) {
  filter.value = key
}

function toggle(entry: LibEntry) {
  pending.value = pending.value?.key === entry.key ? null : entry
}

function place(entry: LibEntry) {
  addSample(entry)
}

function startDrag(entry: LibEntry, event: DragEvent) {
  pending.value = null
  beginDrag(entry)
  if (!event.dataTransfer) return
  event.dataTransfer.effectAllowed = 'copy'
  // 自定义类型给场景读；text/plain 让浏览器认为这是一次有效拖拽
  event.dataTransfer.setData('application/x-pdftest-sample', entry.key)
  event.dataTransfer.setData('text/plain', entry.label)
}

function stopDrag() {
  endDrag()
}

function refresh() {
  if (!mnist) return
  rebuildMnist()
}

onMounted(async () => {
  try {
    mnist = await loadMnist()
    rebuildMnist()
  } catch (reason) {
    error.value = reason instanceof Error ? reason.message : String(reason)
  } finally {
    loading.value = false
  }
})
</script>

<template>
  <section class="panel">
    <header class="panel-head">
      <div>
        <h2 class="panel-title">素材库</h2>
        <p class="panel-sub">
          MNIST {{ mnistCount }} 张 · 形状 {{ shapeEntries.length }} 个
        </p>
      </div>
      <button class="btn tiny" :disabled="!mnist || loading" @click="refresh">换一批</button>
    </header>

    <div class="chips">
      <button
        v-for="chip in chips"
        :key="String(chip.key)"
        class="chip"
        :class="{ active: filter === chip.key }"
        @click="setFilter(chip.key)"
      >
        {{ chip.text }}
      </button>
    </div>

    <div class="scroll-y">
      <p v-if="loading" class="state">正在载入 mnist.bin（7.3 MB）…</p>
      <p v-else-if="error" class="state error">{{ error }}</p>
      <div v-else class="grid">
        <button
          v-for="entry in filtered"
          :key="entry.key"
          class="tile"
          draggable="true"
          :class="{ active: pending?.key === entry.key }"
          @click="toggle(entry)"
          @dblclick="place(entry)"
          @dragstart="startDrag(entry, $event)"
          @dragend="stopDrag"
        >
          <span class="thumb-wrap">
            <PixelThumb :pixels="entry.pixels" :size="48" />
          </span>
          <span class="tile-label">{{ entry.label }}</span>
          <span class="badge">{{ entry.kind === 'shape' ? '形状' : entry.digit }}</span>
        </button>
      </div>
    </div>

    <footer class="panel-foot">
      <template v-if="pending">
        已选 <b class="picked">{{ pending.label }}</b>，点画布放置
      </template>
      <template v-else>拖到画布放置 · 双击放到中心</template>
    </footer>
  </section>
</template>

<style scoped>
.chips {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  padding: 10px 12px;
  border-bottom: 1px solid var(--line);
}

.grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(74px, 1fr));
  gap: 8px;
  padding: 12px;
}

.tile {
  position: relative;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 6px;
  padding: 9px 5px 7px;
  border-radius: 10px;
  border: 1px solid var(--line);
  background: rgba(255, 255, 255, 0.02);
  transition: border-color 0.15s, background 0.15s, transform 0.12s;
  cursor: grab;
}

.tile:active {
  cursor: grabbing;
}

.tile:hover {
  border-color: rgba(255, 255, 255, 0.26);
  background: rgba(255, 255, 255, 0.05);
  transform: translateY(-1px);
}

.tile.active {
  border-color: rgba(94, 240, 200, 0.75);
  background: rgba(94, 240, 200, 0.1);
  box-shadow: 0 0 0 1px rgba(94, 240, 200, 0.35), 0 6px 18px rgba(94, 240, 200, 0.1);
}

.thumb-wrap {
  display: grid;
  place-items: center;
  width: 52px;
  height: 52px;
  border-radius: 6px;
  background: #000;
  border: 1px solid rgba(255, 255, 255, 0.07);
}

.tile-label {
  font-size: 11px;
  color: var(--muted);
  max-width: 100%;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.tile.active .tile-label {
  color: var(--cyan);
}

.badge {
  position: absolute;
  top: 5px;
  right: 5px;
  min-width: 15px;
  padding: 1px 4px;
  border-radius: 5px;
  background: rgba(0, 0, 0, 0.55);
  border: 1px solid rgba(255, 255, 255, 0.1);
  font-family: var(--mono);
  font-size: 9px;
  line-height: 1.3;
  color: var(--faint);
  text-align: center;
}

.tile.active .badge {
  color: var(--cyan);
  border-color: rgba(94, 240, 200, 0.4);
}

.state {
  margin: 0;
  padding: 26px 16px;
  text-align: center;
  font-size: 12px;
  color: var(--muted);
}

.state.error {
  color: var(--danger);
}

.picked {
  color: var(--cyan);
}
</style>
