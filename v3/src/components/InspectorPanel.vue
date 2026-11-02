<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useScene } from '../scene/store.ts'
import PixelEditor from './PixelEditor.vue'
import PixelThumb from './PixelThumb.vue'

const { selected, selectedId, selectedIndex, items, updateItem, removeItem, duplicateItem, bringToFront, sendToBack, setPixels } =
  useScene()

const editing = ref(false)

watch(selectedId, () => {
  editing.value = false
})

const positionLabel = computed(() => {
  const item = selected.value
  if (!item) return '—'
  return `${Math.round(item.x * 100)}% , ${Math.round(item.y * 100)}%`
})

const sizeLabel = computed(() => {
  const item = selected.value
  if (!item) return '—'
  return `${Math.round(item.radius * 200)}%`
})

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

function setLabel(event: Event) {
  const item = selected.value
  if (!item) return
  updateItem(item.id, { label: (event.target as HTMLInputElement).value })
}

function setRadius(event: Event) {
  const item = selected.value
  if (!item) return
  const next = Number((event.target as HTMLInputElement).value)
  updateItem(item.id, {
    radius: next,
    x: clamp(item.x, next, 1 - next),
    y: clamp(item.y, next, 1 - next),
  })
}

function toggleInvert(event: Event) {
  const item = selected.value
  if (!item) return
  updateItem(item.id, { invert: (event.target as HTMLInputElement).checked })
}

function toggleEditing() {
  editing.value = !editing.value
}

function onPixelsChange(pixels: Uint8Array) {
  const item = selected.value
  if (!item) return
  setPixels(item.id, pixels)
}
</script>

<template>
  <section class="panel">
    <header class="panel-head">
      <div>
        <h2 class="panel-title">属性</h2>
        <p class="panel-sub">
          {{ selected ? `第 ${selectedIndex + 1} / ${items.length} 个对象` : '未选中对象' }}
        </p>
      </div>
    </header>

    <div class="scroll-y">
      <template v-if="selected">
        <div class="hero">
          <div class="hero-thumb">
            <PixelThumb :pixels="selected.pixels" :invert="selected.invert" :size="62" />
          </div>
          <div class="hero-meta">
            <div class="hero-name">{{ selected.label }}</div>
            <div class="hero-source mono">{{ selected.source }}</div>
          </div>
        </div>

        <div class="section">
          <div class="field">
            <span class="field-label">标签</span>
            <input class="text-input" :value="selected.label" @input="setLabel" />
          </div>
        </div>

        <div class="section">
          <div class="row">
            <span class="field-label">位置</span>
            <span class="mono">{{ positionLabel }}</span>
          </div>
          <div class="row">
            <span class="field-label">大小</span>
            <span class="mono">{{ sizeLabel }}</span>
          </div>
          <input
            type="range"
            min="0.03"
            max="0.4"
            step="0.005"
            :value="selected.radius"
            @input="setRadius"
          />
        </div>

        <div class="section">
          <label class="check">
            <input type="checkbox" :checked="selected.invert" @change="toggleInvert" />
            反色显示
          </label>
        </div>

        <div class="section actions">
          <button class="btn tiny" @click="duplicateItem(selected.id)">复制</button>
          <button class="btn tiny" @click="bringToFront(selected.id)">置顶</button>
          <button class="btn tiny" @click="sendToBack(selected.id)">置底</button>
          <button class="btn tiny danger" @click="removeItem(selected.id)">删除</button>
        </div>

        <div class="section">
          <button class="btn" @click="toggleEditing">
            {{ editing ? '收起像素编辑' : '编辑像素' }}
          </button>
          <PixelEditor
            v-if="editing"
            :pixels="selected.pixels"
            :invert="selected.invert"
            @change="onPixelsChange"
          />
        </div>
      </template>

      <div v-else class="empty">
        <p>还没有选中对象</p>
        <ul>
          <li>从左侧拖素材到场景放置</li>
          <li>拖拽对象移动，滚轮缩放</li>
          <li>右下角手柄改大小</li>
          <li>Delete 删除 · Esc 取消选择</li>
        </ul>
      </div>
    </div>
  </section>
</template>

<style scoped>
.hero {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 14px;
  border-bottom: 1px solid var(--line);
}

.hero-thumb {
  display: grid;
  place-items: center;
  width: 74px;
  height: 74px;
  border-radius: 10px;
  background: #000;
  border: 1px solid var(--line);
  flex: 0 0 auto;
}

.hero-meta {
  min-width: 0;
}

.hero-name {
  font-size: 14px;
  font-weight: 600;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.hero-source {
  margin-top: 4px;
  font-size: 11px;
  color: var(--faint);
}

.section {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 12px 14px;
  border-bottom: 1px solid var(--line);
}

.row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  font-size: 12px;
  color: var(--muted);
}

.check {
  display: inline-flex;
  align-items: center;
  gap: 7px;
  font-size: 12px;
  color: var(--muted);
  cursor: pointer;
  user-select: none;
}

.check input {
  accent-color: #5ef0c8;
  width: 13px;
  height: 13px;
}

.actions {
  flex-direction: row;
  flex-wrap: wrap;
  border-bottom: 0;
}

.empty {
  padding: 26px 18px;
  color: var(--faint);
  font-size: 12px;
  line-height: 1.9;
}

.empty p {
  margin: 0 0 10px;
  color: var(--muted);
}

.empty ul {
  margin: 0;
  padding-left: 16px;
}
</style>
