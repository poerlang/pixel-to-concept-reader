/**
 * 通用 NAL 真值函数。
 *
 * 这一层只认识 f/c 和词项，不认识画幅、区域、颜色或任何领域对象。
 * 公式按 OpenNARS / NAL 的三段论真值表实现；证据基由推理层合并。
 */

import { TruthValue } from './value.ts'

export function boolAnd(...values: number[]): number {
  return values.reduce((acc, value) => acc * value, 1)
}

export function boolOr(...values: number[]): number {
  return values.reduce((acc, value) => acc + value - acc * value, 0)
}

export function boolNot(value: number): number {
  return 1 - value
}

/** 总证据量 → 置信度 c = w/(w+k) */
export function w2c(weight: number, k = 1): number {
  if (weight <= 0) return 0
  return weight / (weight + k)
}

/** 置信度 → 证据量 w = k*c/(1-c) */
export function c2w(confidence: number, k = 1): number {
  if (confidence >= 1) return Number.POSITIVE_INFINITY
  return (k * confidence) / (1 - confidence)
}

/** 由正证据、总证据构造真值 */
export function fromEvidence(positive: number, total: number, k = 1): TruthValue {
  if (total <= 0) return new TruthValue(0.5, 0)
  return new TruthValue(positive / total, w2c(total, k))
}

/** 修订：同一陈述的独立证据合并 */
export function fRev(first: TruthValue, second: TruthValue, k = 1): TruthValue {
  const w1 = c2w(first.confidence, k)
  const w2 = c2w(second.confidence, k)
  const total = w1 + w2
  if (!Number.isFinite(total) || total <= 0) return first
  const positive = first.frequency * w1 + second.frequency * w2
  return fromEvidence(positive, total, k)
}

/** 演绎：S→M, M→P ⊢ S→P */
export function fDed(first: TruthValue, second: TruthValue): TruthValue {
  return new TruthValue(
    boolAnd(first.frequency, second.frequency),
    boolAnd(first.frequency, second.frequency, first.confidence, second.confidence),
  )
}

/** 例证：S→M, M→P ⊢ P→S（弱，反向） */
export function fExe(first: TruthValue, second: TruthValue, k = 1): TruthValue {
  const weight = boolAnd(first.frequency, second.frequency, first.confidence, second.confidence)
  return fromEvidence(weight, weight, k)
}

/** 归纳：M→P, M→S ⊢ S→P（弱，两个前提共享主语） */
export function fInd(first: TruthValue, second: TruthValue, k = 1): TruthValue {
  const positive = boolAnd(first.frequency, second.frequency, first.confidence, second.confidence)
  const negative = boolAnd(
    boolNot(first.frequency),
    second.frequency,
    first.confidence,
    second.confidence,
  )
  return fromEvidence(positive, positive + negative, k)
}

/** 溯因：P→M, S→M ⊢ S→P（弱，两个前提共享谓语） */
export function fAbd(first: TruthValue, second: TruthValue, k = 1): TruthValue {
  const positive = boolAnd(first.frequency, second.frequency, first.confidence, second.confidence)
  const negative = boolAnd(
    first.frequency,
    boolNot(second.frequency),
    first.confidence,
    second.confidence,
  )
  return fromEvidence(positive, positive + negative, k)
}

/** 比较：共享一端 → 两端相似 */
export function fComparison(first: TruthValue, second: TruthValue, k = 1): TruthValue {
  const union = boolOr(first.frequency, second.frequency)
  const frequency = union === 0 ? 0 : boolAnd(first.frequency, second.frequency) / union
  const weight = boolAnd(union, first.confidence, second.confidence)
  return new TruthValue(frequency, w2c(weight, k))
}

/** 类比：S↔M, M→P ⊢ S→P */
export function fAnalogy(first: TruthValue, second: TruthValue): TruthValue {
  return new TruthValue(
    boolAnd(first.frequency, second.frequency),
    boolAnd(second.frequency, first.confidence, second.confidence),
  )
}

/** 相像：S↔M, M↔P ⊢ S↔P */
export function fResemblance(first: TruthValue, second: TruthValue): TruthValue {
  return new TruthValue(
    boolAnd(first.frequency, second.frequency),
    boolAnd(first.confidence, second.confidence, boolOr(first.frequency, second.frequency)),
  )
}
