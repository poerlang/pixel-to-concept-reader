/**
 * 场景 → NARS 运行台的桥。
 *
 * 拖进场景的对象（以及被选中的对象）会以「所见即所得」的像素喂给 NARS 视野：
 * 反色显示时，喂的是反色后的图，运行台里扫到的黑白与画面一致。
 *
 * 2D / 3D 场景按 appliedId 画扫描头，运行台本身不再画缩略图。
 */

import { ref, watch } from 'vue'
import { setBoardImage } from './nars/index.ts'
import { markNarsChanged } from './narsLive.ts'
import { useScene } from './scene/store.ts'
import type { SceneItem } from './scene/types.ts'

const { items, selected, selectedId } = useScene()

/** 当前喂给 NARS 的对象 id；扫描头跟着它画 */
export const appliedId = ref<string | null>(null)

/** 最近一次喂图时对象是否是反色（用来跟随反色开关） */
let appliedInvert: boolean | null = null

/** 画面里看到的那版像素（考虑反色） */
export function displayPixels(item: SceneItem): Uint8Array {
  if (!item.invert) return item.pixels
  const flipped = new Uint8Array(item.pixels.length)
  for (let index = 0; index < flipped.length; index++) {
    flipped[index] = 255 - (item.pixels[index] ?? 0)
  }
  return flipped
}

/** 把对象喂进运行台：视野换成它、扫描头归中、缓冲与记忆清空 */
export function applyItem(item: SceneItem): void {
  setBoardImage(displayPixels(item))
  appliedId.value = item.id
  appliedInvert = item.invert
  markNarsChanged()
}

/** 当前喂给运行台的对象（可能已被删除） */
export function appliedItem(): SceneItem | null {
  return items.value.find((item) => item.id === appliedId.value) ?? null
}

const stopSelected = watch(
  () => selectedId.value,
  () => {
    if (selected.value) applyItem(selected.value)
  },
  { immediate: true },
)

const stopItems = watch(
  () => items.value.map((item) => item.id).join('|'),
  () => {
    if (appliedId.value && !items.value.some((item) => item.id === appliedId.value)) {
      appliedId.value = null
      appliedInvert = null
    }
  },
)

// 反色开关改了，运行台看到的黑白也要跟着翻过来
const stopInvert = watch(
  () => appliedItem()?.invert ?? null,
  (next) => {
    if (next === null || next === appliedInvert) return
    const item = appliedItem()
    if (item) applyItem(item)
  },
)

if (import.meta.hot) {
  import.meta.hot.dispose(() => {
    stopSelected()
    stopItems()
    stopInvert()
  })
}
