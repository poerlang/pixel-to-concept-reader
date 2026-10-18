// 圆生长：pdftest5 的 discGrowth 迁移版，只作**候选生成器**（agents.md §3.1）。
//
// 它只产出 loop 候选（圆心/半径/覆盖格/填充），不决定类别、不写记忆；
// 谁像谁由结构词项 + 读出决定。参数是通道参数，不是语义。

export type Disc = { cx: number; cy: number; r: number; cells: number; fill: number };

export const GRID = 16;
/** 通道参数：低于它的格不算"活跃"（书A ch13-0057 的强度阈值一类） */
export const ACTIVE = 0.3;
const TOLERANCE = 0.1;
const STEP = 0.2;
const MIN_RADIUS = 0.6;
const MAX_RADIUS = 8;

/** 从 16×16 读数长出 loop 候选。只返回候选，不判断类别。 */
export function growDiscs(grid: number[]): Disc[] {
  const active = (i: number, j: number): boolean =>
    i >= 0 && j >= 0 && i < GRID && j < GRID && grid[j * GRID + i]! > ACTIVE;
  const inside = (ci: number, cj: number, r: number): number[] => {
    const out: number[] = [];
    const loI = Math.max(0, Math.floor(ci - r - 0.5));
    const hiI = Math.min(GRID - 1, Math.ceil(ci + r + 0.5));
    const loJ = Math.max(0, Math.floor(cj - r - 0.5));
    const hiJ = Math.min(GRID - 1, Math.ceil(cj + r + 0.5));
    for (let j = loJ; j <= hiJ; j++) for (let i = loI; i <= hiI; i++) {
      if (Math.hypot(i + 0.5 - ci, j + 0.5 - cj) <= r) out.push(j * GRID + i);
    }
    return out;
  };
  const measure = (ci: number, cj: number, r: number): { cells: number[]; ratio: number; area: number } => {
    const cells = inside(ci, cj, r);
    let hit = 0;
    for (const cell of cells) if (active(cell % GRID, Math.floor(cell / GRID))) hit++;
    return { cells, ratio: cells.length ? 1 - hit / cells.length : 1, area: cells.length };
  };

  const seeds: Array<[number, number]> = [];
  for (let j = 0; j < GRID; j++) for (let i = 0; i < GRID; i++) if (active(i, j)) seeds.push([i, j]);
  const covered = new Set<number>();
  const discs: Disc[] = [];
  const offsets: Array<[number, number]> = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]];

  for (const [si, sj] of seeds) {
    if (covered.has(sj * GRID + si)) continue;
    let ci = si + 0.5;
    let cj = sj + 0.5;
    let r = MIN_RADIUS;
    let best = measure(ci, cj, r);
    if (best.ratio > TOLERANCE) { covered.add(sj * GRID + si); continue; }
    for (let guard = 0; guard < 80; guard++) {
      let chosen: { ci: number; cj: number; r: number; ratio: number } | null = null;
      const consider = (ni: number, nj: number, nr: number): void => {
        if (nr > MAX_RADIUS) return;
        if (Math.hypot(si + 0.5 - ni, sj + 0.5 - nj) > nr) return;
        const m = measure(ni, nj, nr);
        if (m.ratio > TOLERANCE) return;
        if (!chosen || m.ratio < chosen.ratio - 1e-9 || (Math.abs(m.ratio - chosen.ratio) < 1e-9 && nr > chosen.r)) {
          chosen = { ci: ni, cj: nj, r: nr, ratio: m.ratio };
        }
      };
      consider(ci, cj, r + STEP);
      for (const [di, dj] of offsets) {
        consider(ci + di * STEP, cj + dj * STEP, r + STEP);
        consider(ci + di * STEP, cj + dj * STEP, r);
      }
      const pick = chosen as { ci: number; cj: number; r: number; ratio: number } | null;
      if (!pick) break;
      if (!(pick.r > r + 1e-9) && !(pick.ratio < best.ratio - 0.01)) break;
      ci = pick.ci; cj = pick.cj; r = pick.r;
      best = measure(ci, cj, r);
    }
    let hit = 0;
    for (const cell of best.cells) if (active(cell % GRID, Math.floor(cell / GRID))) hit++;
    if (hit === 0) continue;
    discs.push({ cx: ci, cy: cj, r, cells: hit, fill: hit / Math.max(1, best.area) });
    for (const cell of best.cells) if (active(cell % GRID, Math.floor(cell / GRID))) covered.add(cell);
  }
  return discs;
}
