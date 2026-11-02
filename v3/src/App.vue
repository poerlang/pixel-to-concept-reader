<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, type CSSProperties } from 'vue'
import InspectorPanel from './components/InspectorPanel.vue'
import LibraryPanel from './components/LibraryPanel.vue'
import MemoryPanel from './components/MemoryPanel.vue'
import NarsConsole from './components/NarsConsole.vue'
import SceneCanvas from './components/SceneCanvas.vue'
import Scene3D from './three/Scene3D.vue'
import { shapePixels } from './data/patterns.ts'
import { useScene } from './scene/store.ts'

const { treeStats, savedAt, notice, loadFromStorage, save, exportFile, importFile, clearScene, flash, addSample } =
  useScene()

const fileRef = ref<HTMLInputElement | null>(null)

/** 中间舞台：2D 场景 / 3D 分层 */
const stageMode = ref<'2d' | '3d'>('2d')

function setStage(mode: '2d' | '3d') {
  stageMode.value = mode
}

/* ------------------------------------------------------------------ */
/* 可记忆的分栏尺寸                                                     */
/* ------------------------------------------------------------------ */

type ResizeTarget = 'left' | 'right' | 'console' | 'memory'
type SplitLayout = { left: number; right: number; console: number; memory: number }

const LAYOUT_KEY = 'pdftest8::layout::split::v1'
const DEFAULT_LAYOUT: SplitLayout = { left: 332, right: 306, console: 254, memory: 356 }

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

function finiteOr(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback
}

function loadLayout(): SplitLayout {
  try {
    const raw = localStorage.getItem(LAYOUT_KEY)
    if (!raw) return { ...DEFAULT_LAYOUT }
    const parsed = JSON.parse(raw) as Partial<SplitLayout>
    return {
      left: finiteOr(parsed.left, DEFAULT_LAYOUT.left),
      right: finiteOr(parsed.right, DEFAULT_LAYOUT.right),
      console: finiteOr(parsed.console, DEFAULT_LAYOUT.console),
      memory: finiteOr(parsed.memory, DEFAULT_LAYOUT.memory),
    }
  } catch {
    return { ...DEFAULT_LAYOUT }
  }
}

const layout = ref<SplitLayout>(loadLayout())

const layoutStyle = computed<CSSProperties>(() => ({
  '--split-left': `${layout.value.left}px`,
  '--split-right': `${layout.value.right}px`,
  '--split-console': `${layout.value.console}px`,
  '--split-memory': `${layout.value.memory}px`,
}) as CSSProperties)

function maxLeft(): number {
  const cap = window.innerWidth <= 1040 ? 250 : window.innerWidth <= 1240 ? 290 : 460
  if (window.innerWidth <= 1040) {
    return Math.min(cap, Math.max(220, window.innerWidth - 36 - 12 - 360))
  }
  return Math.min(cap, Math.max(240, window.innerWidth - 36 - 24 - 420 - layout.value.right))
}

function maxRight(): number {
  const cap = window.innerWidth <= 1240 ? 270 : 460
  return Math.min(cap, Math.max(240, window.innerWidth - 36 - 24 - 420 - layout.value.left))
}

function maxConsole(): number {
  return Math.min(520, Math.max(220, window.innerHeight - 430))
}

function maxMemory(): number {
  return Math.min(500, Math.max(220, window.innerHeight - 320))
}

function applyLayoutLimits() {
  layout.value = {
    left: clamp(layout.value.left, 220, maxLeft()),
    right: clamp(layout.value.right, 240, maxRight()),
    console: clamp(layout.value.console, 180, maxConsole()),
    memory: clamp(layout.value.memory, 180, maxMemory()),
  }
}

function persistLayout() {
  try {
    localStorage.setItem(LAYOUT_KEY, JSON.stringify(layout.value))
  } catch {
    // localStorage 不可用时只影响记忆，不影响当前拖拽
  }
}

let activeDrag: { target: ResizeTarget; startX: number; startY: number; startSize: number } | null = null

function onResizeMove(event: PointerEvent) {
  if (!activeDrag) return
  const { target, startX, startY, startSize } = activeDrag
  const dx = event.clientX - startX
  const dy = event.clientY - startY
  let next = startSize
  if (target === 'left') next = clamp(startSize + dx, 220, maxLeft())
  else if (target === 'right') next = clamp(startSize - dx, 240, maxRight())
  else if (target === 'console') next = clamp(startSize - dy, 180, maxConsole())
  else next = clamp(startSize - dy, 180, maxMemory())
  layout.value = { ...layout.value, [target]: next }
}

function stopResize() {
  if (!activeDrag) return
  activeDrag = null
  document.body.classList.remove('split-col', 'split-row')
  window.removeEventListener('pointermove', onResizeMove)
  window.removeEventListener('pointerup', stopResize)
  window.removeEventListener('pointercancel', stopResize)
  persistLayout()
}

function startResize(target: ResizeTarget, event: PointerEvent) {
  if (event.button !== 0) return
  event.preventDefault()
  if (activeDrag) stopResize()
  activeDrag = {
    target,
    startX: event.clientX,
    startY: event.clientY,
    startSize: layout.value[target],
  }
  const vertical = target === 'left' || target === 'right'
  document.body.classList.add(vertical ? 'split-col' : 'split-row')
  window.addEventListener('pointermove', onResizeMove)
  window.addEventListener('pointerup', stopResize)
  window.addEventListener('pointercancel', stopResize)
}

function resetSize(target: ResizeTarget) {
  layout.value = { ...layout.value, [target]: DEFAULT_LAYOUT[target] }
  applyLayoutLimits()
  persistLayout()
}

function onViewportResize() {
  applyLayoutLimits()
  persistLayout()
}

const savedLabel = computed(() => {
  if (!savedAt.value) return '未保存'
  return new Date(savedAt.value).toLocaleTimeString('zh-CN', { hour12: false })
})

onMounted(() => {
  applyLayoutLimits()
  window.addEventListener('resize', onViewportResize)
  if (loadFromStorage()) flash(`已恢复本地场景：${treeStats.value.items} 个对象`)
  // 空场景时默认放一张横线像素图，不用手动拖
  if (treeStats.value.items === 0) {
    addSample({
      key: 'shape:hline',
      kind: 'shape',
      label: '横线',
      source: 'shape:hline',
      pixels: shapePixels('hline'),
    })
  }
})

onBeforeUnmount(() => {
  window.removeEventListener('resize', onViewportResize)
  window.removeEventListener('pointermove', onResizeMove)
  window.removeEventListener('pointerup', stopResize)
  window.removeEventListener('pointercancel', stopResize)
  document.body.classList.remove('split-col', 'split-row')
})

function pickFile() {
  fileRef.value?.click()
}

async function onFileChange(event: Event) {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  if (!file) return
  try {
    await importFile(file)
  } catch (reason) {
    flash(`导入失败：${reason instanceof Error ? reason.message : String(reason)}`)
  }
  input.value = ''
}

function onClear() {
  if (!treeStats.value.items) return
  if (window.confirm('清空场景里所有对象？此操作不可撤销。')) clearScene()
}
</script>

<template>
  <div class="shell">
    <header class="topbar">
      <div class="brand">
        <span class="logo">◫</span>
        <div class="brand-text">
          <h1>像素场景工作台</h1>
          <p>MNIST 9761 张 + 13 个基础形状 · 四叉树空间索引</p>
        </div>
      </div>

      <div class="stats">
        <div class="stat">
          <span class="stat-value mono">{{ treeStats.items }}</span>
          <span class="stat-label">对象</span>
        </div>
        <div class="stat">
          <span class="stat-value mono">{{ treeStats.nodes }}</span>
          <span class="stat-label">四叉树节点</span>
        </div>
        <div class="stat">
          <span class="stat-value mono">{{ treeStats.depth }}</span>
          <span class="stat-label">深度</span>
        </div>
        <div class="stat">
          <span class="stat-value mono">{{ savedLabel }}</span>
          <span class="stat-label">最近保存</span>
        </div>
      </div>

      <div class="toolbar">
        <button class="btn primary" @click="save()">保存</button>
        <button class="btn" @click="exportFile()">导出 JSON</button>
        <button class="btn" @click="pickFile">导入</button>
        <button class="btn danger" @click="onClear">清空</button>
        <input
          ref="fileRef"
          class="file-input"
          type="file"
          accept="application/json,.json"
          @change="onFileChange"
        />
      </div>
    </header>

    <main class="workspace" :style="layoutStyle">
      <LibraryPanel class="col-lib" />
      <div
        class="split split-v split-left"
        role="separator"
        aria-orientation="vertical"
        aria-label="调整素材库宽度"
        title="拖动调整素材库宽度；双击重置"
        @pointerdown="startResize('left', $event)"
        @dblclick="resetSize('left')"
      />
      <div class="col-stage">
        <div class="stage-switch">
          <button class="switch-btn" :class="{ active: stageMode === '2d' }" @click="setStage('2d')">
            2D 场景
          </button>
          <button class="switch-btn" :class="{ active: stageMode === '3d' }" @click="setStage('3d')">
            3D 分层
          </button>
          <span class="switch-hint">层 0 像素 · 层 1 概念 · 层 2 句子实例</span>
        </div>
        <div class="stage-slot">
          <SceneCanvas v-if="stageMode === '2d'" class="stage-panel" />
          <Scene3D v-else class="stage-panel" />
        </div>
        <div
          class="split split-h split-console"
          role="separator"
          aria-orientation="horizontal"
          aria-label="调整运行台高度"
          title="拖动调整运行台高度；双击重置"
          @pointerdown="startResize('console', $event)"
          @dblclick="resetSize('console')"
        />
        <div class="console-slot">
          <NarsConsole />
        </div>
      </div>
      <div
        class="split split-v split-right"
        role="separator"
        aria-orientation="vertical"
        aria-label="调整属性面板宽度"
        title="拖动调整属性面板宽度；双击重置"
        @pointerdown="startResize('right', $event)"
        @dblclick="resetSize('right')"
      />
      <div class="col-insp">
        <InspectorPanel class="inspector-panel" />
        <div
          class="split split-h split-memory"
          role="separator"
          aria-orientation="horizontal"
          aria-label="调整记忆体高度"
          title="拖动调整记忆体高度；双击重置"
          @pointerdown="startResize('memory', $event)"
          @dblclick="resetSize('memory')"
        />
        <div class="memory-slot">
          <MemoryPanel />
        </div>
      </div>
    </main>

    <footer class="hintbar">
      <span>拖素材到场景放置（2D / 3D 都行）</span>
      <span>双击素材直接放到中心</span>
      <span>拖拽移动 · 滚轮缩放 · 右下角手柄改大小</span>
      <span>Delete 删除 · Esc 取消</span>
      <span class="auto">改动自动存到 localStorage</span>
    </footer>

    <transition name="toast">
      <div v-if="notice" class="toast">{{ notice }}</div>
    </transition>
  </div>
</template>

<style scoped>
.shell {
  height: 100vh;
  display: grid;
  grid-template-rows: auto minmax(0, 1fr) auto;
}

/* ---------- 顶栏 ---------- */

.topbar {
  display: flex;
  align-items: center;
  gap: 22px;
  padding: 14px 18px 12px;
}

.brand {
  display: flex;
  align-items: center;
  gap: 11px;
  min-width: 0;
}

.logo {
  display: grid;
  place-items: center;
  width: 34px;
  height: 34px;
  border-radius: 10px;
  background: linear-gradient(145deg, rgba(94, 240, 200, 0.9), rgba(94, 240, 200, 0.25));
  color: #04211a;
  font-size: 17px;
  font-weight: 700;
  box-shadow: 0 6px 20px rgba(94, 240, 200, 0.18);
}

.brand-text h1 {
  margin: 0;
  font-size: 15px;
  letter-spacing: 0.02em;
  font-weight: 650;
}

.brand-text p {
  margin: 2px 0 0;
  font-size: 11px;
  color: var(--faint);
  white-space: nowrap;
}

.stats {
  display: flex;
  gap: 6px;
  margin-left: auto;
}

.stat {
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  gap: 1px;
  min-width: 62px;
  padding: 5px 10px;
  border-radius: 9px;
  border: 1px solid var(--line);
  background: rgba(255, 255, 255, 0.02);
}

.stat-value {
  font-size: 12.5px;
  color: var(--ink);
}

.stat-label {
  font-size: 10px;
  color: var(--faint);
  white-space: nowrap;
}

.toolbar {
  display: flex;
  align-items: center;
  gap: 7px;
}

.file-input {
  display: none;
}

/* ---------- 工作区 ---------- */

.workspace {
  --split-gap: 12px;
  min-height: 0;
  display: grid;
  grid-template-columns:
    var(--split-left, 332px) var(--split-gap) minmax(0, 1fr)
    var(--split-gap) var(--split-right, 306px);
  gap: 0;
  padding: 0 18px 10px;
}

.col-lib {
  grid-column: 1;
  min-width: 0;
  min-height: 0;
}

.split-left {
  grid-column: 2;
}

.col-stage {
  grid-column: 3;
  display: flex;
  flex-direction: column;
  gap: 0;
  min-height: 0;
  min-width: 0;
}

.split-right {
  grid-column: 4;
}

.col-insp {
  grid-column: 5;
  display: flex;
  flex-direction: column;
  gap: 0;
  min-height: 0;
  min-width: 0;
}

/* 分栏手柄：只改尺寸，尺寸写入 localStorage；双击复位 */
.split {
  position: relative;
  z-index: 4;
  touch-action: none;
  user-select: none;
}

.split::before {
  content: '';
  position: absolute;
  background: var(--line);
  opacity: 0.55;
  transition: background 0.12s, opacity 0.12s, box-shadow 0.12s;
}

.split::after {
  content: '';
  position: absolute;
  left: 50%;
  top: 50%;
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.16);
  transition: background 0.12s, box-shadow 0.12s;
}

.split:hover::before {
  background: var(--cyan);
  opacity: 1;
  box-shadow: 0 0 8px rgba(94, 240, 200, 0.45);
}

.split:hover::after {
  background: var(--cyan);
  box-shadow: 0 0 8px rgba(94, 240, 200, 0.45);
}

.split-v {
  width: var(--split-gap);
  height: 100%;
  cursor: col-resize;
}

.split-v::before {
  top: 8px;
  bottom: 8px;
  left: 50%;
  width: 1px;
  transform: translateX(-50%);
}

.split-v::after {
  width: 4px;
  height: 34px;
  transform: translate(-50%, -50%);
}

.split-h {
  flex: 0 0 12px;
  width: 100%;
  height: 12px;
  cursor: row-resize;
}

.split-h::before {
  top: 50%;
  left: 8px;
  right: 8px;
  height: 1px;
  transform: translateY(-50%);
}

.split-h::after {
  width: 34px;
  height: 4px;
  transform: translate(-50%, -50%);
}

.stage-slot {
  flex: 1 1 auto;
  display: flex;
  min-height: 160px;
  min-width: 0;
}

.stage-panel {
  flex: 1 1 auto;
  min-height: 0;
}

.stage-switch {
  display: flex;
  align-items: center;
  gap: 6px;
  flex: 0 0 auto;
  margin-bottom: 8px;
}

.switch-btn {
  padding: 4px 12px;
  border-radius: 999px;
  border: 1px solid var(--line);
  background: rgba(255, 255, 255, 0.02);
  color: var(--muted);
  font-size: 11.5px;
  line-height: 1.4;
  transition: all 0.15s;
}

.switch-btn:hover {
  color: var(--ink);
  border-color: var(--line-strong);
}

.switch-btn.active {
  background: rgba(94, 240, 200, 0.14);
  border-color: rgba(94, 240, 200, 0.45);
  color: var(--cyan);
}

.switch-hint {
  margin-left: auto;
  font-size: 10.5px;
  color: var(--faint);
}

.console-slot {
  flex: 0 0 var(--split-console, 254px);
  height: var(--split-console, 254px);
  min-height: 0;
  display: flex;
}

.console-slot :deep(.nars) {
  flex: 1 1 auto;
  height: 100%;
  min-height: 0;
}

.inspector-panel {
  flex: 1 1 auto;
  min-height: 140px;
}

.memory-slot {
  flex: 0 0 var(--split-memory, 356px);
  height: var(--split-memory, 356px);
  min-height: 0;
  display: flex;
}

.memory-slot :deep(.memory) {
  flex: 1 1 auto;
  height: 100%;
  min-height: 0;
}

/* ---------- 底栏 ---------- */

.hintbar {
  display: flex;
  flex-wrap: wrap;
  gap: 6px 18px;
  padding: 0 20px 12px;
  font-size: 11px;
  color: var(--faint);
}

.hintbar span::before {
  content: '·';
  margin-right: 6px;
  color: rgba(255, 255, 255, 0.25);
}

.hintbar .auto {
  margin-left: auto;
  color: rgba(94, 240, 200, 0.6);
}

.hintbar .auto::before {
  content: '';
  margin-right: 0;
}

/* ---------- 提示条 ---------- */

.toast {
  position: fixed;
  left: 50%;
  bottom: 46px;
  transform: translateX(-50%);
  padding: 8px 16px;
  border-radius: 999px;
  background: rgba(10, 18, 24, 0.95);
  border: 1px solid rgba(94, 240, 200, 0.35);
  color: var(--cyan);
  font-size: 12px;
  box-shadow: 0 10px 30px rgba(0, 0, 0, 0.45);
  z-index: 20;
}

.toast-enter-active,
.toast-leave-active {
  transition: opacity 0.2s, transform 0.2s;
}

.toast-enter-from,
.toast-leave-to {
  opacity: 0;
  transform: translate(-50%, 8px);
}

@media (max-width: 1240px) {
  .workspace {
    grid-template-columns:
      min(var(--split-left, 332px), 290px) var(--split-gap)
      minmax(0, 1fr) var(--split-gap) min(var(--split-right, 306px), 270px);
  }
  .stats .stat:nth-child(2) {
    display: none;
  }
}

@media (max-width: 1040px) {
  .workspace {
    grid-template-columns:
      min(var(--split-left, 332px), 250px) var(--split-gap) minmax(0, 1fr);
  }
  .split-right,
  .col-insp {
    display: none;
  }
  .col-stage {
    grid-column: 3;
  }
  .brand-text p {
    display: none;
  }
}
</style>
