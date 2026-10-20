// 经典图 curriculum 诊断：哪些词项稳定、哪些只属于一个图形；不接分类。
import { mkdirSync, writeFileSync } from "node:fs";
import { preferredTerms, uniqueTerms, type CurriculumFigure } from "../src/nars/curriculum.ts";
import { structureOf } from "../src/perception/structure.ts";

const GRID = 16;
function make(draw: (set: (x: number, y: number) => void) => void): number[] {
  const grid = new Array<number>(GRID * GRID).fill(0);
  draw((x, y) => { if (x >= 0 && y >= 0 && x < GRID && y < GRID) grid[y * GRID + x] = 1; });
  return grid;
}
function ring(cx: number, cy: number, r: number): number[] {
  return make((set) => {
    for (let y = 0; y < GRID; y++) for (let x = 0; x < GRID; x++) {
      const d = Math.hypot(x + 0.5 - cx, y + 0.5 - cy);
      if (d >= r - 0.6 && d <= r + 0.6) set(x, y);
    }
  });
}

const shapes = [
  { name: "纯圆", grid: ring(8, 8, 4.8) },
  { name: "直线", grid: make((set) => { for (let y = 3; y <= 12; y++) set(8, y); }) },
  { name: "角", grid: make((set) => { for (let y = 3; y <= 12; y++) set(5, y); for (let x = 5; x <= 12; x++) set(x, 12); }) },
  { name: "S", grid: make((set) => { for (let x = 4; x <= 12; x++) { const y = 8 + 4 * Math.sin((x - 4) / 8 * Math.PI * 2); set(x, y); set(x, y + 1); } }) },
  { name: "8", grid: (() => { const g = ring(8, 5, 3); const b = ring(8, 11, 3); return g.map((v, i) => Math.max(v, b[i]!)); })() },
  { name: "9", grid: (() => { const g = ring(8, 5, 3.2); for (let y = 8; y <= 13; y++) g[y * 16 + 10] = 1; return g; })() },
];

const figures: CurriculumFigure[] = shapes.map((shape) => ({ name: shape.name, terms: [...structureOf(shape.grid).terms.keys()] }));
const stable = preferredTerms(figures, 5 / 6);
const unique = Object.fromEntries(uniqueTerms(figures));
mkdirSync("docs", { recursive: true });
writeFileSync("docs/curriculum.json", JSON.stringify({ stable, unique }, null, 2));
console.log("稳定词项（≥5/6 图）：");
console.log("  " + stable.join("  "));
console.log("独有词项：");
for (const [name, terms] of Object.entries(unique)) console.log(`  ${name}: ${terms.join("  ")}`);
