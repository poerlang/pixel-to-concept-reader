/**
 * 概念（NARS-2025 第 6.3 节）：由词项命名的数据结构，是句子的容器。
 *
 *   Concept
 *   ├ term         标识它的词项（复合词项时，结构本身就是分析性定义）
 *   ├ kind         atom / statement / set / intersection / difference / operation / mental
 *   ├ simplicity   句法复杂度起步，越当整体用越降
 *   ├ budget       该概念的预算
 *   ├ priority     当前优先级（consider 等心理操作会调整）
 *   ├ taskTable    待处理的句子（Task）
 *   ├ beliefTable  信念（Judgment）
 *   ├ desireTable  欲望（Goal）
 *   ├ questionTable 问题
 *   └ taskLinks / termLinks
 *
 * OperationConcept 是「操作概念」：它不是独立的操作类，而是 Concept 的子类。
 * 操作词项本身（OperationTerm）仍然是 Compound（见 term.ts）。
 * NAL-9 的心理操作同样落在 MentalOperationConcept（OperationConcept 的子类）里。
 */

import { type Sentence, Goal, Judgment, Question, truthOf } from './sentence.ts'
import { OperationTerm, termDepth, termKind, type Term, type TermKind } from './term.ts'
import { BudgetValue } from './value.ts'

/** 概念的种类（比词项多一个「心理操作」） */
export type ConceptKind = TermKind | 'mental'

/** 表容量：概念内的表都很小，溢出丢最低优先级（这里是丢最旧） */
const TABLE_CAPACITY = { task: 10, belief: 8, desire: 5, question: 5 }
const LINK_CAPACITY = 16
/** 操作句子的采样配置：叶子深度、每叶上限、概念信念容量 */
export type OperationSampling = {
  leafDepth: number
  leafCap: number
  beliefCapacity: number
}

/** 扫描句子的四叉树叶子网格：4 层 = 16×16 个叶子 */
export const SHIFT_LEAF_DEPTH = 4
export const SHIFT_LEAF_SIDE = 1 << SHIFT_LEAF_DEPTH
/** 每个叶子区域、每种 shift 最多保留几条句子 */
export const SHIFT_LEAF_CAP = 2
/** shift 概念能容纳的句子总数（叶子数 × 每叶上限） */
export const SHIFT_BELIEF_CAPACITY = SHIFT_LEAF_SIDE * SHIFT_LEAF_SIDE * SHIFT_LEAF_CAP

/** 默认采样：保留 shift 当前的空间离散度和容量 */
export const DEFAULT_OPERATION_SAMPLING: OperationSampling = {
  leafDepth: SHIFT_LEAF_DEPTH,
  leafCap: SHIFT_LEAF_CAP,
  beliefCapacity: SHIFT_BELIEF_CAPACITY,
}

/** 画幅坐标 → 指定深度的四叉树叶子 key */
export function operationLeafKey(x: number, y: number, depth = SHIFT_LEAF_DEPTH): string {
  const side = 1 << Math.max(0, Math.floor(depth))
  const column = Math.min(side - 1, Math.max(0, Math.floor(x * side)))
  const row = Math.min(side - 1, Math.max(0, Math.floor(y * side)))
  return `${column}:${row}`
}

/** 兼容旧名：shift 的 4 层叶子 key */
export function shiftLeafKey(x: number, y: number): string {
  return operationLeafKey(x, y, SHIFT_LEAF_DEPTH)
}

/** 任务：正在处理中的句子 */
export class Task {
  readonly sentence: Sentence
  readonly budget: BudgetValue
  /** 完成程度 0..1 */
  achievingLevel = 0
  /** 反向推理时可选的前向推理答案 */
  preferredBelief: Judgment | null = null

  constructor(sentence: Sentence, budget: BudgetValue = new BudgetValue()) {
    this.sentence = sentence
    this.budget = budget
  }
}

/** 词项链：复合词项 ↔ 成分词项 */
export class TermLink {
  /** 指向的词项（复合词项 c 或成分 cᵢ） */
  readonly target: Term
  /** true：指向复合词项；false：指向成分 */
  readonly toCompound: boolean
  /** 成分在复合词项中的位置 */
  readonly indexes: number[]

  constructor(target: Term, toCompound: boolean, indexes: number[] = [0]) {
    this.target = target
    this.toCompound = toCompound
    this.indexes = indexes
  }

  format(): string {
    return `${this.toCompound ? '↑' : '↓'}${this.target.format()}`
  }
}

/** 任务链：把一个任务连到它能被处理的概念 */
export class TaskLink {
  readonly target: Task
  readonly budget: BudgetValue

  constructor(target: Task, budget: BudgetValue = new BudgetValue()) {
    this.target = target
    this.budget = budget
  }
}

/** 概念 */
export class Concept {
  /** 标识词项 */
  readonly term: Term

  /** 概念种类（由词项决定，操作概念单独标） */
  readonly kind: ConceptKind

  /** 简单度：复合词项越常被当作整体用，越低 */
  simplicity = 1

  /** 预算 */
  readonly budget: BudgetValue

  /** 当前优先级 0..1（排序、consider 用） */
  priority = 0.5

  /**
   * 概念自身的 f/c（由句子按 OpenNARS 修正逐步累积）。
   * 单条句子的证据权重被压小，所以 c 是慢慢涨上去的，不会一条就到 0.9。
   */
  frequency = 0.5
  confidence = 0

  /** 最近一次被研究模式选中的步数；用于避免反复研究同一个概念 */
  lastStudiedAt = Number.NEGATIVE_INFINITY

  readonly taskTable: Task[] = []
  readonly beliefTable: Judgment[] = []
  readonly desireTable: Goal[] = []
  readonly questionTable: Question[] = []

  readonly taskLinks: TaskLink[] = []
  readonly termLinks: TermLink[] = []

  /** 研究模式下的操作子句；与普通任务链分开，避免被观察句挤掉 */
  readonly childTasks: Task[] = []

  /** 信念表容量：普通概念很小；操作概念由采样配置决定 */
  readonly beliefCapacity: number

  constructor(
    term: Term,
    kind: ConceptKind = termKind(term),
    beliefCapacity = TABLE_CAPACITY.belief,
  ) {
    this.term = term
    this.kind = kind
    this.beliefCapacity = beliefCapacity
    this.budget = new BudgetValue()
  }

  /** 概念由词项命名 */
  get key(): string {
    return this.term.key
  }

  /** 封装深度：原子 0，顺序对 1，集合 2……（3D 分层用） */
  get depth(): number {
    return termDepth(this.term)
  }

  get complexity(): number {
    return this.term.complexity
  }

  /** 三张句子表的条数 */
  get sentenceCount(): number {
    return this.beliefTable.length + this.desireTable.length + this.questionTable.length
  }

  /** 活跃度：概念里存了多少句子 / 挂了多少任务链（概念排序用） */
  get activity(): number {
    return this.sentenceCount + this.taskLinks.length + this.childTasks.length
  }

  /** 提高 / 降低优先级（consider 用） */
  activate(delta: number): void {
    this.priority = clamp01(this.priority + delta)
  }

  /** 收一条任务；同时按角色进信念/欲望/问题表，并按修正公式更新概念 c */
  addTask(task: Task): void {
    pushCapped(this.taskTable, task, TABLE_CAPACITY.task)
    const sentence = task.sentence
    if (sentence instanceof Judgment) pushCapped(this.beliefTable, sentence, this.beliefCapacity)
    else if (sentence instanceof Goal) pushCapped(this.desireTable, sentence, TABLE_CAPACITY.desire)
    else if (sentence instanceof Question) pushCapped(this.questionTable, sentence, TABLE_CAPACITY.question)
    this.reinforce(sentence)
    // 有新信息进来，概念更值得被看
    this.activate(0.01)
  }

  /**
   * OpenNARS 修正：w = c / (1-c)，f 按权重加权，c = W / (W + 1)。
   * 这里把每条句子的 c 乘一个很小的系数，让概念 c 慢慢增长。
   */
  reinforce(sentence: Sentence): void {
    const truth = truthOf(sentence)
    if (!truth) return
    const c1 = this.confidence
    const c2 = Math.min(0.99, Math.max(0.01, truth.confidence * 0.1))
    const w1 = c1 > 1e-9 ? c1 / (1 - c1) : 0
    const w2 = c2 / (1 - c2)
    const total = w1 + w2
    if (total <= 0) return
    this.frequency = (this.frequency * w1 + truth.frequency * w2) / total
    this.confidence = Math.min(0.999, total / (total + 1))
  }

  /** 直接收一条句子（内部包成 Task） */
  addSentence(sentence: Sentence): void {
    this.addTask(new Task(sentence))
  }

  /** 最高置信度的信念 */
  getTruth(): Judgment | null {
    let best: Judgment | null = null
    for (const belief of this.beliefTable) {
      if (!best || belief.truth.confidence > best.truth.confidence) best = belief
    }
    return best
  }

  /** 最强欲望 */
  getDesire(): Goal | null {
    let best: Goal | null = null
    for (const desire of this.desireTable) {
      if (!best || desire.desire.frequency > best.desire.frequency) best = desire
    }
    return best
  }

  addTermLink(link: TermLink): void {
    pushCapped(this.termLinks, link, LINK_CAPACITY)
  }

  addTaskLink(link: TaskLink): void {
    pushCapped(this.taskLinks, link, LINK_CAPACITY)
  }

  addChildTask(task: Task): void {
    pushCapped(this.childTasks, task, 32)
  }
}

/** 操作概念：Concept 的子类，term 是操作词项 */
export class OperationConcept extends Concept {
  /** 操作词项（如 shiftX） */
  readonly operation: OperationTerm

  /** NAL-9：心理操作 */
  readonly mental: boolean

  /** 这个操作概念自己的空间采样配置 */
  readonly sampling: OperationSampling

  /** 每个四叉树叶子已经记了几条操作句子 */
  private readonly leafCounts = new Map<string, number>()

  constructor(
    operation: OperationTerm,
    mental = false,
    sampling: OperationSampling = DEFAULT_OPERATION_SAMPLING,
  ) {
    // 操作概念要攒够覆盖整幅图的句子，信念表容量由采样配置决定
    super(operation, mental ? 'mental' : 'operation', sampling.beliefCapacity)
    this.operation = operation
    this.mental = mental
    this.sampling = sampling
  }

  /** 算子名，如 shiftX / readColor / consider */
  get operator(): string {
    return this.operation.operator
  }

  /** 这个叶子还能不能再收一条同类操作句子 */
  canRecordAt(x: number, y: number): boolean {
    const key = operationLeafKey(x, y, this.sampling.leafDepth)
    return (this.leafCounts.get(key) ?? 0) < this.sampling.leafCap
  }

  /** 记下这个叶子的操作句子数 */
  recordAt(x: number, y: number): void {
    const key = operationLeafKey(x, y, this.sampling.leafDepth)
    this.leafCounts.set(key, (this.leafCounts.get(key) ?? 0) + 1)
  }

  /** 兼容旧名 */
  canRecordShift(x: number, y: number): boolean {
    return this.canRecordAt(x, y)
  }

  /** 兼容旧名 */
  recordShift(x: number, y: number): void {
    this.recordAt(x, y)
  }

  /** 已经覆盖了多少个叶子 */
  get coveredLeaves(): number {
    return this.leafCounts.size
  }
}

/** 复合操作概念：term 是组合操作，children 是顺序调用的子操作 */
export class CompoundOperationConcept extends OperationConcept {
  readonly children: OperationConcept[]

  constructor(
    operation: OperationTerm,
    children: OperationConcept[],
    sampling: OperationSampling = DEFAULT_OPERATION_SAMPLING,
  ) {
    super(operation, false, sampling)
    this.children = children
  }
}

/** 心理操作概念（NAL-9）：仍是一种操作概念，只是算子由系统内部执行 */
export class MentalOperationConcept extends OperationConcept {
  constructor(operator: string) {
    super(new OperationTerm(operator), true)
  }
}

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0
  return Math.min(1, Math.max(0, value))
}

function pushCapped<T>(list: T[], item: T, capacity: number) {
  list.push(item)
  while (list.length > capacity) list.shift()
}
