/**
 * 三个辅助值类（NARS-2025 第 6.2 节）：
 * - TruthValue      真值：频度 f + 置信度 c
 * - EvidentialBase  证据基础：推出一条真值所依据的输入序号
 * - BudgetValue     预算：优先级 / 持久性 / 质量
 */

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0
  return Math.min(1, Math.max(0, value))
}

/** 真值：f 频度、c 置信度 */
export class TruthValue {
  readonly frequency: number
  readonly confidence: number

  constructor(frequency: number, confidence: number) {
    this.frequency = clamp01(frequency)
    this.confidence = clamp01(confidence)
  }

  format(): string {
    return `%${this.frequency.toFixed(2)};${this.confidence.toFixed(2)}%`
  }

  toString(): string {
    return this.format()
  }
}

/** 证据基础：输入句子的序号（推导句是前提证据的交错合并） */
export class EvidentialBase {
  readonly stamps: number[]

  constructor(stamps: number[] = []) {
    this.stamps = [...stamps]
  }

  get length(): number {
    return this.stamps.length
  }

  format(): string {
    return `{${this.stamps.join(',')}}`
  }
}

/** 预算：短期（优先级）、长期（持久性）、时间不敏感（质量） */
export class BudgetValue {
  readonly priority: number
  readonly durability: number
  readonly quality: number

  constructor(priority = 0.5, durability = 0.5, quality = 0.5) {
    this.priority = clamp01(priority)
    this.durability = clamp01(durability)
    this.quality = clamp01(quality)
  }

  format(): string {
    return `⟨${this.priority.toFixed(2)}, ${this.durability.toFixed(2)}, ${this.quality.toFixed(2)}⟩`
  }
}
