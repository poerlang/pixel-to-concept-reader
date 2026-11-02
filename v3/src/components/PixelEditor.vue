<script setup lang="ts">
import { onMounted, ref, watch } from 'vue'
import { IMAGE_SIDE } from '../scene/types.ts'

const props = defineProps<{
  pixels: Uint8Array
  invert: boolean
}>()

const emit = defineEmits<{
  (event: 'change', pixels: Uint8Array): void
}>()

const SCALE = 9
const canvasRef = ref<HTMLCanvasElement | null>(null)
const mode = ref<'pen' | 'eraser'>('pen')

let painting = false
let working: Uint8Array | null = null
let lastCell: { x: number; y: number } | null = null

function setMode(next: 'pen' | 'eraser') {
  mode.value = next
}

function render() {
  const canvas = canvasRef.value
  if (!canvas) return
  const context = canvas.getContext('2d')
  if (!context) return
  const side = IMAGE_SIDE * SCALE
  context.fillStyle = '#05080b'
  context.fillRect(0, 0, side, side)

  for (let y = 0; y < IMAGE_SIDE; y++) {
    for (let x = 0; x < IMAGE_SIDE; x++) {
      const value = props.pixels[y * IMAGE_SIDE + x] ?? 0
      const shown = props.invert ? 255 - value : value
      context.fillStyle = `rgb(${shown},${shown},${shown})`
      context.fillRect(x * SCALE, y * SCALE, SCALE, SCALE)
    }
  }

  context.strokeStyle = 'rgba(255, 255, 255, 0.07)'
  context.lineWidth = 1
  context.beginPath()
  for (let index = 1; index < IMAGE_SIDE; index++) {
    const offset = index * SCALE + 0.5
    context.moveTo(offset, 0)
    context.lineTo(offset, side)
    context.moveTo(0, offset)
    context.lineTo(side, offset)
  }
  context.stroke()
}

function cellFrom(event: PointerEvent): { x: number; y: number } | null {
  const canvas = canvasRef.value
  if (!canvas) return null
  const rect = canvas.getBoundingClientRect()
  const x = Math.floor(((event.clientX - rect.left) / rect.width) * IMAGE_SIDE)
  const y = Math.floor(((event.clientY - rect.top) / rect.height) * IMAGE_SIDE)
  if (x < 0 || y < 0 || x >= IMAGE_SIDE || y >= IMAGE_SIDE) return null
  return { x, y }
}

function paintCell(x: number, y: number) {
  if (!working) return false
  const value = mode.value === 'pen' ? 255 : 0
  const index = y * IMAGE_SIDE + x
  if (working[index] === value) return false
  working[index] = value
  return true
}

function paintLine(from: { x: number; y: number }, to: { x: number; y: number }) {
  const dx = to.x - from.x
  const dy = to.y - from.y
  const steps = Math.max(Math.abs(dx), Math.abs(dy))
  let touched = false
  for (let step = 0; step <= steps; step++) {
    const x = steps === 0 ? to.x : Math.round(from.x + (dx * step) / steps)
    const y = steps === 0 ? to.y : Math.round(from.y + (dy * step) / steps)
    if (paintCell(x, y)) touched = true
  }
  return touched
}

function onPointerDown(event: PointerEvent) {
  const canvas = canvasRef.value
  const cell = cellFrom(event)
  if (!canvas || !cell) return
  event.preventDefault()
  canvas.setPointerCapture(event.pointerId)
  painting = true
  working = props.pixels.slice()
  lastCell = cell
  if (paintCell(cell.x, cell.y)) emit('change', working.slice())
}

function onPointerMove(event: PointerEvent) {
  if (!painting) return
  const cell = cellFrom(event)
  if (!cell) return
  const from = lastCell ?? cell
  const touched = paintLine(from, cell)
  lastCell = cell
  if (touched && working) emit('change', working.slice())
}

function onPointerUp(event: PointerEvent) {
  const canvas = canvasRef.value
  if (canvas?.hasPointerCapture(event.pointerId)) canvas.releasePointerCapture(event.pointerId)
  painting = false
  lastCell = null
  working = null
}

onMounted(render)
watch(() => [props.pixels, props.invert], render)
</script>

<template>
  <div class="pixel-editor">
    <div class="tools">
      <button class="chip" :class="{ active: mode === 'pen' }" @click="setMode('pen')">画笔</button>
      <button class="chip" :class="{ active: mode === 'eraser' }" @click="setMode('eraser')">
        橡皮
      </button>
      <span class="hint">点格子涂改</span>
    </div>
    <canvas
      ref="canvasRef"
      :width="IMAGE_SIDE * SCALE"
      :height="IMAGE_SIDE * SCALE"
      @pointerdown="onPointerDown"
      @pointermove="onPointerMove"
      @pointerup="onPointerUp"
      @pointercancel="onPointerUp"
    />
  </div>
</template>

<style scoped>
.pixel-editor {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.tools {
  display: flex;
  align-items: center;
  gap: 6px;
}

.hint {
  margin-left: auto;
  font-size: 10.5px;
  color: var(--faint);
}

canvas {
  width: 100%;
  max-width: 252px;
  aspect-ratio: 1;
  display: block;
  border-radius: 8px;
  border: 1px solid var(--line);
  touch-action: none;
  cursor: crosshair;
  image-rendering: pixelated;
}
</style>
