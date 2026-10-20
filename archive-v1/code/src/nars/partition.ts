// 划分：书A ch13-0084 的通用形式。
//
// 当前最高优先级的项，要么并入前一个感觉词项，要么单独成项；考虑前 n 项会生成 2^(n-1)
// 个划分，缓冲只保留优先级最高的若干个。这里不绑定视觉，也不写分类。

import { compound, type Term } from "./term.ts";

export type PartitionItem = {
  term: Term;
  priority: number;
};

export type PartitionBlock = {
  term: Term;
  items: PartitionItem[];
};

export type Partition = {
  /** 整个划分作为一个序列复合词项（∘ 是 NAL-7 的序列合取占位）。 */
  term: Term;
  blocks: PartitionBlock[];
  priority: number;
};

function blockTerm(items: PartitionItem[]): Term {
  return items.length === 1 ? items[0]!.term : compound("∘", items.map((item) => item.term));
}

function build(cuts: number, items: PartitionItem[]): Partition {
  const blocks: PartitionBlock[] = [];
  let start = 0;
  for (let i = 0; i < items.length; i++) {
    const end = i === items.length - 1 || ((cuts >> i) & 1) === 1;
    if (!end) continue;
    const part = items.slice(start, i + 1);
    blocks.push({ term: blockTerm(part), items: part });
    start = i + 1;
  }
  const term = compound("∘", blocks.map((block) => block.term));
  const priority = Math.max(...items.map((item) => item.priority));
  return { term, blocks, priority };
}

/** 生成所有划分，只保留优先级最高的 capacity 个；同一划分只留一次。 */
export function partitionSequence(items: PartitionItem[], capacity = 8): Partition[] {
  if (items.length === 0) return [];
  if (items.length === 1) return [build(0, items)];
  const cuts = 1 << (items.length - 1);
  const all: Partition[] = [];
  const seen = new Set<string>();
  for (let mask = 0; mask < cuts; mask++) {
    const part = build(mask, items);
    if (seen.has(part.term.key)) continue;
    seen.add(part.term.key);
    all.push(part);
  }
  all.sort((a, b) => b.priority - a.priority);
  return all.slice(0, Math.max(1, capacity));
}
