/**
 * 黑白视野。
 *
 * 统一按「黑底白笔画」：cells 里 1 = 黑（背景），0 = 白（笔画），
 * 与场景 / MNIST 图像的黑底白墨一致；反色显示时按反色后的画面算。
 *
 * 扫描头是浮点坐标（0..1），可以停在格子里任意位置；
 * 但「视野里的像素」本身还是 side×side 的格子，并且被一棵四叉树索引：
 * - 走路：在四叉树里按半径搜目标像素，跳到它们的中心（浮点）；
 * - 读像素：只有这一步需要，才把浮点坐标落回格子去读 cells。
 */

import { QuadTree } from '../lib/quadtree.ts'

/** 视野边长（格），与场景里的图像一致 */
export const BOARD_SIDE = 28

/** 搜索半径 = 格距 × 这个系数（稍微比一格大一圈） */
export const SEARCH_RADIUS_CELLS = 3

/** 四叉树里存的一个像素 */
export type PixelDatum = {
  column: number
  row: number
  /** 1 = 黑（背景），0 = 白（笔画） */
  value: 0 | 1
}

export class Board {
  static readonly SIDE = BOARD_SIDE

  /** 边长（格） */
  readonly side: number

  /** 像素格：1 = 黑，0 = 白（只用来读） */
  readonly cells: number[][]

  /** 像素四叉树：每个格子按中心点插进去 */
  readonly pixelTree = new QuadTree<PixelDatum>(4, 6)

  /** 扫描头 x（0..1，浮点） */
  x = 0.5

  /** 扫描头 y（0..1，浮点） */
  y = 0.5

  constructor(side = BOARD_SIDE) {
    this.side = side
    this.cells = Array.from({ length: side }, () => new Array<number>(side).fill(1))
    this.rebuildPixelTree()
  }

  /** 一格的边长（视野单位） */
  get cellSize(): number {
    return 1 / this.side
  }

  /** 一次搜索的半径：格距换算到视野，再放大几倍 */
  get searchRadius(): number {
    return this.cellSize * SEARCH_RADIUS_CELLS
  }

  /** 用一张 side×side 灰度图铺视野：亮的是笔画（白 0），暗的是背景（黑 1） */
  setPixels(pixels: Uint8Array, threshold = 96): this {
    for (let row = 0; row < this.side; row++) {
      for (let column = 0; column < this.side; column++) {
        const value = pixels[row * this.side + column] ?? 0
        this.cells[row]![column] = value > threshold ? 0 : 1
      }
    }
    this.rebuildPixelTree()
    return this
  }

  /** 重建像素四叉树：每格以中心点入树 */
  rebuildPixelTree(): this {
    this.pixelTree.clear()
    const half = this.cellSize / 2
    for (let row = 0; row < this.side; row++) {
      for (let column = 0; column < this.side; column++) {
        this.pixelTree.insert({
          x: (column + 0.5) * this.cellSize,
          y: (row + 0.5) * this.cellSize,
          span: half,
          data: { column, row, value: this.cells[row]![column] ? 1 : 0 },
        })
      }
    }
    return this
  }

  /** 扫描头归中 */
  resetCursor(): this {
    this.x = 0.5
    this.y = 0.5
    return this
  }

  /** 浮点坐标落在哪一格 */
  cellAt(x = this.x, y = this.y): { column: number; row: number } {
    const column = Math.min(this.side - 1, Math.max(0, Math.floor(x * this.side)))
    const row = Math.min(this.side - 1, Math.max(0, Math.floor(y * this.side)))
    return { column, row }
  }

  /** 读原始格值；默认 1 = 黑，0 = 白，自定义 Sensor 可解释更多编码 */
  readRawAt(x: number, y: number): number {
    const { column, row } = this.cellAt(x, y)
    return this.cells[row]?.[column] ?? 0
  }

  /** 读某个浮点位置的像素（二进制兼容视图）：1 = 黑，0 = 白 */
  readAt(x: number, y: number): 0 | 1 {
    return this.readRawAt(x, y) ? 1 : 0
  }

  /** 读扫描头脚下的原始格值 */
  readRaw(): number {
    return this.readRawAt(this.x, this.y)
  }

  /** 读扫描头脚下的像素（二进制兼容视图） */
  read(): 0 | 1 {
    return this.readRaw() ? 1 : 0
  }

  /** 在四叉树里按半径搜周围的像素 */
  searchPixels(x = this.x, y = this.y, radius = this.searchRadius) {
    return this.pixelTree.queryCircle(x, y, radius)
  }

  /** 把扫描头挪到任意浮点位置（夹在视野内） */
  jumpTo(x: number, y: number): this {
    this.x = Math.min(1, Math.max(0, x))
    this.y = Math.min(1, Math.max(0, y))
    return this
  }

  /**
   * 沿一个轴走一格（浮点坐标 + 一格距离）。
   * 越界就朝反方向走（碰壁反弹）；两边都出界才不动。返回实际方向 -1/0/1。
   */
  moveAxis(axis: 'x' | 'y', direction: number): number {
    const sign = direction < 0 ? -1 : 1
    const step = this.cellSize * sign
    const current = axis === 'x' ? this.x : this.y
    let actual = sign
    let next = current + step
    if (next < 0 || next > 1) {
      actual = -sign
      next = current + this.cellSize * actual
      if (next < 0 || next > 1) return 0
    }
    if (axis === 'x') this.x = next
    else this.y = next
    return actual
  }
}
