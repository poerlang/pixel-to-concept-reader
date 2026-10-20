// NAL-8 风格的 Shift：在图上换焦点，记录相对位置/相对矢量/二阶差。
//
// 这里不存局部像素块，也不存形状名；只把“从哪里跳到哪里”变成
//   shift_vec_dx_dy
//   shift_accel_ddx_ddy
// 曲率信号来自二阶位置差（d2 - d1），不是手写圆/线检测器。

export type Point = { x: number; y: number };
export type ThickPoint = Point & { mass: number };
export type ShiftStep = { from: Point; to: Point; dx: number; dy: number };
export type ShiftAccel = { dx: number; dy: number; mag: number };
export type ShiftEpisode = { points: Point[]; steps: ShiftStep[] };
export type ShiftTrace = {
  points: Point[];
  steps: ShiftStep[];
  episodes: ShiftEpisode[];
};

const key = (point: Point): string => `${point.x},${point.y}`;
const distance = (a: Point, b: Point): number => Math.hypot(b.x - a.x, b.y - a.y);

/**
 * 蔓延求同：先把局部有差异的格子作为场点，再在局部半径内聚成粗点。
 * 纯白/纯黑不是特判成空，而是因为没有“差异”，自然没有场点。
 * 90% 白 + 10% 黑也一样：只有交界处有场点，不会把整个白面当形状。
 */
export function spreadPoints(grid: number[], size = 16, radius = 1.75): ThickPoint[] {
  const boundary: Point[] = [];
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const here = grid[y * size + x] ? 1 : 0;
      let differs = false;
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
        const nx = x + dx;
        const ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= size || ny >= size) continue;
        if ((grid[ny * size + nx] ? 1 : 0) !== here) differs = true;
      }
      if (differs) boundary.push({ x: x + 0.5, y: y + 0.5 });
    }
  }

  const remaining = new Map<string, Point>();
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      if (!grid[y * size + x]) continue;
      const point = { x: x + 0.5, y: y + 0.5 };
      if (boundary.some((edge) => distance(point, edge) <= 1.5)) {
        remaining.set(`${x},${y}`, point);
      }
    }
  }

  // 均匀场没有边界，但整幅场仍是一个粗点；它不产生方向，不是空。
  if (boundary.length === 0) {
    return [{ x: size / 2, y: size / 2, mass: size * size }];
  }

  const out: ThickPoint[] = [];
  while (remaining.size > 0) {
    const seed = [...remaining.values()].sort((a, b) => a.y - b.y || a.x - b.x)[0]!;
    let mass = 0;
    let sx = 0;
    let sy = 0;
    for (const [key, point] of remaining) {
      if (distance(seed, point) > radius) continue;
      mass++;
      sx += point.x;
      sy += point.y;
      remaining.delete(key);
    }
    out.push({ x: sx / mass, y: sy / mass, mass });
  }
  return out;
}

const median = (values: number[]): number => {
  if (values.length === 0) return 1;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)]!;
};

/** 从一个粗点跳到最近的未访问粗点；距离突变/方向断裂时结束当前 episode。 */
export function tracePoints(points: Point[]): ShiftTrace {
  const remaining = new Map(points.map((point) => [key(point), point]));
  const episodes: ShiftEpisode[] = [];
  const allPoints: Point[] = [];
  const allSteps: ShiftStep[] = [];

  while (remaining.size > 0) {
    const start = [...remaining.values()].sort((a, b) => a.y - b.y || a.x - b.x)[0]!;
    const episode: ShiftEpisode = { points: [], steps: [] };
    let current = start;

    while (remaining.size > 0) {
      remaining.delete(key(current));
      episode.points.push(current);
      allPoints.push(current);

      const previous = episode.steps.at(-1);
      const medianStep = median(episode.steps.map((step) => Math.hypot(step.dx, step.dy)));
      const jumpLimit = Math.max(2.5, medianStep * 2.5);
      let next: Point | null = null;
      let best = Infinity;
      let bestDistance = Infinity;

      for (const candidate of remaining.values()) {
        const d = distance(current, candidate);
        if (previous && d > jumpLimit) continue;
        let score = d;
        if (previous) {
          const dx = candidate.x - current.x;
          const dy = candidate.y - current.y;
          if (previous.dx * dx + previous.dy * dy < 0) continue;
          const denom = Math.hypot(previous.dx, previous.dy) * Math.hypot(dx, dy);
          score += denom === 0 ? 1 : 0.35 * (1 - (previous.dx * dx + previous.dy * dy) / denom);
        }
        if (score < best || (score === best && next && (candidate.y < next.y || (candidate.y === next.y && candidate.x < next.x)))) {
          best = score;
          bestDistance = d;
          next = candidate;
        }
      }

      if (!next) break;
      if (previous && bestDistance > jumpLimit) break;
      const step = { from: current, to: next, dx: next.x - current.x, dy: next.y - current.y };
      episode.steps.push(step);
      allSteps.push(step);
      current = next;
    }

    if (episode.points.length > 0) episodes.push(episode);
  }

  return { points: allPoints, steps: allSteps, episodes };
}

/** 蔓延优先：先形成边界粗点，再 Shift；没有局部差异时自然没有可走的点。 */
export function traceShift(grid: number[], size = 16): ShiftTrace {
  return tracePoints(spreadPoints(grid, size));
}

/** 一个 episode 的相邻相对矢量差：d2 - d1。 */
export function accelerations(steps: ShiftStep[]): ShiftAccel[] {
  const out: ShiftAccel[] = [];
  for (let i = 1; i < steps.length; i++) {
    const prev = steps[i - 1]!;
    const cur = steps[i]!;
    const dx = cur.dx - prev.dx;
    const dy = cur.dy - prev.dy;
    out.push({ dx, dy, mag: Math.hypot(dx, dy) });
  }
  return out;
}

/** 方向只保留 8 个相对方位；不记录绝对坐标。 */
const directionBin = (dx: number, dy: number): number => {
  const angle = Math.atan2(dy, dx);
  const normalized = (angle + Math.PI * 2) % (Math.PI * 2);
  return Math.round(normalized / (Math.PI / 4)) % 8;
};

const relativeLengthBin = (value: number, scale: number): number =>
  value < scale * 0.75 ? 0 : value <= scale * 1.25 ? 1 : 2;

const relativeAccelBin = (value: number, scale: number): number =>
  value < scale * 0.25 ? 0 : value <= scale * 0.75 ? 1 : 2;

const closureBin = (ratio: number): number => ratio < 0.25 ? 0 : ratio < 0.7 ? 1 : 2;

/** 每个 episode 分别产生相对观察；不写绝对 dx/dy 小数。 */
export function episodeObservations(trace: ShiftTrace): string[][] {
  return trace.episodes.map((episode) => {
    if (episode.steps.length === 0) return [];
    const lengths = episode.steps.map((step) => Math.hypot(step.dx, step.dy));
    const scale = median(lengths);
    const out: string[] = [];
    for (const step of episode.steps) {
      out.push(`shift_vec_${directionBin(step.dx, step.dy)}_${relativeLengthBin(Math.hypot(step.dx, step.dy), scale)}`);
    }
    for (const accel of accelerations(episode.steps)) {
      const bin = relativeAccelBin(accel.mag, scale);
      const dir = bin === 0 ? 0 : directionBin(accel.dx, accel.dy);
      out.push(`shift_accel_${dir}_${bin}`);
    }
    const first = episode.points[0]!;
    const last = episode.points[episode.points.length - 1]!;
    const path = lengths.reduce((sum, value) => sum + value, 0);
    const ratio = path === 0 ? 0 : Math.hypot(last.x - first.x, last.y - first.y) / path;
    out.push(`shift_closure_${closureBin(ratio)}`);

    const xs = episode.points.map((point) => point.x);
    const ys = episode.points.map((point) => point.y);
    const span = Math.max(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys)) / 16;
    const area = episode.points.reduce((sum, point) => sum + ((point as Partial<ThickPoint>).mass ?? 1), 0) / (16 * 16);
    out.push(`shift_span_${span.toFixed(3)}`);
    out.push(`shift_area_${area.toFixed(3)}`);
    return out;
  });
}

/** 训练简单图形时使用展平后的观察；episode 边界不会产生跳跃加速度。 */
export function shiftObservations(trace: ShiftTrace): string[] {
  return episodeObservations(trace).flat();
}

/** 加速度大小分布，只用于报告；不写回记忆。 */
export function accelProfile(steps: ShiftStep[]): Record<string, number> {
  const out: Record<string, number> = { zero: 0, small: 0, large: 0 };
  for (const accel of accelerations(steps)) {
    if (accel.mag < 0.01) out.zero = (out.zero ?? 0) + 1;
    else if (accel.mag < 0.75) out.small = (out.small ?? 0) + 1;
    else out.large = (out.large ?? 0) + 1;
  }
  return out;
}
