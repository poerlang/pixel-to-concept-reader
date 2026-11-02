/**
 * 简版四叉树：场景对象以浮点坐标（0..1）注册，按象限递归四分。
 * 搬自 pdftest7 的 quadtree，追加了节点统计与遍历，便于在画布上把划分画出来。
 */

/** 空间项：中心点 + 影响半径 + 数据 */
export type SpatialItem<T> = {
  x: number
  y: number
  span: number
  data: T
}

/** 四叉树节点（固定象限划分） */
export type QuadNode<T> = {
  x0: number
  y0: number
  x1: number
  y1: number
  depth: number
  items: SpatialItem<T>[]
  children: QuadNode<T>[] | null
}

export type QuadBounds = { x0: number; y0: number; x1: number; y1: number }

export class QuadTree<T> {
  private root: QuadNode<T>
  private count = 0
  private capacity: number
  private maxDepth: number
  private readonly bounds: QuadBounds

  /** capacity 为节点容量，超过则四分；maxDepth 限制递归深度；bounds 为根范围 */
  constructor(capacity = 4, maxDepth = 6, bounds: QuadBounds = { x0: 0, y0: 0, x1: 1, y1: 1 }) {
    this.capacity = capacity
    this.maxDepth = maxDepth
    this.bounds = bounds
    this.root = this.makeNode(bounds.x0, bounds.y0, bounds.x1, bounds.y1, 0)
  }

  /** 当前条目数 */
  get size(): number {
    return this.count
  }

  /** 节点总数 */
  get nodeCount(): number {
    let total = 0
    this.forEachNode(() => {
      total += 1
    })
    return total
  }

  /** 最大深度 */
  get depth(): number {
    let max = 0
    this.forEachNode((node) => {
      if (node.depth > max) max = node.depth
    })
    return max
  }

  /** 叶子节点数 */
  get leafCount(): number {
    let leaves = 0
    this.forEachNode((node) => {
      if (!node.children) leaves += 1
    })
    return leaves
  }

  /** 清空 */
  clear() {
    this.root = this.makeNode(this.bounds.x0, this.bounds.y0, this.bounds.x1, this.bounds.y1, 0)
    this.count = 0
  }

  /** 插入一项（坐标 0..1，span 为影响半径） */
  insert(item: SpatialItem<T>) {
    this.insertInto(this.root, item)
    this.count += 1
  }

  /** 以 (x,y) 为心、radius 为半径查询（命中判定含 item 自身 span） */
  queryCircle(x: number, y: number, radius: number): SpatialItem<T>[] {
    const result: SpatialItem<T>[] = []
    this.queryNode(this.root, x, y, radius, result)
    return result
  }

  /** 返回包含 (x,y) 的叶节点里的条目；不引入固定距离阈值 */
  leafItems(x: number, y: number): SpatialItem<T>[] {
    const px = Math.min(this.bounds.x1, Math.max(this.bounds.x0, x))
    const py = Math.min(this.bounds.y1, Math.max(this.bounds.y0, y))
    let node = this.root
    while (node.children) node = this.childFor(node, px, py)
    return node.items.slice()
  }

  /** 深度优先遍历所有节点 */
  forEachNode(visit: (node: QuadNode<T>) => void) {
    const walk = (node: QuadNode<T>) => {
      visit(node)
      if (node.children) for (const child of node.children) walk(child)
    }
    walk(this.root)
  }

  private makeNode(x0: number, y0: number, x1: number, y1: number, depth: number): QuadNode<T> {
    return { x0, y0, x1, y1, depth, items: [], children: null }
  }

  private insertInto(node: QuadNode<T>, item: SpatialItem<T>) {
    if (node.children) {
      this.insertInto(this.childFor(node, item.x, item.y), item)
      return
    }
    node.items.push(item)
    if (node.items.length > this.capacity && node.depth < this.maxDepth) this.split(node)
  }

  private split(node: QuadNode<T>) {
    const midX = (node.x0 + node.x1) / 2
    const midY = (node.y0 + node.y1) / 2
    node.children = [
      this.makeNode(node.x0, node.y0, midX, midY, node.depth + 1),
      this.makeNode(midX, node.y0, node.x1, midY, node.depth + 1),
      this.makeNode(node.x0, midY, midX, node.y1, node.depth + 1),
      this.makeNode(midX, midY, node.x1, node.y1, node.depth + 1),
    ]
    for (const item of node.items) {
      this.childFor(node, item.x, item.y).items.push(item)
    }
    node.items = []
  }

  private childFor(node: QuadNode<T>, x: number, y: number): QuadNode<T> {
    const midX = (node.x0 + node.x1) / 2
    const midY = (node.y0 + node.y1) / 2
    const right = x >= midX ? 1 : 0
    const bottom = y >= midY ? 1 : 0
    return node.children![right + bottom * 2]!
  }

  private queryNode(node: QuadNode<T>, x: number, y: number, radius: number, result: SpatialItem<T>[]) {
    if (node.x1 < x - radius || node.x0 > x + radius || node.y1 < y - radius || node.y0 > y + radius) {
      return
    }
    if (node.children) {
      for (const child of node.children) this.queryNode(child, x, y, radius, result)
      return
    }
    for (const item of node.items) {
      const reach = radius + item.span
      const dx = item.x - x
      const dy = item.y - y
      if (dx * dx + dy * dy <= reach * reach) result.push(item)
    }
  }
}
