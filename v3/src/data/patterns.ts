/**
 * 基础形状：搬自 pdftest7 的 image-lab（横线/竖线/斜线/点/圆/环/半圆/曲线…）。
 * 原有生成器是在「白底黑墨」的 cells 上画（1=白 0=墨），
 * 这里统一翻成 MNIST 的「黑底白墨」灰度：墨=255，底=0。
 */

import { IMAGE_SIDE, PIXEL_COUNT } from '../scene/types.ts'

export type ShapeName =
  | 'hline'
  | 'vline'
  | 'diag'
  | 'diag-back'
  | 'dot'
  | 'thick-dot'
  | 'circle'
  | 'ring'
  | 'semicircle'
  | 's-curve'
  | 'corner'
  | 'curve'
  | 'interleave'

export type ShapeSpec = {
  name: ShapeName
  /** 列表里显示的中文名 */
  label: string
  /** 把图案画进 cells：1=白 0=墨 */
  paint: (cells: number[][], side: number) => void
}

function fill(cells: number[][], side: number, x: number, y: number, thickness = 1) {
  const half = Math.floor((thickness - 1) / 2)
  for (let dy = -half; dy <= half; dy++) {
    for (let dx = -half; dx <= half; dx++) {
      const cx = x + dx
      const cy = y + dy
      if (cx >= 0 && cy >= 0 && cx < side && cy < side) cells[cy]![cx] = 0
    }
  }
}

/** 形状清单（顺序即列表顺序） */
export const shapeSequence: ShapeSpec[] = [
  {
    name: 'hline',
    label: '横线',
    paint: (cells, side) => {
      const y = Math.floor(side / 2)
      for (let x = 2; x < side - 2; x++) fill(cells, side, x, y, 3)
    },
  },
  {
    name: 'vline',
    label: '竖线',
    paint: (cells, side) => {
      const x = Math.floor(side / 2)
      for (let y = 2; y < side - 2; y++) fill(cells, side, x, y, 3)
    },
  },
  {
    name: 'diag',
    label: '斜线',
    paint: (cells, side) => {
      for (let t = 2; t < side - 2; t++) fill(cells, side, t, t, 3)
    },
  },
  {
    name: 'diag-back',
    label: '反斜线',
    paint: (cells, side) => {
      for (let t = 2; t < side - 2; t++) fill(cells, side, t, side - 1 - t, 3)
    },
  },
  {
    name: 'dot',
    label: '点',
    paint: (cells, side) => fill(cells, side, side >> 1, side >> 1, 1),
  },
  {
    name: 'thick-dot',
    label: '粗点',
    paint: (cells, side) => fill(cells, side, side >> 1, side >> 1, 5),
  },
  {
    name: 'circle',
    label: '实心圆',
    paint: (cells, side) => {
      const cx = side / 2
      const cy = side / 2
      const r = side * 0.22
      for (let y = 0; y < side; y++) {
        for (let x = 0; x < side; x++) {
          if (Math.hypot(x + 0.5 - cx, y + 0.5 - cy) <= r) cells[y]![x] = 0
        }
      }
    },
  },
  {
    name: 'ring',
    label: '圆环',
    paint: (cells, side) => {
      const cx = side / 2
      const cy = side / 2
      const r = side * 0.28
      for (let y = 0; y < side; y++) {
        for (let x = 0; x < side; x++) {
          const d = Math.hypot(x + 0.5 - cx, y + 0.5 - cy)
          if (d <= r && d >= r * 0.72) cells[y]![x] = 0
        }
      }
    },
  },
  {
    name: 'semicircle',
    label: '半圆',
    paint: (cells, side) => {
      const cx = side / 2
      const cy = side / 2
      const r = side * 0.32
      for (let y = 0; y < side; y++) {
        for (let x = 0; x < side; x++) {
          const dx = x + 0.5 - cx
          const dy = y + 0.5 - cy
          if (Math.hypot(dx, dy) <= r && dx >= 0) cells[y]![x] = 0
        }
      }
    },
  },
  {
    name: 's-curve',
    label: 'S 曲线',
    paint: (cells, side) => {
      for (let t = 2; t < side - 2; t++) {
        const y = side / 2 + Math.sin((t / side) * Math.PI * 2) * (side * 0.22)
        fill(cells, side, t, Math.round(y), 3)
      }
    },
  },
  {
    name: 'corner',
    label: '角',
    paint: (cells, side) => {
      const x0 = 4
      const y0 = 4
      for (let x = x0; x < side - 4; x++) fill(cells, side, x, y0, 3)
      for (let y = y0; y < side - 4; y++) fill(cells, side, x0, y, 3)
    },
  },
  {
    name: 'curve',
    label: '曲线',
    paint: (cells, side) => {
      for (let t = 2; t < side - 2; t++) {
        const y = side * 0.75 - (t * t) / side
        fill(cells, side, t, Math.round(y), 3)
      }
    },
  },
  {
    name: 'interleave',
    label: '交叉波纹',
    paint: (cells, side) => {
      for (let t = 2; t < side - 2; t++) {
        fill(cells, side, t, Math.round(side / 2 + Math.sin(t) * 2), 2)
        fill(cells, side, Math.round(side / 2 + Math.sin(t) * 2), t, 2)
      }
    },
  },
]

/** 生成 28×28 灰度像素：墨 255，底 0 */
export function shapePixels(name: ShapeName, side = IMAGE_SIDE): Uint8Array {
  const spec = shapeSequence.find((entry) => entry.name === name)
  const cells: number[][] = Array.from({ length: side }, () => new Array<number>(side).fill(1))
  if (spec) spec.paint(cells, side)
  const pixels = new Uint8Array(PIXEL_COUNT)
  for (let y = 0; y < side; y++) {
    for (let x = 0; x < side; x++) {
      pixels[y * side + x] = cells[y]![x] ? 0 : 255
    }
  }
  return pixels
}
