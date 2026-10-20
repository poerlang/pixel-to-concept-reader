// 袋：定容、按优先级竞争的数据结构（书A §5.2、书B ch6 Bag）
//
// put：同键合并（优先级取 or）、满则淘汰最低者；select：按优先级取最高（确定性，便于复现）；
// putBack：按耐久性衰减（"懒惰遗忘"，书B ch7-0132）。

export type Budget = {
  priority: number;
  durability: number;
  quality: number;
};

const clamp = (x: number): number => (x < 0.01 ? 0.01 : x > 1 ? 1 : x);
const or = (a: number, b: number): number => 1 - (1 - a) * (1 - b);

export class Bag<T extends Budget> {
  readonly capacity: number;
  private items: T[] = [];
  private order = new Map<T, number>();
  private serial = 0;

  constructor(capacity: number) {
    this.capacity = Math.max(1, capacity);
  }

  get size(): number {
    return this.items.length;
  }

  all(): T[] {
    return [...this.items];
  }

  put(item: T): T[] {
    const same = this.items.find((x) => x === item);
    if (!same) {
      this.items.push(item);
      this.order.set(item, this.serial++);
    }
    return this.evict();
  }

  /** 同键的句子只留一份并合并预算；由调用方按 key 判重后自行 put（见 merge） */
  mergeKey(key: string, item: T, keyOf: (x: T) => string): T[] {
    const existing = this.items.find((x) => keyOf(x) === key);
    if (existing) {
      existing.priority = clamp(or(existing.priority, item.priority));
      existing.quality = Math.max(existing.quality, item.quality);
      return [];
    }
    return this.put(item);
  }

  select(): T | null {
    let best: T | null = null;
    for (const item of this.items) {
      if (!best || item.priority > best.priority) best = item;
    }
    if (best) this.items = this.items.filter((x) => x !== best);
    return best;
  }

  putBack(item: T): T[] {
    item.priority = clamp(item.priority * item.durability);
    if (item.priority <= 0.02) return [];
    return this.put(item);
  }

  private evict(): T[] {
    if (this.items.length <= this.capacity) return [];
    let lowest = 0;
    for (let i = 1; i < this.items.length; i++) {
      const a = this.items[i]!;
      const b = this.items[lowest]!;
      if (a.priority < b.priority || (a.priority === b.priority && this.order.get(a)! < this.order.get(b)!)) lowest = i;
    }
    const [removed] = this.items.splice(lowest, 1);
    return removed ? [removed] : [];
  }
}
