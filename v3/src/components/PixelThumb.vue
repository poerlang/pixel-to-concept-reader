<script setup lang="ts">
import { onMounted, ref, watch } from 'vue'
import { IMAGE_SIDE } from '../scene/types.ts'

const props = withDefaults(
  defineProps<{
    pixels: Uint8Array
    size?: number
    invert?: boolean
  }>(),
  { size: 52, invert: false },
)

const canvasRef = ref<HTMLCanvasElement | null>(null)

function paint() {
  const canvas = canvasRef.value
  if (!canvas) return
  const context = canvas.getContext('2d')
  if (!context) return
  canvas.width = IMAGE_SIDE
  canvas.height = IMAGE_SIDE
  const image = context.createImageData(IMAGE_SIDE, IMAGE_SIDE)
  const pixels = props.pixels
  for (let index = 0; index < IMAGE_SIDE * IMAGE_SIDE; index++) {
    const value = pixels[index] ?? 0
    const shown = props.invert ? 255 - value : value
    const offset = index * 4
    image.data[offset] = shown
    image.data[offset + 1] = shown
    image.data[offset + 2] = shown
    image.data[offset + 3] = 255
  }
  context.putImageData(image, 0, 0)
}

onMounted(paint)
watch(() => [props.pixels, props.invert], paint)
</script>

<template>
  <canvas
    ref="canvasRef"
    class="pixel-thumb"
    :style="{ width: `${size}px`, height: `${size}px` }"
  />
</template>

<style scoped>
.pixel-thumb {
  display: block;
  image-rendering: pixelated;
  border-radius: 4px;
}
</style>
