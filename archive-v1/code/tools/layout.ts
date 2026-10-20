// 布局诊断：同一图形平移后，相对布局词项是否保持；不接分类。
import { structureOf } from "../src/perception/structure.ts";

const GRID = 16;
function nine(shiftX = 0, shiftY = 0): number[] {
  const grid = new Array<number>(GRID * GRID).fill(0);
  const set = (x: number, y: number): void => {
    const i = x + shiftX;
    const j = y + shiftY;
    if (i >= 0 && j >= 0 && i < GRID && j < GRID) grid[j * GRID + i] = 1;
  };
  for (let y = 0; y < GRID; y++) for (let x = 0; x < GRID; x++) {
    const d = Math.hypot(x + 0.5 - 8, y + 0.5 - 5);
    if (d >= 2.6 && d <= 3.8) set(x, y);
  }
  for (let y = 8; y <= 13; y++) set(10, y);
  return grid;
}

const isLayout = (term: string): boolean =>
  term.startsWith("lzone_") || term.startsWith("lrel_") || term.startsWith("ldist_") ||
  term.startsWith("lratio_") || term.startsWith("lzsize_") || term.startsWith("lzfill_") ||
  term.startsWith("loop_size_") || term.startsWith("loop_fill_") || term.startsWith("loverlap_");

const base = new Set([...structureOf(nine()).terms.keys()].filter(isLayout));
for (const [dx, dy] of [[0, 0], [1, 0], [0, 1], [1, 1], [2, 2]] as Array<[number, number]>) {
  const moved = new Set([...structureOf(nine(dx, dy)).terms.keys()].filter(isLayout));
  const intersection = [...base].filter((term) => moved.has(term)).length;
  const union = new Set([...base, ...moved]).size;
  console.log(`平移 (${dx},${dy})：布局词项 ${moved.size}，与基准重合 ${intersection}/${union} = ${(intersection / Math.max(1, union) * 100).toFixed(1)}%`);
}
