// 链级划分报告：多个划分假设 + 每块首尾闭合数；只做证据，不决定类别。
import { selectTop } from "../nars/attention.ts";
import { partitionSequence } from "../nars/partition.ts";
import { atom } from "../nars/term.ts";
import type { Structure } from "./structure.ts";

export type ChainPartition = { label: string; closed: number; blocks: number[][] };

export function chainPartitions(structure: Structure): ChainPartition[] {
  const groups = new Map<number, typeof structure.shifts>();
  for (const shift of structure.shifts) {
    if (!groups.has(shift.chain)) groups.set(shift.chain, []);
    groups.get(shift.chain)!.push(shift);
  }
  if (groups.size < 2) return [];
  const items = [...groups.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([id, shifts]) => ({ term: atom(`chain_${id}`), priority: shifts.length / Math.max(1, structure.shifts.length) }));
  const partitions = partitionSequence(items, 8).map((part) => {
    let closed = 0;
    const labels: string[] = [];
    const blocks: number[][] = [];
    for (const block of part.blocks) {
      const ids = block.items.map((item) => Number(item.term.key.replace("chain_", "")));
      const first = groups.get(ids[0]!)?.[0];
      const lastShifts = groups.get(ids[ids.length - 1]!);
      const last = lastShifts?.[lastShifts.length - 1];
      if (first && last) {
        const gap = Math.hypot(last.bx - first.ax, last.by - first.ay);
        const all = ids.flatMap((id) => groups.get(id) ?? []);
        const step = all.reduce((sum, shift) => sum + Math.hypot(shift.bx - shift.ax, shift.by - shift.ay), 0) / Math.max(1, all.length);
        if (gap <= step * 1.06) closed++;
      }
      labels.push(ids.map((id) => `#${id}`).join("+"));
      blocks.push(ids);
    }
    return { label: labels.join(" | "), closed, blocks };
  });
  return selectTop(partitions, (part) => part.closed, 3);
}

export function maxClosed(partitions: ChainPartition[]): number {
  return partitions.reduce((best, part) => Math.max(best, part.closed), 0);
}
