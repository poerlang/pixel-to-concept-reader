// 实际 Shift 的 NAL 比较：同一条链内，相邻 Shift 通过共同方向/步长性质比较。
// 只产出诊断计数，不决定类别。
import { RULES, applyRule } from "../nars/rules.ts";
import { judgment, tick } from "../nars/sentence.ts";
import { atom, inheritance, property } from "../nars/term.ts";
import type { ShiftArc } from "./structure.ts";

const DIRECTIONS = ["E", "NE", "N", "NW", "W", "SW", "S", "SE"];

export type ShiftComparison = {
  pairs: number;
  direction: number;
  step: number;
};

export function compareShifts(shifts: ShiftArc[]): ShiftComparison {
  const com = RULES.find((rule) => rule.id === "com")!;
  const sentence = (term: ReturnType<typeof inheritance>) => judgment(term, { f: 1, c: 1 }, [tick()], 0.6);
  const terms = shifts.map((shift, index) => {
    const angle = Math.atan2(shift.by - shift.ay, shift.bx - shift.ax);
    const dir = DIRECTIONS[Math.round(((angle + Math.PI * 2) % (Math.PI * 2)) / (Math.PI / 4)) % 8]!;
    return { index, chain: shift.chain, dir, length: Math.hypot(shift.bx - shift.ax, shift.by - shift.ay), term: atom(`shift_${index}`) };
  });
  const mean = terms.reduce((sum, shift) => sum + shift.length, 0) / Math.max(1, terms.length);
  const stepOf = (shift: typeof terms[number]) => shift.length >= mean ? property("step_2") : property("step_1");

  const groups = new Map<number, typeof terms>();
  for (const shift of terms) {
    if (!groups.has(shift.chain)) groups.set(shift.chain, []);
    groups.get(shift.chain)!.push(shift);
  }

  let pairs = 0;
  let direction = 0;
  let step = 0;
  for (const group of groups.values()) {
    for (let i = 1; i < group.length; i++) {
      const a = group[i - 1]!;
      const b = group[i]!;
      pairs++;
      if (applyRule(com,
        sentence(inheritance(a.term, property(`dir_${a.dir}`))),
        sentence(inheritance(b.term, property(`dir_${b.dir}`))))) direction++;
      if (applyRule(com,
        sentence(inheritance(a.term, stepOf(a))),
        sentence(inheritance(b.term, stepOf(b))))) step++;
    }
  }
  return { pairs, direction, step };
}
