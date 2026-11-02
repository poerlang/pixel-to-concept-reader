/**
 * 句子层级（NARS-2025 第 6.2 节）：
 *
 *   Sentence        内容（Term）+ 标点 + 创建时刻 + 预算 + 证据基础
 *   ├ Judgment      陈述句，带真值，标点 '.'
 *   ├ Goal          祈使句，带欲望值，标点 '!'
 *   └ Question      疑问句，带当前最佳答案，标点 '?'
 *
 * 句子不是“关于词项的记录”，而是包着一个词项；同内容的句子归到同一个概念里。
 */

import type { Term } from './term.ts'
import { BudgetValue, EvidentialBase, TruthValue } from './value.ts'

let clock = 0
function nextTime(): number {
  clock += 1
  return clock
}

/** 句子在画幅上的位置（0..1） */
export type SentencePlacement = { x: number; y: number }

/** 句子基类 */
export abstract class Sentence {
  /** 内容：一个词项 */
  readonly content: Term

  /** 创建时刻（内部时钟） */
  readonly creationTime: number

  /** 资源分配份额 */
  readonly budget: BudgetValue

  /** 证据基础 */
  readonly evidence: EvidentialBase

  /** 产生它的来源（像素 / 动作 / 目标），界面按它做水平布局 */
  readonly source: string

  /** 该句子对应的画幅位置；没有空间意义的句子为 null */
  readonly placement: SentencePlacement | null

  /** 数值读数：空间操作的 -1..1 绝对坐标；其它句子为 null */
  readonly value: number | null

  protected constructor(
    content: Term,
    source = '',
    budget: BudgetValue = new BudgetValue(),
    evidence: EvidentialBase = new EvidentialBase(),
    placement: SentencePlacement | null = null,
    value: number | null = null,
  ) {
    this.content = content
    this.source = source
    this.budget = budget
    this.evidence = evidence
    this.placement = placement
    this.value = value
    this.creationTime = nextTime()
  }

  /** 标点：判断 '.'、目标 '!'、问题 '?' */
  abstract readonly punctuation: string

  /** 不带真值的写法，如 <当前格 --> 黑>. */
  abstract format(): string

  /** 同标点同内容视为同一句（缓冲按它合并计数） */
  get key(): string {
    return `${this.punctuation}|${this.content.key}`
  }

  toString(): string {
    return this.format()
  }
}

/** 陈述句 */
export class Judgment extends Sentence {
  readonly truth: TruthValue
  readonly punctuation = '.'

  constructor(
    content: Term,
    truth: TruthValue,
    source = '',
    budget?: BudgetValue,
    evidence?: EvidentialBase,
    placement: SentencePlacement | null = null,
    value: number | null = null,
  ) {
    super(content, source, budget, evidence, placement, value)
    this.truth = truth
  }

  format(): string {
    return `${this.content.format()}.`
  }
}

/** 目标句：真值被解释成欲望值 */
export class Goal extends Sentence {
  readonly desire: TruthValue
  readonly punctuation = '!'

  constructor(
    content: Term,
    desire: TruthValue,
    source = '',
    budget?: BudgetValue,
    evidence?: EvidentialBase,
    placement: SentencePlacement | null = null,
    value: number | null = null,
  ) {
    super(content, source, budget, evidence, placement, value)
    this.desire = desire
  }

  format(): string {
    return `${this.content.format()}!`
  }
}

/** 疑问句：solution 是目前找到的最佳答案 */
export class Question extends Sentence {
  readonly punctuation = '?'
  solution: Judgment | null = null

  constructor(
    content: Term,
    source = '',
    budget?: BudgetValue,
    evidence?: EvidentialBase,
    placement: SentencePlacement | null = null,
    value: number | null = null,
  ) {
    super(content, source, budget, evidence, placement, value)
  }

  format(): string {
    return `${this.content.format()}?`
  }
}

/** 句子的真值（问句没有） */
export function truthOf(sentence: Sentence): TruthValue | null {
  if (sentence instanceof Judgment) return sentence.truth
  if (sentence instanceof Goal) return sentence.desire
  return null
}

/** 同标点同内容视为同一句 */
export function sentenceKey(sentence: Sentence): string {
  return sentence.key
}
