// 结构层：loop Gray / Shift / 恒常 / 闭合 + loop 布局词项。
//
// L0/L1 的像素和小特征不在这里沉淀：它们只进通道；这里输出的是**结构词项**。
// 词项 是相对量（大小、填充、shift diff 方向、步长比、4×4 物体框里的相对位置），不含绝对像素坐标。
// 只允许 NAL 推理；没有分类器/统计读出。记忆是 `digit_d → [词项]` 的信念。

import { growDiscs, type Disc } from "./discs.ts";
import { intersection, property } from "../nars/term.ts";

export const STRUCTURE_LAYERS = ["loop Gray", "Shift", "恒常 / 闭合", "loop 布局", "圈 ∩ 空 / 区域"] as const;

export type ShiftArc = { ax: number; ay: number; bx: number; by: number; chain: number };

export type CompoundUse = { key: string; count: number };

export type StructureAlternative = { name: string; terms: string[] };

export type Structure = {
  terms: Map<string, number>;
  compounds: CompoundUse[];
  alternatives: StructureAlternative[];
  loops: Disc[];
  shifts: ShiftArc[];
  chains: number;
};

type Shift = { a: Disc; b: Disc; d: { x: number; y: number }; len: number };

const bucket = (value: number, cuts: number[]): number => {
  for (let i = 0; i < cuts.length; i++) if (value <= cuts[i]!) return i;
  return cuts.length;
};
const shiftDiffBucket = (angle: number): "s" | "l" | "r" => (Math.abs(angle) < 0.35 ? "s" : angle > 0 ? "l" : "r");
const stepBucket = (ratio: number): number => (ratio < 0.75 ? 0 : ratio > 1.33 ? 2 : 1);
/** 链的“够得着”系数：两颗盘半径和 × 它；通道参数，可实验 */
const REACH_FACTOR = 1.06;
/** 一个 loop 最多被几条链扫到（交叉点允许二次划线） */
const VISIT_CAP = 2;

function chainsOf(loops: Disc[]): { chain: Disc[]; shifts: Shift[] }[] {
  const visits = new Map<number, number>();
  const out: { chain: Disc[]; shifts: Shift[] }[] = [];
  const canVisit = (a: number): boolean => (visits.get(a) ?? 0) < VISIT_CAP;
  for (let start = 0; start < loops.length; start++) {
    if (!canVisit(start)) continue;
    const chain: Disc[] = [loops[start]!];
    const shifts: Shift[] = [];
    const inChain = new Set<number>([start]);
    visits.set(start, (visits.get(start) ?? 0) + 1);
    let current = loops[start]!;
    for (let guard = 0; guard < loops.length; guard++) {
      const previous = chain[chain.length - 2];
      const heading = previous ? { x: current.cx - previous.cx, y: current.cy - previous.cy } : null;
      let best = -1;
      let bestScore = Infinity;
      for (let i = 0; i < loops.length; i++) {
        if (inChain.has(i) || !canVisit(i)) continue;
        const candidate = loops[i]!;
        const dx = candidate.cx - current.cx;
        const dy = candidate.cy - current.cy;
        const distance = Math.hypot(dx, dy);
        const reach = (current.r + candidate.r) * REACH_FACTOR;
        if (distance > reach || distance < 1e-6) continue;
        let score = distance * 1e-3;
        if (heading) {
          const length = Math.hypot(heading.x, heading.y);
          const cosine = (heading.x * dx + heading.y * dy) / Math.max(1e-9, length * distance);
          score += Math.acos(Math.max(-1, Math.min(1, cosine))) / Math.PI
            + Math.abs(distance - length) / Math.max(distance, length);
        }
        if (score < bestScore - 1e-9) {
          bestScore = score;
          best = i;
        }
      }
      if (best < 0) break;
      const next = loops[best]!;
      const d = { x: next.cx - current.cx, y: next.cy - current.cy };
      shifts.push({ a: current, b: next, d, len: Math.hypot(d.x, d.y) });
      chain.push(next);
      inChain.add(best);
      visits.set(best, (visits.get(best) ?? 0) + 1);
      current = next;
    }
    out.push({ chain, shifts });
  }
  return out;
}
/** 一帧 → 结构词项（记忆的唯一来源）。 */
export function structureOf(grid: number[]): Structure {
  const loops = growDiscs(grid);
  const terms = new Map<string, number>();
  const compoundCounts = new Map<string, number>();
  const add = (key: string, value = 1): void => { terms.set(key, (terms.get(key) ?? 0) + value); };
  const shiftArcs: ShiftArc[] = [];

  add(`loops_${Math.min(8, loops.length)}`, 1);
  for (const loop of loops) {
    add(`loop_size_${bucket(loop.cells, [2, 4, 8, 16])}`, 1);
    add(`loop_fill_${bucket(loop.fill, [0.4, 0.6, 0.8])}`, 1);
  }

  // loop 的部件级相对布局：物体框 4×4（不是像素位置）
  let minX = grid.length + 1, minY = grid.length + 1, maxX = -1, maxY = -1;
  for (let j = 0; j < 16; j++) for (let i = 0; i < 16; i++) {
    if (grid[j * 16 + i]! <= 0.3) continue;
    minX = Math.min(minX, i); maxX = Math.max(maxX, i);
    minY = Math.min(minY, j); maxY = Math.max(maxY, j);
  }
  if (maxX >= 0) {
    for (const loop of loops) {
      const zx = Math.min(3, Math.max(0, Math.floor(((loop.cx - minX) / Math.max(1, maxX - minX + 1)) * 4)));
      const zy = Math.min(3, Math.max(0, Math.floor(((loop.cy - minY) / Math.max(1, maxY - minY + 1)) * 4)));
      add(`lzone_${zx}_${zy}`, 1);
      add(`lzsize_${zx}_${zy}_${bucket(loop.cells, [2, 4, 8])}`, 1);
      add(`lzfill_${zx}_${zy}_${bucket(loop.fill, [0.5, 0.75])}`, 1);
    }
  }

  // loop 两两关系（相对方向/距离/大小比/重叠）
  for (let a = 0; a < loops.length; a++) for (let b = a + 1; b < loops.length; b++) {
    const first = loops[a]!;
    const second = loops[b]!;
    const dx = second.cx - first.cx;
    const dy = second.cy - first.cy;
    const distance = Math.hypot(dx, dy);
    if (distance > 12) continue;
    const direction = Math.abs(dx) >= Math.abs(dy) ? (dx >= 0 ? "right" : "left") : (dy >= 0 ? "below" : "above");
    add(`lrel_${direction}`, 1);
    add(`ldist_${bucket(distance / Math.max(0.3, (first.r + second.r) / 2), [1, 2, 4, 7])}`, 1);
    const ratio = first.cells / Math.max(1, second.cells);
    add(`lratio_${ratio > 1.5 ? "big" : ratio < 0.67 ? "small" : "same"}`, 1);
    add(`loverlap_${distance < (first.r + second.r) * 0.6 ? "yes" : "no"}`, 1);
  }

  const chains = chainsOf(loops);
  add(`chains_${Math.min(4, chains.length)}`, 1);
  let shiftTotal = 0;
  for (const { shifts } of chains) shiftTotal += shifts.length;
  add(`shifts_${Math.min(8, shiftTotal)}`, 1);

  let closures = 0;
  let bigDiffs = 0;
  for (let chainIndex = 0; chainIndex < chains.length; chainIndex++) {
    const { chain, shifts } = chains[chainIndex]!;
    add(`chain_len_${Math.min(5, chain.length)}`, 1);
    let chainLow = false;
    let chainHigh = false;
    if (shifts.length >= 1) {
      add(`shift_start_${stepBucket(1)}`, 1);
      // 按每个 loop 自己的感受野半径做尺度平滑：远看线是线，近看锯齿在半径内被平均掉
      const smoothed = chain.map((point, at) => {
        let x = 0, y = 0, wsum = 0;
        const sigma = Math.max(0.5, point.r);
        for (let j = Math.max(0, at - 2); j <= Math.min(chain.length - 1, at + 2); j++) {
          const other = chain[j]!;
          const weight = Math.exp(-((j - at) ** 2) / (2 * sigma * sigma));
          x += other.cx * weight; y += other.cy * weight; wsum += weight;
        }
        return { x: x / Math.max(1e-9, wsum), y: y / Math.max(1e-9, wsum) };
      });
      let path = 0;
      let shiftDiffAccum = 0;
      for (let i = 0; i < shifts.length; i++) {
        path += shifts[i]!.len;
        if (i === 0) continue;
        const previous = shifts[i - 1]!;
        const current = shifts[i]!;
        const before = { x: smoothed[i]!.x - smoothed[i - 1]!.x, y: smoothed[i]!.y - smoothed[i - 1]!.y };
        const after = { x: smoothed[i + 1]!.x - smoothed[i]!.x, y: smoothed[i + 1]!.y - smoothed[i]!.y };
        const cross = before.x * after.y - before.y * after.x;
        const dot = before.x * after.x + before.y * after.y;
        const shiftDiffAngle = Math.atan2(cross, dot);
        const rawCross = previous.d.x * current.d.y - previous.d.y * current.d.x;
        const rawDot = previous.d.x * current.d.x + previous.d.y * current.d.y;
        shiftDiffAccum += Math.atan2(rawCross, rawDot);
        const beforeLen = Math.hypot(before.x, before.y);
        const afterLen = Math.hypot(after.x, after.y);
        const ratio = afterLen / Math.max(1e-9, beforeLen);
        const diffDirection = shiftDiffBucket(shiftDiffAngle);
        // Shift 差：这一步相对上一步的方向/步长差；按相对感受野面积分成大/小两个集合
        const area = (previous.a.cells + previous.b.cells + current.a.cells + current.b.cells) / 4;
        const meanLoop = loops.reduce((sum, loop) => sum + loop.cells, 0) / Math.max(1, loops.length);
        const large = area / Math.max(1, meanLoop) >= 1;
        add(`${large ? "big" : "small"}_shift_diff_${diffDirection}_${stepBucket(ratio)}`, 1);
        if (large) bigDiffs++;
        const band = Math.abs(shiftDiffAngle) > 0.5 ? "high" : "low";
        const smooth = 1 - Math.abs(shiftDiffAngle) / Math.PI;
        const sizeMatch = 1 - Math.abs(afterLen - beforeLen) / Math.max(afterLen, beforeLen);
        if (smooth * 0.6 + sizeMatch * 0.4 > 0.55) {
          add(`const_${band}`, 1);
          if (band === "low") chainLow = true; else chainHigh = true;
        }
      }
      const quarters = Math.min(8, Math.round(Math.abs(shiftDiffAccum) / (Math.PI / 2)));
      if (quarters > 0) {
        const meanRadius = loops.reduce((sum, loop) => sum + loop.r, 0) / Math.max(1, loops.length);
        const span = path / Math.max(0.1, meanRadius);
        const ringKey = `shift_diff_accum_${shiftDiffAccum > 0 ? "l" : "r"}_${quarters}_span_${bucket(span, [2, 4, 8, 16])}`;
        add(ringKey, 1);
        // 圈∩空：链的几何中心没有被任何 loop 感受野盖住；只取中心点，不做洞检测
        const cx = chain.reduce((sum, loop) => sum + loop.cx, 0) / Math.max(1, chain.length);
        const cy = chain.reduce((sum, loop) => sum + loop.cy, 0) / Math.max(1, chain.length);
        const centerBlank = chain.every((loop) => Math.hypot(loop.cx - cx, loop.cy - cy) >= loop.r);
        if (quarters >= 3 && centerBlank) {
          const parts = [ringKey];
          if (chainLow) parts.push("const_low");
          if (chainHigh) parts.push("const_high");
          parts.push("center_blank");
          const key = intersection(parts.map((name) => property(name))).key;
          compoundCounts.set(key, (compoundCounts.get(key) ?? 0) + 1);
        }
      }
      const head = chain[0]!;
      const tail = chain[chain.length - 1]!;
      const gap = Math.hypot(tail.cx - head.cx, tail.cy - head.cy);
      add(`eff_${bucket(path / Math.max(1e-9, gap), [0.7, 1.3, 2.2])}`, 1);
      add(`step_rel_${bucket(path / Math.max(1e-9, shifts.length) / Math.max(0.1, (head.r + tail.r) / 2), [0.5, 1, 1.8])}`, 1);
      if (gap <= (head.r + tail.r) * 0.85) {
        add("closure", 1);
        closures++;
      }
      for (const shift of shifts) shiftArcs.push({ ax: shift.a.cx, ay: shift.a.cy, bx: shift.b.cx, by: shift.b.cy, chain: chainIndex });
    }
  }
  if (closures > 0) add("closures_n", closures);
  if (bigDiffs > 0) {
    add("big_shift_diff_set", 1);
    add(`big_shift_diff_n_${Math.min(8, bigDiffs)}`, 1);
  }

  const allKeys = [...terms.keys(), ...compoundCounts.keys()];
  const alternatives: StructureAlternative[] = [
    { name: "全部", terms: allKeys },
    { name: "结构", terms: allKeys.filter((key) => /shift|closure|chain|accum/.test(key)) },
    { name: "布局", terms: allKeys.filter((key) => key.startsWith("l")) },
    { name: "去 accum", terms: allKeys.filter((key) => !key.startsWith("shift_diff_accum")) },
  ];
  return { terms, compounds: [...compoundCounts.entries()].map(([key, count]) => ({ key, count })), alternatives, loops, shifts: shiftArcs, chains: chains.length };
}

/** 报告里的层：0 loop、1 Shift、2 恒常/闭合、3 loop 布局、4 圈∩空 */
export function termLayer(name: string): number {
  if (name.startsWith("shift_diff_accum") || name.startsWith("big_shift_diff") || name.startsWith("small_shift_diff")
    || name.startsWith("eff_") || name.startsWith("step_rel_")) return 1;
  if (name.startsWith("const_") || name.startsWith("closure") || name === "closures_n") return 2;
  if (name.startsWith("lzone_") || name.startsWith("lzsize_") || name.startsWith("lzfill_")
    || name.startsWith("lrel_") || name.startsWith("ldist_") || name.startsWith("lratio_")
    || name.startsWith("loverlap_")) return 3;
  return 0;
}
