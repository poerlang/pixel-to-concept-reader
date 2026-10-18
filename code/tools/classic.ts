// 经典图形 → 结构词项：只用于观察，不参与训练/分类。
import { partitionSequence } from "../src/nars/partition.ts";
import { atom } from "../src/nars/term.ts";
import { structureOf } from "../src/perception/structure.ts";

const GRID = 16;

function make(draw: (set: (x: number, y: number, v?: number) => void) => void): number[] {
  const grid = new Array<number>(GRID * GRID).fill(0);
  const set = (x: number, y: number, v = 1): void => {
    if (x < 0 || y < 0 || x >= GRID || y >= GRID) return;
    const i = Math.round(x);
    const j = Math.round(y);
    if (i < 0 || j < 0 || i >= GRID || j >= GRID) return;
    grid[j * GRID + i] = Math.max(grid[j * GRID + i]!, v);
  };
  draw(set);
  return grid;
}

const shapes: Array<{ name: string; grid: number[] }> = [
  { name: "纯圆", grid: make((set) => {
    for (let y = 0; y < GRID; y++) for (let x = 0; x < GRID; x++) {
      const d = Math.hypot(x + 0.5 - 8, y + 0.5 - 8);
      if (d >= 4.2 && d <= 5.4) set(x, y);
    }
  }) },
  { name: "直线", grid: make((set) => {
    for (let y = 3; y <= 12; y++) set(8, y);
  }) },
  { name: "折线/角", grid: make((set) => {
    for (let y = 3; y <= 12; y++) set(5, y);
    for (let x = 5; x <= 12; x++) set(x, 12);
  }) },
  { name: "S 弯曲", grid: make((set) => {
    for (let x = 4; x <= 12; x++) {
      const y = 8 + 4 * Math.sin((x - 4) / 8 * Math.PI * 2);
      set(x, y); set(x, y + 1);
    }
  }) },
  { name: "8（双圈）", grid: make((set) => {
    for (const cy of [5, 11]) for (let y = 0; y < GRID; y++) for (let x = 0; x < GRID; x++) {
      const d = Math.hypot(x + 0.5 - 8, y + 0.5 - cy);
      if (d >= 2.4 && d <= 3.6) set(x, y);
    }
  }) },
  { name: "9（圈+尾）", grid: make((set) => {
    for (let y = 0; y < GRID; y++) for (let x = 0; x < GRID; x++) {
      const d = Math.hypot(x + 0.5 - 8, y + 0.5 - 5);
      if (d >= 2.6 && d <= 3.8) set(x, y);
    }
    for (let y = 8; y <= 13; y++) set(10, y);
  }) },
];

for (const shape of shapes) {
  const structure = structureOf(shape.grid);
  const entries = [...structure.terms.entries()].sort((a, b) => b[1] - a[1]);
  const keys = entries.map(([term]) => term);
  const interesting = keys.filter((term) =>
    term.startsWith("closure") || term.startsWith("shift_diff_accum") ||
    term.startsWith("big_shift_diff") || term.startsWith("const") ||
    term.startsWith("loops_") || term.startsWith("chains_"));
  console.log(`\n${shape.name}: loops=${structure.loops.length} shifts=${structure.shifts.length} chains=${structure.chains}`);
  console.log("  " + interesting.join("  "));
  console.log("  compounds: " + structure.compounds.map((compoundUse) => compoundUse.key + "x" + compoundUse.count).join("  "));
  const byChain = new Map<number, typeof structure.shifts>();
  for (const shift of structure.shifts) {
    if (!byChain.has(shift.chain)) byChain.set(shift.chain, []);
    byChain.get(shift.chain)!.push(shift);
  }
  for (const [id, shifts] of byChain) {
    const first = shifts[0]!; const last = shifts[shifts.length - 1]!;
    console.log(`    chain #${id}: ${shifts.length} steps (${first.ax.toFixed(1)},${first.ay.toFixed(1)}) -> (${last.bx.toFixed(1)},${last.by.toFixed(1)})`);
  }  const groups = [...byChain.entries()].sort((a, b) => a[0] - b[0]);
  const items = groups.map(([id, shifts]) => ({ term: atom(`chain_${id}`), priority: shifts.length / Math.max(1, structure.shifts.length) }));
  const partitions = partitionSequence(items, 4);
  for (const part of partitions) {
    let closed = 0;
    const labels: string[] = [];
    for (const block of part.blocks) {
      const ids = block.items.map((item) => Number(item.term.key.replace("chain_", "")));
      const first = byChain.get(ids[0]!)?.[0];
      const lastShifts = byChain.get(ids[ids.length - 1]!);
      const last = lastShifts?.[lastShifts.length - 1];
      if (!first || !last) continue;
      const gap = Math.hypot(last.bx - first.ax, last.by - first.ay);
      const all = ids.flatMap((id) => byChain.get(id) ?? []);
      const step = all.reduce((sum, shift) => sum + Math.hypot(shift.bx - shift.ax, shift.by - shift.ay), 0) / Math.max(1, all.length);
      if (gap <= step * 1.06) closed++;
      labels.push(ids.map((id) => `#${id}`).join("+"));
    }
    console.log(`    partition: ${labels.join(" | ")}  closed=${closed}`);
  }

}
