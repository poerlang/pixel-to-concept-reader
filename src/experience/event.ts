// 通用经验缓冲：只保存事件，不解释事件。
//
// 一个事件 = 一个 Narsese 观察 + 真值 + 时间 + 优先级。
// 容量有限；满了就淘汰优先级最低的事件。Buffer 只保留事件，不解释事件之间的关系。
// 它只提供“谁和谁同时被选中”这一种资源事实。

import type { Term } from "../nars/term.ts";
import type { Truth } from "../nars/truth.ts";

export type Event = {
  term: Term;
  truth: Truth;
  time: number;
  priority: number;
};

export class EventBuffer {
  readonly capacity: number;
  private items: Event[] = [];

  constructor(capacity = 16) {
    this.capacity = Math.max(1, Math.floor(capacity));
  }

  get size(): number {
    return this.items.length;
  }

  put(event: Event): Event[] {
    this.items.push(event);
    const evicted: Event[] = [];
    while (this.items.length > this.capacity) {
      let low = 0;
      for (let i = 1; i < this.items.length; i++) {
        if (this.items[i]!.priority < this.items[low]!.priority) low = i;
      }
      const [removed] = this.items.splice(low, 1);
      if (removed) evicted.push(removed);
    }
    return evicted;
  }

  all(): readonly Event[] {
    return this.items;
  }

  clear(): void {
    this.items = [];
  }
}
