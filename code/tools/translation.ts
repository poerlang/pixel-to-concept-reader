// 平移诊断：同一批 MNIST 平移后，哪一类结构词项变了；不接分类。
import { gridOf, indicesOf, loadMnist } from "../src/mnist.ts";
import { structureOf } from "../src/perception/structure.ts";

const GRID = 16;
const mnist = loadMnist();

function translate(grid: number[], dx: number, dy: number): number[] {
  const out = new Array<number>(GRID * GRID).fill(0);
  for (let y = 0; y < GRID; y++) for (let x = 0; x < GRID; x++) {
    const nx = x + dx, ny = y + dy;
    if (nx >= 0 && ny >= 0 && nx < GRID && ny < GRID) out[ny * GRID + nx] = grid[y * GRID + x]!;
  }
  return out;
}

function category(term: string): string {
  if (term.startsWith("shift_diff_accum")) return "accum";
  if (term.startsWith("closure") || term.startsWith("closures_")) return "closure";
  if (term.startsWith("loop") || term.startsWith("loops_") || term.startsWith("chain")) return "loop";
  if (term.startsWith("l")) return "layout";
  if (term.startsWith("const_")) return "const";
  if (term.startsWith("shift") || term.startsWith("big_shift") || term.startsWith("small_shift")) return "shift";
  return "other";
}

const sums = new Map<string, { inter: number; union: number; original: number; moved: number; samples: number }>();
const coarse = (term: string): string => term.replace(/^(shift_diff_accum_[lr])_\d+_span_\d+$/, "$1");
const coarseSums = { inter: 0, union: 0, original: 0, moved: 0 };
for (let digit = 0; digit <= 9; digit++) {
  for (const index of indicesOf(mnist, digit, 200, 10)) {
    const original = structureOf(gridOf(mnist, index, GRID));
    const moved = structureOf(translate(gridOf(mnist, index, GRID), 1, 1));
    const groups = new Map<string, { a: Set<string>; b: Set<string> }>();
    const coarseA = new Set<string>();
    const coarseB = new Set<string>();
    for (const term of original.terms.keys()) {
      const key = category(term);
      if (!groups.has(key)) groups.set(key, { a: new Set(), b: new Set() });
      groups.get(key)!.a.add(term);
      if (key === "accum") coarseA.add(coarse(term));
    }
    for (const term of moved.terms.keys()) {
      const key = category(term);
      if (!groups.has(key)) groups.set(key, { a: new Set(), b: new Set() });
      groups.get(key)!.b.add(term);
      if (key === "accum") coarseB.add(coarse(term));
    }
    coarseSums.inter += [...coarseA].filter((term) => coarseB.has(term)).length;
    coarseSums.union += new Set([...coarseA, ...coarseB]).size;
    coarseSums.original += coarseA.size;
    coarseSums.moved += coarseB.size;
    for (const [key, group] of groups) {
      const row = sums.get(key) ?? { inter: 0, union: 0, original: 0, moved: 0, samples: 0 };
      row.inter += [...group.a].filter((term) => group.b.has(term)).length;
      row.union += new Set([...group.a, ...group.b]).size;
      row.original += group.a.size;
      row.moved += group.b.size;
      row.samples++;
      sums.set(key, row);
    }
  }
}

console.log(`accum_coarse: Jaccard=${(coarseSums.inter / Math.max(1, coarseSums.union) * 100).toFixed(1)}%  原=${coarseSums.original} 平移=${coarseSums.moved}`);
for (const [key, row] of [...sums].sort()) {
  console.log(`${key}: Jaccard=${(row.inter / Math.max(1, row.union) * 100).toFixed(1)}%  原=${row.original} 平移=${row.moved}`);
}
