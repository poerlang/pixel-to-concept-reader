/** Bag 条目：负载 + 优先级 */
export type BagItem<T> = {
  item: T
  priority: number
}

/** 无 level 的极简 Bag：一次取出一项，无 peekAll */
export class Bag<T> {
  /** 条目存储 */
  private entries: BagItem<T>[] = []

  /** 容量上限 */
  capacity: number

  /** 创建 Bag，capacity 为容量上限 */
  constructor(capacity = 100) {
    this.capacity = capacity
  }

  /** 放入一项；超容量时挤出优先级最低的一项 */
  put(item: T, priority = 0.5): void {
    this.entries.push({ item, priority })
    if (this.entries.length > this.capacity) {
      let lowestIndex = 0
      for (let index = 1; index < this.entries.length; index++) {
        if (this.entries[index]!.priority < this.entries[lowestIndex]!.priority) lowestIndex = index
      }
      this.entries.splice(lowestIndex, 1)
    }
  }

  /**
   * 按优先级随机取出一项：
   * 优先级越高的段落越宽，random 落在哪段就取谁。
   */
  take(): T | undefined {
    if (!this.entries.length) return undefined
    const totalPriority = this.entries.reduce((sum, entry) => sum + entry.priority, 0)
    let remaining = Math.random() * totalPriority
    for (let index = 0; index < this.entries.length; index++) {
      remaining -= this.entries[index]!.priority
      if (remaining <= 0) return this.entries.splice(index, 1)[0]!.item
    }
    return this.entries.pop()!.item
  }

  /** 清空全部条目 */
  clear(): void {
    this.entries = []
  }

  /** 当前条目数 */
  get size(): number {
    return this.entries.length
  }
}
