/**
 * 通用工作周期：概念袋 → 任务 → 相关信念 → 规则核。
 *
 * 这一层不碰 Board / 扫描头 / SRF / TRF。它只使用 Memory 里的概念、任务、
 * 信念和 Question，因此以后换感知通道也不会影响控制逻辑。
 */

import { Bag } from './bag.ts'
import type { Concept } from './concept.ts'
import {
  arithmeticAggregate,
  arithmeticOperation,
  evaluateArithmetic,
  numberOf,
} from './arithmetic.ts'
import { derivePair, type Derivation, type RuleName } from './inference.ts'
import type { Memory } from './memory.ts'
import { Judgment, Question, type Sentence } from './sentence.ts'
import { OperationTerm, SequenceTerm, Statement, type Term } from './term.ts'
import { EvidentialBase, TruthValue } from './value.ts'

export type CycleResult = {
  kind: 'inference' | 'reverse' | 'answer' | 'arithmetic' | 'difference' | 'sequence'
  concept: string
  task: string
  belief?: string
  rule?: RuleName
  statement?: string
  subquestions?: string[]
}

const processed = new WeakMap<object, Set<string>>()

function once(task: object, key: string): boolean {
  const seen = processed.get(task) ?? new Set<string>()
  processed.set(task, seen)
  if (seen.has(key)) return false
  seen.add(key)
  return true
}

function statementTerm(term: Term): Statement | null {
  return term instanceof Statement ? term : null
}

function exactBelief(memory: Memory, statement: Statement): Judgment | null {
  const concept = memory.getConcept(statement)
  return concept?.getTruth() ?? null
}

function shareTerm(first: Statement, second: Statement): boolean {
  return (
    first.subject.key === second.subject.key ||
    first.subject.key === second.predicate.key ||
    first.predicate.key === second.subject.key ||
    first.predicate.key === second.predicate.key
  )
}

/**
 * 反向推理：从问题 S→P 和已有信念 S→M / M→P 生成子问题。
 * 只生成子问题，不直接宣称答案；答案仍由正向规则和精确匹配得出。
 */
export function reverseQuestions(memory: Memory, question: Question): string[] {
  const content = statementTerm(question.content)
  if (!content) return []
  const made: string[] = []

  const add = (subject: Term, predicate: Term) => {
    if (subject.key === predicate.key) return
    const statement = new Statement(content.connector, subject, predicate)
    if (memory.getConcept(statement)?.questionTable.some((q) => q.content.key === statement.key)) return
    const sub = new Question(
      statement,
      '反向',
      undefined,
      new EvidentialBase([...question.evidence.stamps, 0]),
    )
    memory.addSentence(sub)
    made.push(statement.format())
  }

  for (const concept of memory.concepts()) {
    for (const belief of concept.beliefTable) {
      if (!(belief.content instanceof Statement)) continue
      if (!shareTerm(content, belief.content)) continue
      if (belief.content.key === content.key) continue

      if (content.connector === '-->' && belief.content.connector === '-->') {
        // S→M 回答 S→P，需要先回答 M→P
        if (belief.content.subject.key === content.subject.key) {
          add(belief.content.predicate, content.predicate)
        }
        // M→P 回答 S→P，需要先回答 S→M
        if (belief.content.predicate.key === content.predicate.key) {
          add(content.subject, belief.content.subject)
        }
      }
      if (content.connector === '<->' && belief.content.connector === '<->') {
        if (belief.content.subject.key === content.subject.key) {
          add(belief.content.predicate, content.predicate)
        }
        if (belief.content.predicate.key === content.predicate.key) {
          add(content.subject, belief.content.subject)
        }
      }
    }
  }

  // 若刚好已有精确答案，直接挂到问题上
  question.solution = exactBelief(memory, content)
  return made
}

function isOperationEvent(term: Term): term is OperationTerm {
  return (
    term instanceof OperationTerm &&
    term.components.length >= 2 &&
    term.components.every((component) => numberOf(component) !== null)
  )
}

function isSequenceEvent(term: Term): term is SequenceTerm {
  return term instanceof SequenceTerm
}

function sequenceTruth(first: Judgment, second: Judgment): TruthValue {
  return new TruthValue(
    first.truth.frequency * second.truth.frequency,
    first.truth.confidence * second.truth.confidence,
  )
}

function candidates(memory: Memory, focus: { x: number; y: number } | null): Concept[] {
  if (focus) {
    // 2D bag 先给出当前相对锚点附近的句子，再把它们所属概念作为本轮候选。
    // 附近没有可处理任务时才退回全记忆，避免空间索引把系统锁死。
    const nearby = new Set<string>()
    for (const entry of memory.queryLeaf(focus.x, focus.y)) {
      const concept = entry.concept
      const hasQuestion = concept.questionTable.some((question) => !question.solution)
      const hasTask = concept.taskTable.some(
        (task) =>
          task.sentence instanceof Judgment &&
          (task.sentence.content instanceof Statement ||
            isOperationEvent(task.sentence.content) ||
            isSequenceEvent(task.sentence.content)),
      )
      if (hasQuestion || hasTask) nearby.add(concept.key)
    }
    if (nearby.size) {
      return memory.concepts().filter((concept) => nearby.has(concept.key))
    }
  }

  return memory.concepts().filter((concept) => {
    if (concept.questionTable.some((question) => !question.solution)) return true
    return concept.taskTable.some(
      (task) =>
        task.sentence instanceof Judgment &&
        (task.sentence.content instanceof Statement ||
          isOperationEvent(task.sentence.content) ||
          isSequenceEvent(task.sentence.content)),
    )
  })
}

function chooseTask(concept: Concept): Question | Judgment | null {
  const question = [...concept.questionTable].reverse().find((item) => !item.solution)
  if (question) return question
  return chooseJudgmentTask(concept)
}

function chooseJudgmentTask(concept: Concept): Judgment | null {
  return (
    [...concept.taskTable]
      .map((task) => task.sentence)
      .reverse()
      .find((sentence): sentence is Judgment => sentence instanceof Judgment) ?? null
  )
}

function relatedBeliefs(memory: Memory, task: Statement): Judgment[] {
  const beliefs = new Map<string, Judgment>()
  for (const concept of memory.concepts()) {
    for (const belief of concept.beliefTable) {
      if (belief.content instanceof Statement && shareTerm(task, belief.content)) {
        beliefs.set(belief.content.key, belief)
      }
    }
  }
  return [...beliefs.values()].sort(
    (left, right) => right.truth.confidence - left.truth.confidence,
  )
}

/** 2D bag：查询当前句子相对锚点附近的观察；不做区域/形状判定 */
function spatialBeliefs(memory: Memory, task: Judgment): Judgment[] {
  const anchor = memory.anchorOf(task)
  if (!anchor) return []
  return memory
    .queryLeaf(anchor.x, anchor.y)
    .map((entry) => entry.sentence)
    .filter((sentence): sentence is Judgment => sentence instanceof Judgment)
    .filter((sentence) => sentence.content instanceof Statement)
}

/** 一条工作周期；没有可处理的任务时返回 null */
export function runCycle(memory: Memory, focus: { x: number; y: number } | null = null): CycleResult | null {
  const pool = candidates(memory, focus)
  if (!pool.length) return null
  const bag = new Bag<Concept>(Math.max(8, pool.length))
  for (const concept of pool) {
    bag.put(concept, Math.max(0.01, concept.priority + concept.sentenceCount * 0.001))
  }
  const tried = new Set<string>()
  while (bag.size > 0) {
    const concept = bag.take()
    if (!concept || tried.has(concept.key)) continue
    tried.add(concept.key)
    const result = runConcept(memory, concept)
    if (result) return result
  }
  return null
}

function runConcept(memory: Memory, concept: Concept): CycleResult | null {
  const task = chooseTask(concept)
  if (!task) return null
  const content = statementTerm(task.content)

  if (task instanceof Judgment && isOperationEvent(task.content)) {
    return processOperationEvent(memory, concept, task)
  }
  if (task instanceof Judgment && isSequenceEvent(task.content)) {
    return processSequenceEvent(memory, concept, task)
  }
  if (task instanceof Question) {
    const computed = evaluateArithmetic(task.content)
    if (computed) {
      const judgment = new Judgment(
        computed,
        new TruthValue(1, 0.99),
        '算术',
        undefined,
        new EvidentialBase([...task.evidence.stamps]),
      )
      memory.addSentence(judgment)
      task.solution = judgment
      return {
        kind: 'arithmetic',
        concept: concept.key,
        task: task.format(),
        statement: computed.format(),
      }
    }
    if (!content) return null
    const exact = exactBelief(memory, content)
    if (exact) {
      task.solution = exact
      return { kind: 'answer', concept: concept.key, task: task.format(), statement: exact.format() }
    }
    const subquestions = reverseQuestions(memory, task)
    if (subquestions.length) {
      return {
        kind: 'reverse',
        concept: concept.key,
        task: task.format(),
        subquestions,
      }
    }
    const fallback = chooseJudgmentTask(concept)
    if (!fallback) return null
    return processJudgment(memory, concept, fallback)
  }

  return processJudgment(memory, concept, task)
}

/** 规则控制：按结论自身的置信度选择，不另设硬编码规则次序 */
function processOperationEvent(
  memory: Memory,
  concept: Concept,
  task: Judgment,
): CycleResult | null {
  if (!isOperationEvent(task.content)) return null
  const event = task.content
  const anchor = memory.anchorOf(task)
  if (!anchor) return null
  const peers = memory
    .queryLeaf(anchor.x, anchor.y)
    .map((entry) => entry.sentence)
    .filter((sentence): sentence is Judgment => sentence instanceof Judgment)
    .filter((sentence) => {
      if (!(sentence.content instanceof OperationTerm)) return false
      return (
        isOperationEvent(sentence.content) &&
        sentence.content.key !== event.key &&
        sentence.content.operator === event.operator
      )
    })
    .sort((left, right) => left.creationTime - right.creationTime)

  const other =
    peers.find((peer) => peer.creationTime > task.creationTime) ??
    peers[peers.length - 1]
  if (!other || !isOperationEvent(other.content)) return null
  const otherEvent = other.content

  const made: string[] = []
  const addQuestion = (questionTerm: OperationTerm) => {
    if (
      memory
        .getConcept(questionTerm)
        ?.questionTable.some((question) => question.content.key === questionTerm.key)
    ) {
      return
    }
    const question = new Question(questionTerm, '差')
    memory.addSentence(question, undefined, anchor)
    made.push(questionTerm.format())
  }

  const count = Math.min(event.components.length, otherEvent.components.length)
  for (let index = 0; index < count; index++) {
    const left = numberOf(event.components[index]!)
    const right = numberOf(otherEvent.components[index]!)
    if (left === null || right === null) continue
    for (const operator of ['difference', 'ratio'] as const) {
      const questionTerm = arithmeticOperation(
        operator,
        event.components[index]!,
        otherEvent.components[index]!,
      )
      addQuestion(questionTerm)
    }
  }

  // 同一叶里同一操作的多个事件，可以在对应分量上问 sum / average；
  // 这只是通用算术，不是方向/线/曲线判定。
  const componentCount = Math.min(
    event.components.length,
    ...peers.map((peer) => (peer.content as OperationTerm).components.length),
  )
  for (let index = 0; index < componentCount; index++) {
    const values = [
      event.components[index]!,
      ...peers.map((peer) => (peer.content as OperationTerm).components[index]!),
    ].filter((component) => numberOf(component) !== null)
    if (values.length < 2) continue
    for (const operator of ['sum', 'average'] as const) {
      addQuestion(arithmeticAggregate(operator, values))
    }
  }

  // 时间上相邻的两个操作事件组成序列；序列是现有 SequenceTerm，
  // 不新建“链/方向”词项，也不预判它是直线还是曲线。
  const first = task.creationTime <= other.creationTime ? task : other
  const second = first === task ? other : task
  const sequence = new SequenceTerm([first.content, second.content])
  const knownSequence = memory
    .getConcept(sequence)
    ?.beliefTable.some((belief) => belief.content.key === sequence.key)
  if (!knownSequence) {
    memory.addSentence(
      new Judgment(sequence, sequenceTruth(first, second), '序列'),
      undefined,
      anchor,
    )
    return {
      kind: 'sequence',
      concept: concept.key,
      task: task.format(),
      belief: other.format(),
      statement: sequence.format(),
      subquestions: made,
    }
  }

  if (!made.length) return null
  return {
    kind: 'difference',
    concept: concept.key,
    task: task.format(),
    subquestions: made,
  }
}

function operationTerms(term: Term): OperationTerm[] {
  if (term instanceof SequenceTerm) return term.components.flatMap(operationTerms)
  return isOperationEvent(term) ? [term] : []
}

function processSequenceEvent(
  memory: Memory,
  concept: Concept,
  task: Judgment,
): CycleResult | null {
  if (!(task.content instanceof SequenceTerm)) return null
  const anchor = memory.anchorOf(task)
  if (!anchor) return null
  const sequence = task.content
  const contained = new Set<string>()
  const collect = (term: Term) => {
    contained.add(term.key)
    if (term instanceof SequenceTerm) term.components.forEach(collect)
  }
  collect(sequence)

  const next = memory
    .queryLeaf(anchor.x, anchor.y)
    .map((entry) => entry.sentence)
    .filter((sentence): sentence is Judgment => sentence instanceof Judgment)
    .filter((sentence) => isOperationEvent(sentence.content))
    .filter((sentence) => sentence.creationTime > task.creationTime)
    .filter((sentence) => !contained.has(sentence.content.key))
    .sort((left, right) => left.creationTime - right.creationTime)[0]
  if (!next || !isOperationEvent(next.content)) return null

  const extended = new SequenceTerm([sequence, next.content])
  if (
    memory
      .getConcept(extended)
      ?.beliefTable.some((belief) => belief.content.key === extended.key)
  ) {
    return null
  }
  memory.addSentence(
    new Judgment(extended, sequenceTruth(task, next), '序列'),
    undefined,
    anchor,
  )

  // 序列整体也可以对每个分量求 sum / average；这仍是通用算术，
  // 不是“方向/线/曲线”判定。
  const made: string[] = []
  const events = operationTerms(extended)
  const componentCount = Math.min(...events.map((event) => event.components.length))
  for (let index = 0; index < componentCount; index++) {
    const values = events.map((event) => event.components[index]!)
    if (values.length < 2) continue
    for (const operator of ['sum', 'average'] as const) {
      const questionTerm = arithmeticAggregate(operator, values)
      if (
        memory
          .getConcept(questionTerm)
          ?.questionTable.some((question) => question.content.key === questionTerm.key)
      ) {
        continue
      }
      const question = new Question(questionTerm, '差')
      memory.addSentence(question, undefined, anchor)
      made.push(questionTerm.format())
    }
  }

  return {
    kind: 'sequence',
    concept: concept.key,
    task: task.format(),
    belief: next.format(),
    statement: extended.format(),
    subquestions: made.length ? made : undefined,
  }
}

function processJudgment(memory: Memory, concept: Concept, task: Judgment): CycleResult | null {
  const content = statementTerm(task.content)
  if (!content) return null
  const nearby = spatialBeliefs(memory, task)
  const beliefs =
    nearby.length > 0
      ? nearby
      : relatedBeliefs(memory, content)
  const candidates = beliefs.filter(
    (belief) => belief.content.key !== content.key && once(task, belief.content.key),
  )

  let best: { derivation: Derivation; belief: Judgment } | null = null
  for (const belief of candidates) {
    for (const derivation of derivePair(task, belief)) {
      const known = memory
        .getConcept(derivation.statement)
        ?.beliefTable.some((item) => item.content.key === derivation.statement.key)
      if (known) continue
      const score = derivation.truth.confidence
      const bestScore = best ? best.derivation.truth.confidence : Number.NEGATIVE_INFINITY
      if (score > bestScore) best = { derivation, belief }
    }
  }

  if (!best) return null
  memory.addSentence(
    new Judgment(
      best.derivation.statement,
      best.derivation.truth,
      '推理',
      undefined,
      best.derivation.evidence,
    ),
  )
  answerAll(memory)
  return {
    kind: 'inference',
    concept: concept.key,
    task: task.format(),
    belief: best.belief.format(),
    rule: best.derivation.rule,
    statement: best.derivation.statement.format(),
  }
}

function answerAll(memory: Memory): void {
  for (const concept of memory.concepts()) {
    for (const question of concept.questionTable) {
      const content = statementTerm(question.content)
      if (!content) continue
      question.solution = exactBelief(memory, content) ?? question.solution
    }
  }
}

/** 问题是否已经得到精确答案 */
export function questionSolved(question: Question): boolean {
  return question.solution !== null
}
