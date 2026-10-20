// Shift：一次“跳跃”/换焦点。只比较普通属性，没有形状/近邻谓词。
//
// 花费 = 改变的属性数 + 一点距离代价。系统因此倾向于少改变、相似、近的焦点，
// 对应习惯/节能；这是操作选择策略，不是记忆里的概念。

import { propertiesOf, type Entity } from "./world.ts";

export type Shift = {
  from: Entity;
  to: Entity;
  same: string[];
  changed: string[];
  distance: number;
  cost: number;
};

export function shiftTo(from: Entity, to: Entity): Shift {
  const before = propertiesOf(from);
  const after = propertiesOf(to);
  const same: string[] = [];
  const changed: string[] = [];
  for (let i = 0; i < before.length; i++) {
    if (before[i] === after[i]) same.push(before[i]!);
    else changed.push(`${before[i]}→${after[i]}`);
  }
  const distance = Math.hypot(to.x - from.x, to.y - from.y, to.z - from.z);
  return {
    from,
    to,
    same,
    changed,
    distance,
    cost: changed.length / Math.max(1, before.length) + distance * 0.05,
  };
}

/** 从 from 出发，在有限候选里选“最少改变 + 最近”的目标；没有别的实体就返回 null。 */
export function planShift(entities: Entity[], fromId: string): Shift | null {
  const from = entities.find((entity) => entity.id === fromId) ?? entities[0];
  if (!from) return null;
  let best: Shift | null = null;
  for (const to of entities) {
    if (to.id === from.id) continue;
    const shift = shiftTo(from, to);
    if (!best || shift.cost < best.cost) best = shift;
  }
  return best;
}
