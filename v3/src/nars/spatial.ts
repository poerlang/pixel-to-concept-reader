/**
 * 2D bag：把空间项按四叉树索引，并在有限容量内按优先级保留。
 *
 * 它是“位置上的记忆索引”，不是 SRF/TRF，也不做区域/形状判定：
 * 每个条目只记录一个位置、一个索引半径和一个普通数据项。查询只回答
 * “这一带有哪些条目”，至于这些条目之间是什么关系，仍由 NAL 推理决定。
 */

import { QuadTree, type QuadBounds, type SpatialItem } from '../lib/quadtree.ts'

export type SpatialEntry<T> = {
  key: string
  x: number
  y: number
  /** 四叉树查询用的索引半径；不是图像/区域的跨度 */
  span: number
  priority: number
  data: T
}

export class SpatialBag<T> {
  private tree: QuadTree<SpatialEntry<T>>
  private readonly entries = new Map<string, SpatialEntry<T>>()
  private readonly capacity: number
  private readonly treeCapacity: number
  private readonly maxDepth: number
  private bounds: QuadBounds = { x0: -1, y0: -1, x1: 1, y1: 1 }
  private inserts = 0

  constructor(capacity = 2048, treeCapacity = 8, maxDepth = 6) {
    this.capacity = Math.max(1, Math.floor(capacity))
    this.treeCapacity = treeCapacity
    this.maxDepth = maxDepth
    this.tree = new QuadTree<SpatialEntry<T>>(treeCapacity, maxDepth, this.bounds)
  }

  get size(): number {
    return this.entries.size
  }

  put(entry: SpatialEntry<T>): void {
    this.entries.set(entry.key, entry)
    if (!this.inside(entry.x, entry.y)) {
      this.expand(entry.x, entry.y)
      this.rebuild()
    } else {
      // QuadTree 没有 remove：旧条目留在树里，查询时按 entries 的当前值过滤。
      this.tree.insert({ x: entry.x, y: entry.y, span: entry.span, data: entry })
    }
    this.inserts += 1
    if (this.entries.size > this.capacity) this.evict()
    // 定期重建，避免更新/淘汰后的旧条目无限堆积
    if (this.inserts % 64 === 0) this.rebuild()
  }

  get(key: string): SpatialEntry<T> | null {
    return this.entries.get(key) ?? null
  }

  /** 查询圆内的当前条目；旧树条目按 entries 过滤，并按优先级降序 */
  queryCircle(x: number, y: number, radius: number): SpatialEntry<T>[] {
    return this.collect(this.tree.queryCircle(x, y, radius))
  }

  /** 查询同一四叉树叶节点；这是 2D bag 自己的局部范围，不靠固定半径 */
  queryLeaf(x: number, y: number): SpatialEntry<T>[] {
    return this.collect(this.tree.leafItems(x, y))
  }

  private collect(items: Array<{ data: SpatialEntry<T> }>): SpatialEntry<T>[] {
    const seen = new Set<string>()
    const result: SpatialEntry<T>[] = []
    for (const item of items) {
      const entry = item.data
      if (seen.has(entry.key)) continue
      if (this.entries.get(entry.key) !== entry) continue
      seen.add(entry.key)
      result.push(entry)
    }
    result.sort((left, right) => right.priority - left.priority)
    return result
  }

  clear(): void {
    this.entries.clear()
    this.bounds = { x0: -1, y0: -1, x1: 1, y1: 1 }
    this.tree = new QuadTree<SpatialEntry<T>>(this.treeCapacity, this.maxDepth, this.bounds)
    this.inserts = 0
  }

  private inside(x: number, y: number): boolean {
    return x >= this.bounds.x0 && x <= this.bounds.x1 && y >= this.bounds.y0 && y <= this.bounds.y1
  }

  /** 相对锚点可以超出初始 [-1,1]；按需要扩展成更大的正方范围 */
  private expand(x: number, y: number): void {
    const minX = Math.min(this.bounds.x0, x)
    const maxX = Math.max(this.bounds.x1, x)
    const minY = Math.min(this.bounds.y0, y)
    const maxY = Math.max(this.bounds.y1, y)
    const cx = (minX + maxX) / 2
    const cy = (minY + maxY) / 2
    const half = Math.max(maxX - minX, maxY - minY, 1) / 2 + 0.5
    this.bounds = { x0: cx - half, y0: cy - half, x1: cx + half, y1: cy + half }
  }

  private evict(): void {
    let lowest: SpatialEntry<T> | null = null
    for (const entry of this.entries.values()) {
      if (!lowest || entry.priority < lowest.priority) lowest = entry
    }
    if (lowest) this.entries.delete(lowest.key)
    this.rebuild()
  }

  private rebuild(): void {
    this.tree = new QuadTree<SpatialEntry<T>>(this.treeCapacity, this.maxDepth, this.bounds)
    for (const entry of this.entries.values()) {
      this.tree.insert({ x: entry.x, y: entry.y, span: entry.span, data: entry })
    }
    this.inserts = 0
  }
}
