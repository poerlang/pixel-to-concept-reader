/**
 * 驱动力：把「目标强度」和「操作熟练度」合成一个 0..1 的引导度。
 *
 * 引导度低 → 这一步多半是随机探索；
 * 引导度高 → 多半跟着目标走（甚至不再随机）。
 * 没有目标时引导度恒为 0，走法一定是随机的。
 */

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0
  return Math.min(1, Math.max(0, value))
}

/** 没练过的操作，熟练度从这里起步 */
const BASE_SKILL = 0.2
/** 练对一次涨多少 */
const SUCCESS_GAIN = 0.07
/** 练错一次掉多少 */
const FAILURE_LOSS = 0.015
/** 刚设目标时的强度 */
const GOAL_SEED = 0.35
/** 每找到一次目标，强度涨多少 */
const GOAL_GAIN = 0.04

export class Drive {
  /** 目标强度 0..1：越「想」，越容易压过随机 */
  goalStrength = 0

  private skills = new Map<string, number>()

  /** 某个操作的熟练度 */
  skillOf(operator: string): number {
    return this.skills.get(operator) ?? BASE_SKILL
  }

  /** 练一次：结果好就涨，结果差就掉一点 */
  reinforce(operator: string, success: boolean) {
    const next = this.skillOf(operator) + (success ? SUCCESS_GAIN : -FAILURE_LOSS)
    this.skills.set(operator, clamp01(next))
  }

  /** 设目标 / 取消目标 */
  setGoal(active: boolean) {
    this.goalStrength = active ? Math.max(this.goalStrength, GOAL_SEED) : 0
  }

  /** 每达成一次，目标更强一点 */
  raiseGoal(amount = GOAL_GAIN) {
    this.goalStrength = clamp01(this.goalStrength + amount)
  }

  /**
   * 引导度 = 目标强度 + 熟练度（各占一半）。
   * 概念熟练度可以顶替操作熟练度：任一够高都算「熟练」。
   */
  guidance(operator: string, conceptSkill = 0): number {
    return this.guidanceFor([operator], conceptSkill)
  }

  /** 计划级引导度：取计划内最熟练的可训练算子 */
  guidanceFor(operators: readonly string[], conceptSkill = 0): number {
    if (this.goalStrength <= 0 || operators.length === 0) return 0
    const skill = operators.reduce(
      (best, operator) => Math.max(best, this.skillOf(operator)),
      conceptSkill,
    )
    return clamp01(0.55 * this.goalStrength + 0.45 * skill)
  }

  /** 忘掉练过的东西 */
  reset() {
    this.skills.clear()
    this.goalStrength = 0
  }
}
