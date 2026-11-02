/**
 * 通用 NAL 规则核：只处理 Statement / 词项 / 真值 / 证据，不认识任何领域对象。
 *
 * 当前实现 NAL-1 的四格三段论（演绎、归纳、溯因、例证、比较）和 NAL-2 的
 * 类比/相像，以及同陈述的修订。推理控制仍是极简的逐对闭包；它以后可以被
 * 正式的袋/任务工作周期替换，但规则本身不依赖 Board、像素或扫描头。
 */

import { Judgment, type Sentence } from './sentence.ts'
import { Statement, type Term } from './term.ts'
import { EvidentialBase, TruthValue } from './value.ts'
import {
  fAbd,
  fAnalogy,
  fComparison,
  fDed,
  fExe,
  fInd,
  fResemblance,
  fRev,
} from './truth.ts'

export type RuleName =
  | 'revision'
  | 'deduction'
  | 'induction'
  | 'abduction'
  | 'example'
  | 'comparison'
  | 'analogy'
  | 'resemblance'

export type Derivation = {
  statement: Statement
  truth: TruthValue
  evidence: EvidentialBase
  rule: RuleName
  premises: [string, string]
}

type Inheritance = { kind: 'inheritance'; statement: Statement; subject: Term; predicate: Term }
type Similarity = { kind: 'similarity'; statement: Statement; left: Term; right: Term }
type Parsed = Inheritance | Similarity

function parse(statement: Statement): Parsed | null {
  if (statement.connector === '-->') {
    return {
      kind: 'inheritance',
      statement,
      subject: statement.subject,
      predicate: statement.predicate,
    }
  }
  if (statement.connector === '<->') {
    return {
      kind: 'similarity',
      statement,
      left: statement.subject,
      right: statement.predicate,
    }
  }
  return null
}

function mergeEvidence(first: Judgment, second: Judgment): EvidentialBase {
  return new EvidentialBase([
    ...new Set([...first.evidence.stamps, ...second.evidence.stamps]),
  ])
}

/** 修订只接受证据基不相交的判断；空证据不参与修订。 */
function independent(first: Judgment, second: Judgment): boolean {
  const left = first.evidence.stamps
  const right = second.evidence.stamps
  if (!left.length || !right.length) return false
  const rightSet = new Set(right)
  return left.every((stamp) => !rightSet.has(stamp))
}

function make(
  rule: RuleName,
  statement: Statement,
  truth: TruthValue,
  first: Judgment,
  second: Judgment,
): Derivation {
  return {
    statement,
    truth,
    evidence: mergeEvidence(first, second),
    rule,
    premises: [first.content.format(), second.content.format()],
  }
}

function inheritance(subject: Term, predicate: Term): Statement {
  return new Statement('-->', subject, predicate)
}

function similarity(left: Term, right: Term): Statement {
  return new Statement('<->', left, right)
}

/**
 * 两个前提能触发的全部规则。结论只按结构生成，不预判内容；
 * 是否保留、如何选择由调用方的闭包/工作周期决定。
 */
export function derivePair(first: Judgment, second: Judgment): Derivation[] {
  const left = first.content
  const right = second.content
  if (!(left instanceof Statement) || !(right instanceof Statement)) return []

  const results: Derivation[] = []

  // 同陈述 → 修订
  if (left.key === right.key && independent(first, second)) {
    results.push(make('revision', left, fRev(first.truth, second.truth), first, second))
  }

  const a = parse(left)
  const b = parse(right)
  if (!a || !b) return results

  if (a.kind === 'inheritance' && b.kind === 'inheritance') {
    // 格 1/4：一个的谓语是另一个的主语 → 演绎 + 例证（双向都检查）
    if (a.subject.key === b.predicate.key) {
      results.push(make('deduction', inheritance(b.subject, a.predicate), fDed(first.truth, second.truth), first, second))
      results.push(make('example', inheritance(a.predicate, b.subject), fExe(first.truth, second.truth), first, second))
    }
    if (a.predicate.key === b.subject.key) {
      results.push(make('deduction', inheritance(a.subject, b.predicate), fDed(first.truth, second.truth), first, second))
      results.push(make('example', inheritance(b.predicate, a.subject), fExe(first.truth, second.truth), first, second))
    }

    // 格 2：共享谓语 → 两个溯因 + 比较
    if (a.predicate.key === b.predicate.key) {
      results.push(make('abduction', inheritance(a.subject, b.subject), fAbd(first.truth, second.truth), first, second))
      results.push(make('abduction', inheritance(b.subject, a.subject), fAbd(second.truth, first.truth), first, second))
      results.push(make('comparison', similarity(a.subject, b.subject), fComparison(first.truth, second.truth), first, second))
    }

    // 格 3：共享主语 → 两个归纳 + 比较
    if (a.subject.key === b.subject.key) {
      results.push(make('induction', inheritance(b.predicate, a.predicate), fInd(first.truth, second.truth), first, second))
      results.push(make('induction', inheritance(a.predicate, b.predicate), fInd(second.truth, first.truth), first, second))
      results.push(make('comparison', similarity(a.predicate, b.predicate), fComparison(first.truth, second.truth), first, second))
    }
  } else if (a.kind === 'similarity' && b.kind === 'similarity') {
    // 相像：两个相似陈述共享一端
    if (a.left.key === b.left.key) {
      results.push(make('resemblance', similarity(a.right, b.right), fResemblance(first.truth, second.truth), first, second))
    }
    if (a.left.key === b.right.key) {
      results.push(make('resemblance', similarity(a.right, b.left), fResemblance(first.truth, second.truth), first, second))
    }
    if (a.right.key === b.left.key) {
      results.push(make('resemblance', similarity(a.left, b.right), fResemblance(first.truth, second.truth), first, second))
    }
    if (a.right.key === b.right.key) {
      results.push(make('resemblance', similarity(a.left, b.left), fResemblance(first.truth, second.truth), first, second))
    }
  } else {
    // 类比：相似陈述替换继承陈述的一端
    const sim: Similarity = a.kind === 'similarity' ? a : (b as Similarity)
    const inh: Inheritance = a.kind === 'inheritance' ? a : (b as Inheritance)
    const simFirst = a.kind === 'similarity'
    const truth = simFirst
      ? fAnalogy(first.truth, second.truth)
      : fAnalogy(second.truth, first.truth)
    const pairs: Array<[Term, Term]> = []
    if (inh.subject.key === sim.left.key) pairs.push([sim.right, inh.predicate])
    if (inh.subject.key === sim.right.key) pairs.push([sim.left, inh.predicate])
    if (inh.predicate.key === sim.left.key) pairs.push([inh.subject, sim.right])
    if (inh.predicate.key === sim.right.key) pairs.push([inh.subject, sim.left])
    for (const [subject, predicate] of pairs) {
      results.push(make('analogy', inheritance(subject, predicate), truth, first, second))
    }
  }

  return results.filter((entry) => entry.statement.subject.key !== entry.statement.predicate.key)
}

function rank(judgment: Judgment): number {
  return judgment.truth.confidence * 0.6 + judgment.truth.frequency * 0.4
}

/**
 * 通用推理闭包：反复对所有信念两两应用规则，直到没有新结论或达到上限。
 * 这是规则核的测试/批处理入口，不是最终工作周期；正式工作周期以后会按
 * 袋优先级选择概念、任务和信念。
 */
export function inferClosure(initial: Iterable<Judgment>, rounds = 8, limit = 256): Judgment[] {
  const beliefs = new Map<string, Judgment>()
  for (const judgment of initial) {
    const existing = beliefs.get(judgment.content.key)
    if (!existing || rank(judgment) > rank(existing)) beliefs.set(judgment.content.key, judgment)
  }

  for (let round = 0; round < rounds; round++) {
    let changed = false
    const current = [...beliefs.values()]
    for (let i = 0; i < current.length; i++) {
      for (let j = i + 1; j < current.length; j++) {
        for (const derivation of derivePair(current[i]!, current[j]!)) {
          if (beliefs.size >= limit) break
          const existing = beliefs.get(derivation.statement.key)
          const candidate = new Judgment(
            derivation.statement,
            derivation.truth,
            '推理',
            undefined,
            derivation.evidence,
          )
          if (!existing || rank(candidate) > rank(existing)) {
            beliefs.set(derivation.statement.key, candidate)
            changed = true
          }
        }
      }
    }
    if (!changed) break
  }
  return [...beliefs.values()]
}

/** 一个简单的通用推理器；不依赖 Board / 扫描头。 */
export class InferenceEngine {
  private readonly beliefs = new Map<string, Judgment>()
  private stamp = 0

  constructor(initial: Iterable<Judgment> = []) {
    for (const judgment of initial) this.add(judgment)
  }

  /** 输入一条判断；自动分配证据基 */
  tell(statement: Statement, frequency = 1, confidence = 0.9): Judgment {
    this.stamp += 1
    const judgment = new Judgment(
      statement,
      new TruthValue(frequency, confidence),
      '输入',
      undefined,
      new EvidentialBase([this.stamp]),
    )
    this.add(judgment)
    return judgment
  }

  add(judgment: Judgment): void {
    const existing = this.beliefs.get(judgment.content.key)
    if (!existing || rank(judgment) > rank(existing)) {
      this.beliefs.set(judgment.content.key, judgment)
    }
  }

  /** 精确匹配当前信念，作为最简单的问答入口 */
  ask(statement: Statement): Judgment | null {
    return this.beliefs.get(statement.key) ?? null
  }

  /** 单步闭包：找第一对能推出新结论的信念 */
  inferOnce(): Derivation | null {
    const current = [...this.beliefs.values()]
    for (let i = 0; i < current.length; i++) {
      for (let j = i + 1; j < current.length; j++) {
        for (const derivation of derivePair(current[i]!, current[j]!)) {
          if (!this.beliefs.has(derivation.statement.key)) {
            this.add(new Judgment(derivation.statement, derivation.truth, '推理', undefined, derivation.evidence))
            return derivation
          }
        }
      }
    }
    return null
  }

  /** 跑若干步，返回派生记录 */
  run(steps = 16): Derivation[] {
    const traced: Derivation[] = []
    for (let index = 0; index < steps; index++) {
      const derivation = this.inferOnce()
      if (!derivation) break
      traced.push(derivation)
    }
    return traced
  }

  beliefList(): Judgment[] {
    return [...this.beliefs.values()]
  }

  /** 兼容句子层：只接受判断 */
  sentences(): Sentence[] {
    return this.beliefList()
  }
}
