// 环候选/弱边：只做候选假设，不决定类别；真正的取舍由 hypothesis/记忆竞争。
import type { Disc } from "./discs.ts";

export function findCycles(discs: Disc[], factor = 1.2): number[][] {
  const adj = discs.map(() => [] as number[]);
  for (let i = 0; i < discs.length; i++) for (let j = i + 1; j < discs.length; j++) {
    const a = discs[i]!;
    const b = discs[j]!;
    if (Math.hypot(a.cx - b.cx, a.cy - b.cy) <= (a.r + b.r) * factor) {
      adj[i]!.push(j);
      adj[j]!.push(i);
    }
  }
  const found = new Map<string, number[]>();
  for (let start = 0; start < discs.length; start++) {
    const walk = (at: number, path: number[], used: Set<number>): void => {
      if (path.length > 24 || found.size > 40) return;
      for (const next of adj[at]!) {
        if (next === start && path.length >= 4) {
          const key = [...path].sort((a, b) => a - b).join(",");
          if (!found.has(key)) found.set(key, [...path]);
          continue;
        }
        if (used.has(next)) continue;
        used.add(next);
        path.push(next);
        walk(next, path, used);
        path.pop();
        used.delete(next);
      }
    };
    walk(start, [start], new Set([start]));
  }
  return [...found.values()];
}

export function weakEdgeCount(discs: Disc[], cycle: number[]): number {
  let weak = 0;
  for (let at = 0; at < cycle.length; at++) {
    const a = discs[cycle[at]!]!;
    const b = discs[cycle[(at + 1) % cycle.length]!]!;
    if (Math.hypot(a.cx - b.cx, a.cy - b.cy) > (a.r + b.r) * 1.06) weak++;
  }
  return weak;
}

export function blankCenter(discs: Disc[], cycle: number[]): boolean {
  const cx = cycle.reduce((sum, at) => sum + discs[at]!.cx, 0) / cycle.length;
  const cy = cycle.reduce((sum, at) => sum + discs[at]!.cy, 0) / cycle.length;
  return cycle.every((at) => Math.hypot(discs[at]!.cx - cx, discs[at]!.cy - cy) >= discs[at]!.r);
}

export type RingEvidence = { support: number; weak: number; size: number };

/** 最好的中心空白环；support = 1 − 弱边数/环长。没有环返回 null。 */
export function ringEvidence(discs: Disc[]): RingEvidence | null {
  const cycles = findCycles(discs).filter((cycle) => blankCenter(discs, cycle));
  let best: RingEvidence | null = null;
  for (const cycle of cycles) {
    const weak = weakEdgeCount(discs, cycle);
    const support = 1 - weak / cycle.length;
    if (!best || support > best.support) best = { support, weak, size: cycle.length };
  }
  return best;
}
