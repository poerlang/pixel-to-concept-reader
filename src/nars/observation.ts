// 观察缓冲：感知通道交来的候选先按优先级进定容袋，推理层只看到被选中的观察。
//
// 书A ch13-0010/0015/0025/0037：缓冲是优先级队列，容量有限，低优先级被淘汰；
// 事件缓冲本身就是低层知觉的处理单元。这里不认识具体类别/像素，只认识
// “词项 + 真值 + 优先级 + 感受野/划分”。
//
// 同一划分内同词项只留一次（取最高优先级）；不同划分可以各自保留，
// 这样多观察集/多划分可以分别问句，再用 revision 合并（见 merge.ts）。

import { Bag } from "./bag.ts";
import type { Term } from "./term.ts";
import type { Truth } from "./truth.ts";

export type Observation = {
  term: Term;
  truth: Truth;
  /** 相对感受野/背景的显著度；由通道给，不是类别证据 */
  priority: number;
  /** 证据基础：同一感受野的一次观察共享；不同划分不共享 */
  base: number[];
  /** 感受野/来源标识（哪块区域、哪条链、哪个划分） */
  field: string;
  /** 观察集/划分标识；同一划分内同词项只留一次 */
  partition: string;
};

export type ObservationInput = Omit<Observation, "base"> & { base?: number[] };

type Scored = {
  observation: Observation;
  priority: number;
  durability: number;
  quality: number;
};

const clamp = (x: number): number => (x < 0 ? 0 : x > 1 ? 1 : x);

export class ObservationBuffer {
  readonly capacity: number;

  constructor(capacity: number) {
    this.capacity = Math.max(1, Math.floor(capacity));
  }

  /**
   * 候选按优先级竞争，只取前 capacity 个。
   * 优先级相同则保持输入顺序（`-index*1e-12` 只用于打破 Bag 的平局）。
   */
  select(inputs: ObservationInput[]): Observation[] {
    const bag = new Bag<Scored>(this.capacity);
    const seen = new Set<string>();
    for (let index = 0; index < inputs.length; index++) {
      const input = inputs[index]!;
      const key = `${input.partition}\u0000${input.term.key}`;
      if (seen.has(key)) continue;
      seen.add(key);
      bag.put({
        observation: {
          term: input.term,
          truth: input.truth,
          priority: clamp(input.priority),
          base: input.base ?? [index],
          field: input.field,
          partition: input.partition,
        },
        priority: clamp(input.priority) - index * 1e-12,
        durability: 1,
        quality: 1,
      });
    }
    const out: Observation[] = [];
    while (out.length < this.capacity) {
      const next = bag.select();
      if (!next) break;
      out.push(next.observation);
    }
    return out;
  }

  /** 按观察集/划分分组；划分内的观察共享同一证据基础。 */
  static byPartition(observations: Observation[]): Map<string, Observation[]> {
    const groups = new Map<string, Observation[]>();
    for (const observation of observations) {
      const group = groups.get(observation.partition) ?? [];
      group.push(observation);
      groups.set(observation.partition, group);
    }
    return groups;
  }
}
