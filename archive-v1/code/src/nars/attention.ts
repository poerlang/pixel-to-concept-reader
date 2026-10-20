// 注意/缓冲：候选不是按数组顺序处理，而是按优先级进定容袋，只取前 capacity 个。
// 这是通用控制，不认识 loop/digit/像素。
import { Bag } from "./bag.ts";

type Scored<T> = { item: T; priority: number; durability: number; quality: number };

export function selectTop<T>(items: T[], score: (item: T) => number, capacity: number): T[] {
  const bag = new Bag<Scored<T>>(Math.max(1, capacity));
  for (const item of items) {
    bag.put({ item, priority: Math.max(0, Math.min(1, score(item))), durability: 1, quality: 1 });
  }
  const out: T[] = [];
  while (out.length < capacity) {
    const next = bag.select();
    if (!next) break;
    out.push(next.item);
  }
  return out;
}
