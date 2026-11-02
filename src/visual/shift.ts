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

const median = (values: number[]): number => {
  if (values.length === 0) return 1;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)]!;
};

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
    if (episode.steps.length === 0) {
      const point = episode.points[0];
      if (!point) return [];
      const mass = (point as Partial<ThickPoint>).mass ?? 1;
      if (mass >= 16 * 16) return [];
      const area = mass / (16 * 16);
      const pointBin = mass < 8 ? 0 : mass < 32 ? 1 : 2;
      return [`shift_point_${pointBin}`, "shift_span_0.000", `shift_area_${area.toFixed(3)}`];
    }
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
