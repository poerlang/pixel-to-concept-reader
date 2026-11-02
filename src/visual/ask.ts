// 视觉问句脉冲：不扫描整幅图，而是把“这里是不是目标色？”作为问句，
// 沿四邻接一次一步地散播；满足/不满足都沿原链回报给发问者。
//
// 这里只负责产生“粗点”，不产生形状名。粗点由 4 个较远的不满足锚点围出的圆决定：
// 圆内的满足点才是这个问句的粗点。问句的下一步由 Bag 里的兴趣优先级选择，
// 不做固定行扫描，也不一次处理整幅画。

import { Bag } from "../nars/bag.ts";
import type { Point, ShiftStep, ShiftTrace } from "./shift.ts";

export type AskQuestion = {
  id: number;
  ask: number;
  origin: Point;
  at: Point;
  depth: number;
  energy: number;
  priority: number;
  durability: number;
  quality: number;
  path: Point[];
};

export type AskReport = {
  ask: number;
  at: Point;
  satisfied: boolean;
  depth: number;
  path: Point[];
  /** 不满足点能否作为锚点：路径中间必须经过至少一个满足点。 */
  validAnchor: boolean;
};

export type CoarseAsk = {
  ask: number;
  seed: Point;
  center: Point;
  mass: number;
  anchors: Point[];
  selected: Point[];
  average: Point;
  centroid: Point;
  vector: Point;
  satisfied: Point[];
  reports: AskReport[];
};

type AskState = {
  ask: number;
  seed: Point;
  pending: number;
  seen: Map<string, number>;
  satisfied: Map<string, Point>;
  unsatisfied: Map<string, AskReport>;
  reports: AskReport[];
};

export type AskOptions = {
  /** 一次 askShift 最多推进多少个问句/扫描步。4K 下也保持有界。 */
  maxSteps?: number;
  /** 两个粗点中心至少相隔多少格；避免重复问同一块。 */
  coarseSpacing?: number;
  /** 一个问句最多走多深。 */
  maxDepth?: number;
  /** 一个问句的初始能量；目标越强，实际散播越久。 */
  maxEnergy?: number;
  /** 最多形成多少个粗点。 */
  maxCoarse?: number;
  /** 目标强度函数；默认黑/白二值，可替换成颜色/亮度。 */
  target?: (value: number) => number;
  /** 没有问句时，一次最多扫描多少格找新种子；避免一次扫全图。 */
  seedScan?: number;
  /** 优先从笔画内部发问，避免种子贴着边界只有一侧锚点。 */
  interiorOnly?: boolean;
};

const key = (point: Point): string => `${point.x},${point.y}`;
const distance = (a: Point, b: Point): number => Math.hypot(b.x - a.x, b.y - a.y);
const clamp = (value: number): number => Math.max(0.01, Math.min(1, value));
const median = (values: number[]): number => {
  if (!values.length) return 1;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)]!;
};
const DIRECTIONS = [[1, 0], [-1, 0], [0, 1], [0, -1]] as const;

export type Circle = { x: number; y: number; radius: number };

/** 最小包围圆：询问点和两侧边界点一起决定，避免任意选远点把圆撑大。 */
export function enclosingCircle(points: Point[]): Circle {
  if (points.length === 0) return { x: 0, y: 0, radius: 0 };
  if (points.length === 1) return { x: points[0]!.x, y: points[0]!.y, radius: 0 };
  let best: Circle | null = null;
  const inside = (circle: Circle): boolean => points.every((point) => distance(point, circle) <= circle.radius + 1e-9);
  const consider = (circle: Circle): void => {
    if (!inside(circle)) return;
    if (!best || circle.radius < best.radius) best = circle;
  };

  for (let i = 0; i < points.length; i++) {
    for (let j = i + 1; j < points.length; j++) {
      const a = points[i]!;
      const b = points[j]!;
      consider({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, radius: distance(a, b) / 2 });
    }
  }

  for (let i = 0; i < points.length; i++) {
    for (let j = i + 1; j < points.length; j++) {
      for (let k = j + 1; k < points.length; k++) {
        const a = points[i]!;
        const b = points[j]!;
        const c = points[k]!;
        const d = 2 * (a.x * (b.y - c.y) + b.x * (c.y - a.y) + c.x * (a.y - b.y));
        if (Math.abs(d) < 1e-9) continue;
        const ux = ((a.x ** 2 + a.y ** 2) * (b.y - c.y)
          + (b.x ** 2 + b.y ** 2) * (c.y - a.y)
          + (c.x ** 2 + c.y ** 2) * (a.y - b.y)) / d;
        const uy = ((a.x ** 2 + a.y ** 2) * (c.x - b.x)
          + (b.x ** 2 + b.y ** 2) * (a.x - c.x)
          + (c.x ** 2 + c.y ** 2) * (b.x - a.x)) / d;
        const center = { x: ux, y: uy };
        consider({ ...center, radius: distance(center, a) });
      }
    }
  }
  return best ?? { x: points[0]!.x, y: points[0]!.y, radius: 0 };
}

/**
 * 问句脉冲。每次 step 只处理一个问句或有限个种子扫描格。
 */
export class VisualPulse {
  readonly size: number;
  readonly grid: number[];
  readonly maxDepth: number;
  readonly maxEnergy: number;
  readonly maxCoarse: number;
  readonly coarseSpacing: number;
  readonly seedScan: number;
  readonly interiorOnly: boolean;
  readonly target: (value: number) => number;

  private readonly questions = new Bag<AskQuestion>(2048);
  private readonly seedCandidates: Point[] = [];
  private readonly states = new Map<number, AskState>();
  private readonly covered = new Set<string>();
  private readonly coarse: CoarseAsk[] = [];
  private nextAsk = 1;
  private seedCursor = 0;
  private finished = false;
  private lastFocus: Point | null = null;
  private direction = { x: 0, y: 0 };
  private readonly seedSeen = new Set<string>();

  constructor(grid: number[], size = 16, options: AskOptions = {}) {
    this.grid = grid;
    this.size = size;
    this.maxDepth = Math.max(1, options.maxDepth ?? 6);
    this.maxEnergy = Math.max(1, options.maxEnergy ?? 4);
    this.maxCoarse = Math.max(1, options.maxCoarse ?? 80);
    this.coarseSpacing = Math.max(0, options.coarseSpacing ?? 0);
    this.seedScan = Math.max(1, options.seedScan ?? 32);
    this.interiorOnly = options.interiorOnly ?? false;
    this.target = options.target ?? ((value) => value ? 1 : 0.2);
  }

  get coarsePoints(): readonly CoarseAsk[] {
    return this.coarse;
  }

  get done(): boolean {
    return this.finished && this.questions.size === 0 && this.seedCandidates.length === 0 && this.coarse.length >= this.maxCoarse;
  }

  /** 推进一个 NAL 工作步；返回是否还有事可做。 */
  step(): boolean {
    if (this.coarse.length >= this.maxCoarse) {
      this.finished = true;
      return false;
    }
    if (this.questions.size === 0) {
      const seed = this.nextSeed();
      if (seed === null) return false;
      if (seed === undefined) return true; // 只做了有限个种子扫描格，下一步继续
      this.start(seed);
      return true;
    }

    const question = this.questions.select();
    if (!question) return false;
    const state = this.states.get(question.ask);
    if (!state) return true;
    state.pending--;

    const index = Math.floor(question.at.y) * this.size + Math.floor(question.at.x);
    const value = this.grid[index] ?? 0;
    const strength = this.target(value);
    const satisfied = strength > 0.5;
    const report: AskReport = {
      ask: question.ask,
      at: question.at,
      satisfied,
      depth: question.depth,
      path: question.path,
      validAnchor: !satisfied && question.depth > 1 && this.hasSatisfiedIntermediary(question.path),
    };
    state.reports.push(report);
    if (satisfied) state.satisfied.set(key(question.at), question.at);
    else state.unsatisfied.set(key(question.at), report);

    const decay = satisfied ? 0.35 : 0.9;
    const energy = question.energy - decay;
    if (energy > 0 && question.depth < this.maxDepth) {
      for (const [dx, dy] of DIRECTIONS) {
        const nx = Math.floor(question.at.x) + dx;
        const ny = Math.floor(question.at.y) + dy;
        if (nx < 0 || ny < 0 || nx >= this.size || ny >= this.size) continue;
        const at = { x: nx + 0.5, y: ny + 0.5 };
        const seen = state.seen.get(key(at));
        if (seen !== undefined && seen <= question.depth + 1) continue;
        state.seen.set(key(at), question.depth + 1);
        const priority = clamp(energy / this.maxEnergy * (0.55 + 0.45 * strength) * (1 - question.depth / this.maxDepth));
        this.questions.put({
          id: this.nextAsk++,
          ask: question.ask,
          origin: question.origin,
          at,
          depth: question.depth + 1,
          energy,
          priority,
          durability: clamp(energy / this.maxEnergy),
          quality: priority,
          path: [...question.path, at],
        });
        state.pending++;
      }
    }

    if (state.pending === 0) this.finishAsk(state);
    return true;
  }

  run(limit = 400): number {
    let done = 0;
    while (done < limit && this.step()) done++;
    return done;
  }

  /** 问句全部结束后，按空间邻近 + 方向连续性形成 Shift 轨迹。 */
  trace(): ShiftTrace {
    const points = this.coarse.map((entry) => ({ x: entry.center.x, y: entry.center.y, mass: entry.mass }));
    if (!points.length) {
      // 没有目标色：整幅场是一个没有方向的中性粗点。
      const neutral = [{ x: this.size / 2, y: this.size / 2, mass: this.size * this.size }];
      return { points: neutral, steps: [], episodes: [{ points: neutral, steps: [] }] };
    }
    if (points.length === 1) {
      return { points, steps: [], episodes: [{ points, steps: [] }] };
    }

    const ordered = this.orderSpatial(points);
    const links = ordered.slice(1).map((to, index) => {
      const from = ordered[index]!;
      return { from, to, dx: to.x - from.x, dy: to.y - from.y };
    });
    const limit = Math.max(2.5, median(links.map((link) => Math.hypot(link.dx, link.dy))) * 2.5);
    const episodes: Array<{ points: Point[]; steps: ShiftStep[] }> = [];
    let currentPoints: Point[] = [ordered[0]!];
    let currentSteps: ShiftStep[] = [];

    for (const link of links) {
      const previous = currentSteps.at(-1);
      const reverse = previous && previous.dx * link.dx + previous.dy * link.dy < 0;
      if (currentSteps.length && (Math.hypot(link.dx, link.dy) > limit || reverse)) {
        episodes.push({ points: currentPoints, steps: currentSteps });
        currentPoints = [link.to];
        currentSteps = [];
      } else {
        currentPoints.push(link.to);
        currentSteps.push(link);
      }
    }
    episodes.push({ points: currentPoints, steps: currentSteps });
    return {
      points: ordered,
      steps: episodes.flatMap((episode) => episode.steps),
      episodes,
    };
  }

  private orderSpatial(points: Point[]): Point[] {
    const remaining = [...points];
    const ordered: Point[] = [remaining.shift()!];
    let direction: Point | null = null;
    while (remaining.length) {
      const current = ordered.at(-1)!;
      let bestIndex = 0;
      let bestScore = Infinity;
      for (let i = 0; i < remaining.length; i++) {
        const candidate = remaining[i]!;
        const dx = candidate.x - current.x;
        const dy = candidate.y - current.y;
        const d = Math.hypot(dx, dy);
        const alignment = direction && d > 1e-9
          ? Math.max(-1, Math.min(1, (dx * direction.x + dy * direction.y) / d))
          : 0;
        const score = d + 0.45 * (1 - alignment);
        if (score < bestScore) {
          bestScore = score;
          bestIndex = i;
        }
      }
      const [next] = remaining.splice(bestIndex, 1);
      if (!next) break;
      const dx = next.x - current.x;
      const dy = next.y - current.y;
      const length = Math.hypot(dx, dy);
      if (length > 1e-9) direction = { x: dx / length, y: dy / length };
      ordered.push(next);
    }
    return ordered;
  }

  private isInterior(point: Point): boolean {
    const x = Math.floor(point.x);
    const y = Math.floor(point.y);
    for (const [dx, dy] of DIRECTIONS) {
      const nx = x + dx;
      const ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= this.size || ny >= this.size) return false;
      if (!this.grid[ny * this.size + nx]) return false;
    }
    return true;
  }

  private chooseSeed(at: Point): Point {
    const from = this.lastFocus ?? at;
    const dx = at.x - from.x;
    const dy = at.y - from.y;
    const length = Math.hypot(dx, dy);
    if (length > 1e-9) this.direction = { x: dx / length, y: dy / length };
    this.lastFocus = at;
    return at;
  }

  private nextSeed(): Point | null | undefined {
    let interiorBest: { at: Point; index: number; score: number } | null = null;
    let boundaryBest: { at: Point; index: number; score: number } | null = null;
    for (let i = this.seedCandidates.length - 1; i >= 0; i--) {
      const at = this.seedCandidates[i]!;
      if (this.covered.has(key(at))) {
        this.seedCandidates.splice(i, 1);
        continue;
      }
      const from = this.lastFocus ?? at;
      const dx = at.x - from.x;
      const dy = at.y - from.y;
      const d = Math.hypot(dx, dy);
      const alignment = d > 1e-9 ? (dx * this.direction.x + dy * this.direction.y) / d : 0;
      const score = d + 0.5 * (1 - alignment);
      if (!this.interiorOnly || this.isInterior(at)) {
        if (!interiorBest || score < interiorBest.score) interiorBest = { at, index: i, score };
      } else if (!boundaryBest || score < boundaryBest.score) {
        boundaryBest = { at, index: i, score };
      }
    }
    const best = interiorBest ?? boundaryBest;
    if (best) {
      this.seedCandidates.splice(best.index, 1);
      return this.chooseSeed(best.at);
    }
    if (this.seedCursor >= this.size * this.size) {
      this.finished = true;
      return null;
    }
    const end = Math.min(this.size * this.size, this.seedCursor + this.seedScan);
    let fallback: Point | undefined;
    for (; this.seedCursor < end; this.seedCursor++) {
      const x = this.seedCursor % this.size;
      const y = Math.floor(this.seedCursor / this.size);
      if (!this.grid[this.seedCursor]) continue;
      const at = { x: x + 0.5, y: y + 0.5 };
      if (this.covered.has(key(at))) continue;
      if (!this.interiorOnly || this.isInterior(at)) {
        this.seedCursor++;
        return this.chooseSeed(at);
      }
      fallback ??= at;
    }
    return fallback ? this.chooseSeed(fallback) : undefined;
  }

  private start(seed: Point): void {
    const ask = this.nextAsk++;
    const strength = this.target(this.grid[Math.floor(seed.y) * this.size + Math.floor(seed.x)] ?? 0);
    const state: AskState = {
      ask,
      seed,
      pending: 1,
      seen: new Map([[key(seed), 0]]),
      satisfied: new Map(),
      unsatisfied: new Map(),
      reports: [],
    };
    this.states.set(ask, state);
    this.questions.put({
      id: this.nextAsk++,
      ask,
      origin: seed,
      at: seed,
      depth: 0,
      energy: this.maxEnergy,
      priority: clamp(0.35 + 0.55 * strength),
      durability: 0.9,
      quality: 0.8,
      path: [seed],
    });
  }

  private hasSatisfiedIntermediary(path: Point[]): boolean {
    return path.slice(1, -1).some((point) => {
      const index = Math.floor(point.y) * this.size + Math.floor(point.x);
      return this.target(this.grid[index] ?? 0) > 0.5;
    });
  }

  private finishAsk(state: AskState): void {
    this.states.delete(state.ask);
    const valid = [...state.unsatisfied.values()]
      .filter((report) => report.validAnchor)
      .map((report) => report.at);
    const satisfied = [...state.satisfied.values()];
    if (!satisfied.length) return;

    // 询问点可能在笔画中央，也可能贴着边缘。
    // 只用询问点附近的满足点求局部协方差，避免另一条笔画把切向拉斜。
    const local = satisfied.filter((point) => distance(state.seed, point) <= 3);
    const basis = local.length >= 3 ? local : satisfied;
    const centroid = {
      x: basis.reduce((sum, point) => sum + point.x, 0) / basis.length,
      y: basis.reduce((sum, point) => sum + point.y, 0) / basis.length,
    };
    let covXX = 0;
    let covYY = 0;
    let covXY = 0;
    for (const point of basis) {
      const dx = point.x - centroid.x;
      const dy = point.y - centroid.y;
      covXX += dx * dx;
      covYY += dy * dy;
      covXY += dx * dy;
    }
    covXX /= basis.length;
    covYY /= basis.length;
    covXY /= basis.length;

    let pair: [Point, Point] | null = null;
    let pairVector = { x: 1, y: 0 };
    if (Math.hypot(covXX - covYY, 2 * covXY) > 1e-6) {
      // 主轴 = 笔画切向；法向 = 横截面方向。
      const normalAngle = 0.5 * Math.atan2(2 * covXY, covXX - covYY) + Math.PI / 2;
      const nx = Math.cos(normalAngle);
      const ny = Math.sin(normalAngle);
      let negative: { point: Point; depth: number } | null = null;
      let positive: { point: Point; depth: number } | null = null;
      for (const point of valid) {
        const dx = point.x - centroid.x;
        const dy = point.y - centroid.y;
        const normalProjection = dx * nx + dy * ny;
        const tangentProjection = -dx * ny + dy * nx;
        if (Math.abs(tangentProjection) > 2.5) continue;
        const depth = Math.abs(normalProjection);
        if (normalProjection < 0 && (!negative || depth < negative.depth)) negative = { point, depth };
        if (normalProjection > 0 && (!positive || depth < positive.depth)) positive = { point, depth };
      }
      if (negative && positive) {
        pair = [negative.point, positive.point];
        pairVector = { x: positive.point.x - negative.point.x, y: positive.point.y - negative.point.y };
      }
    }

    // 协方差退化或单侧缺失时，退回对向扇区。
    if (!pair) {
      const sectors = new Map<number, { point: Point; depth: number }>();
      for (const point of valid) {
        const angle = Math.atan2(point.y - state.seed.y, point.x - state.seed.x);
        const bin = Math.round(((angle + Math.PI * 2) % (Math.PI * 2)) / (Math.PI / 4)) % 8;
        const d = distance(state.seed, point);
        const known = sectors.get(bin);
        if (!known || d < known.depth) sectors.set(bin, { point, depth: d });
      }
      let pairScore = Infinity;
      for (const [aBin, bBin] of [[0, 4], [1, 5], [2, 6], [3, 7]] as const) {
        const a = sectors.get(aBin);
        const b = sectors.get(bBin);
        if (!a || !b) continue;
        const spread = distance(a.point, b.point);
        if (spread < 1) continue;
        const score = spread + 0.25 * Math.abs(a.depth - b.depth);
        if (score < pairScore) {
          pairScore = score;
          pair = [a.point, b.point];
          pairVector = { x: b.point.x - a.point.x, y: b.point.y - a.point.y };
        }
      }
    }
    if (!pair) return;

    const selected = pair;
    const average = {
      x: (pair[0].x + pair[1].x) / 2,
      y: (pair[0].y + pair[1].y) / 2,
    };
    const circle = { x: average.x, y: average.y, radius: distance(pair[0], pair[1]) / 2 };
    // 询问点必须落在这条跨笔画圆内；否则这对边界没有真正夹住询问点。
    if (distance(state.seed, circle) > circle.radius + 0.75) return;
    const inside = satisfied.filter((point) => distance({ x: circle.x, y: circle.y }, point) <= circle.radius + 1e-9);
    if (!inside.length) return;

    const center = {
      x: inside.reduce((sum, point) => sum + point.x, 0) / inside.length,
      y: inside.reduce((sum, point) => sum + point.y, 0) / inside.length,
    };
    if (this.coarse.some((entry) => distance(entry.center, center) < this.coarseSpacing)) {
      for (const point of inside) this.covered.add(key(point));
      return;
    }
    this.coarse.push({
      ask: state.ask,
      seed: state.seed,
      center,
      mass: inside.length,
      anchors: [state.seed, pair[0], pair[1]],
      selected,
      average,
      centroid,
      vector: pairVector,
      satisfied: inside,
      reports: state.reports,
    });
    for (const point of inside) this.covered.add(key(point));

    // 兴趣：从当前粗点周围继续，优先近处，并延续上一步的大致方向。
    const from = this.lastFocus ?? state.seed;
    const motion = { x: center.x - from.x, y: center.y - from.y };
    const motionLength = Math.hypot(motion.x, motion.y);
    if (motionLength > 1e-9) this.direction = { x: motion.x / motionLength, y: motion.y / motionLength };
    this.lastFocus = center;

    for (const anchor of [center, ...selected]) {
      for (let oy = -3; oy <= 3; oy++) {
        for (let ox = -3; ox <= 3; ox++) {
          const nx = Math.floor(anchor.x) + ox;
          const ny = Math.floor(anchor.y) + oy;
          if (nx < 0 || ny < 0 || nx >= this.size || ny >= this.size) continue;
          if (!this.grid[ny * this.size + nx]) continue;
          const at = { x: nx + 0.5, y: ny + 0.5 };
          const atKey = key(at);
          if (this.covered.has(atKey) || this.seedSeen.has(atKey)) continue;
          this.seedSeen.add(atKey);
          this.seedCandidates.push(at);
        }
      }
    }

    // 沿笔画切向两端各补一个种子，保证不会只沿一个方向变密。
    const normalLength = Math.hypot(pairVector.x, pairVector.y);
    if (normalLength > 1e-9) {
      const tangent = { x: -pairVector.y / normalLength, y: pairVector.x / normalLength };
      for (const sign of [-1, 1] as const) {
        for (const step of [2, 3] as const) {
          const nx = Math.floor(center.x + tangent.x * step * sign);
          const ny = Math.floor(center.y + tangent.y * step * sign);
          if (nx < 0 || ny < 0 || nx >= this.size || ny >= this.size) continue;
          if (!this.grid[ny * this.size + nx]) continue;
          const at = { x: nx + 0.5, y: ny + 0.5 };
          const atKey = key(at);
          if (this.covered.has(atKey) || this.seedSeen.has(atKey)) continue;
          this.seedSeen.add(atKey);
          this.seedCandidates.push(at);
        }
      }
    }
  }
}

/** 默认入口：有界地问若干次。 */
export function askShift(grid: number[], size = 16, options: AskOptions = {}): ShiftTrace {
  const pulse = new VisualPulse(grid, size, options);
  pulse.run(options.maxSteps ?? 600);
  return pulse.trace();
}

/** 普通视觉推理：先浅层局部问句；没有形成任何 Shift 时再加深，而不是一开始扫全图。 */
export function askTrace(grid: number[], size = 16): ShiftTrace {
  const shallow = askShift(grid, size, { maxDepth: 3, maxEnergy: 2, maxSteps: 600 });
  if (shallow.steps.length > 0 || shallow.points.length > 1) return shallow;
  return askShift(grid, size, { maxDepth: 6, maxEnergy: 4, maxSteps: 600 });
}
