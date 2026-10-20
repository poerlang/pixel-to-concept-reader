// 注意/竞争：候选按“证据量 × 纯度”进定容袋，选中一个后与它重叠的候选按 Jaccard 衰减。
//
// 这是通用控制：不认识具体类别，也不决定类别。它替代的是感知层里的
// “赢者通吃”（一个格只能归一个候选）——那种做法把“划分”提前写死在通道里。
// 现在候选允许重叠，由容量 + 优先级 + 重叠竞争决定谁被看到；
// 同一区域的多尺度候选（小盘/大盘）因为 Jaccard 低，可以同时保留。

import { Bag } from "./bag.ts";

type Scored<T> = {
  item: T;
  priority: number;
  durability: number;
  quality: number;
  cells: Set<number>;
};

export type DiverseOptions<T> = {
  /** 注意预算：最多保留多少个候选。 */
  capacity: number;
  /** 通用显著度：越大越先被看到。 */
  score: (item: T) => number;
  /** 候选覆盖的格；只用于计算重叠，不进入记忆。 */
  members: (item: T) => readonly number[];
};

/**
 * 定容 + 重叠衰减的候选选择。
 *
 * - 先按 `score` 归一化进袋；
 * - 每选出一个，就把剩余候选的优先级乘以 `1 - Jaccard(已选, 候选)`；
 * - Jaccard 对“同一位置的重复候选”接近 1，对“大盘里的小盘”很低，所以多尺度不会被互相吃掉；
 * - 优先级降到 0 的候选不再占预算。
 */
export function selectDiverse<T>(items: T[], options: DiverseOptions<T>): T[] {
  const capacity = Math.max(1, Math.floor(options.capacity));
  if (items.length === 0) return [];
  const raw = items.map((item) => ({
    item,
    score: Math.max(0, options.score(item)),
    cells: new Set(options.members(item)),
  }));
  const max = Math.max(...raw.map((entry) => entry.score));
  if (!(max > 0)) return [];

  const bag = new Bag<Scored<T>>(raw.length);
  for (const entry of raw) {
    if (entry.cells.size === 0) continue;
    bag.put({
      item: entry.item,
      priority: entry.score / max,
      durability: 1,
      quality: 1,
      cells: entry.cells,
    });
  }

  const out: T[] = [];
  while (out.length < capacity) {
    const best = bag.select();
    if (!best || best.priority <= 1e-9) break;
    out.push(best.item);
    for (const other of bag.all()) {
      let overlap = 0;
      for (const cell of other.cells) if (best.cells.has(cell)) overlap++;
      const union = best.cells.size + other.cells.size - overlap;
      other.priority *= 1 - (union > 0 ? overlap / union : 0);
    }
  }
  return out;
}
