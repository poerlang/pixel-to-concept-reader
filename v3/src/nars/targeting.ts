/**
 * 通用目标选择：在现有视野的活跃读数上做注意力选择。
 *
 * 它不判断线、曲线、粗点或区域；只把“下一步空间操作跳到哪”看成一次
 * 候选评分：改变小（节能）、方向延续（惯性）、没看过（探索）。
 * 只有声明了位置目标的 OperationSpec 才会用到它。
 */

import type { Board, PixelDatum } from './board.ts'

export type AttentionSettings = {
  /** 越小越偏好近距离：节能 */
  energy: number
  /** 越接近上一次 shift 方向越优先：惯性 */
  inertia: number
  /** 没访问过的落点优先：探索 */
  novelty: number
  /** 附近已有高优先级概念时优先靠近：概念显著性 */
  salience: number
  /** 采样温度：0 = 总取最高分，越大越随机 */
  temperature: number
}

export const DEFAULT_ATTENTION: AttentionSettings = {
  energy: 0.5,
  inertia: 0.25,
  novelty: 0.1,
  salience: 0.15,
  temperature: 0.25,
}

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value))
}

export function normalizeAttention(patch: Partial<AttentionSettings>): AttentionSettings {
  return {
    energy: clamp01(patch.energy ?? DEFAULT_ATTENTION.energy),
    inertia: clamp01(patch.inertia ?? DEFAULT_ATTENTION.inertia),
    novelty: clamp01(patch.novelty ?? DEFAULT_ATTENTION.novelty),
    salience: clamp01(patch.salience ?? DEFAULT_ATTENTION.salience),
    temperature: Math.min(2, Math.max(0, patch.temperature ?? DEFAULT_ATTENTION.temperature)),
  }
}

/**
 * 在四叉树给出的像素候选中选一个 shift 落点。
 * 活跃读数（白笔画）优先；没有活跃读数时才退回全部像素。
 */
export function chooseAttentionTarget(
  board: Board,
  visited: Set<string>,
  previous: { x: number; y: number } | null,
  settings: AttentionSettings = DEFAULT_ATTENTION,
  salienceAt?: (x: number, y: number) => number,
): { x: number; y: number } | null {
  const all = board.pixelTree.queryCircle(0.5, 0.5, 1)
  if (!all.length) return null
  const active = all.filter((pixel) => pixel.data.value === 0)
  const pool = active.length ? active : all

  const previousLength = previous ? Math.hypot(previous.x, previous.y) : 0
  const scored = pool
    .filter((pixel) => !(Math.abs(pixel.x - board.x) < 1e-9 && Math.abs(pixel.y - board.y) < 1e-9))
    .map((pixel) => {
      const dx = pixel.x - board.x
      const dy = pixel.y - board.y
      const distance = Math.hypot(dx, dy)
      const energy = 1 - Math.min(1, distance / Math.SQRT2)
      const inertia =
        previous && previousLength > 1e-9
          ? (dx * previous.x + dy * previous.y) / (distance * previousLength)
          : 0
      const novelty = visited.has(pixelKey(pixel.data)) ? 0 : 1
      const salience = salienceAt ? salienceAt(pixel.x, pixel.y) : 0
      const score =
        settings.energy * energy +
        settings.inertia * inertia +
        settings.novelty * novelty +
        settings.salience * salience
      return { x: pixel.x, y: pixel.y, score, key: pixelKey(pixel.data) }
    })

  if (!scored.length) return null
  const maxScore = Math.max(...scored.map((entry) => entry.score))
  const weights = scored.map((entry) =>
    settings.temperature <= 0 ? (entry.score === maxScore ? 1 : 0) : Math.exp((entry.score - maxScore) / settings.temperature),
  )
  const total = weights.reduce((sum, value) => sum + value, 0)
  let pick = Math.random() * total
  for (let index = 0; index < scored.length; index++) {
    pick -= weights[index]!
    if (pick <= 0) {
      visited.add(scored[index]!.key)
      return { x: scored[index]!.x, y: scored[index]!.y }
    }
  }
  const last = scored[scored.length - 1]!
  visited.add(last.key)
  return { x: last.x, y: last.y }
}

function pixelKey(pixel: PixelDatum): string {
  return `${pixel.column}:${pixel.row}`
}
