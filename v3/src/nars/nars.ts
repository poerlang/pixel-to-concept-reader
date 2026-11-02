/**
 * NARS 内核：把「词项 → 概念 → 记忆」串起来。
 *
 * 当前默认计划仍是 shiftX → shiftY，但 step() 不再认识具体算子：
 *   - 算子由 OperationSpec 注册，只读 / 可写由 access 声明；
 *   - 默认计划由 OperationPlan 描述，复合操作按计划顺序执行；
 *   - 目标与成功判断走 Sensor 的观察词项，不写死黑 / 白；
 *   - 每个算子自己决定是否改坐标、产生什么事件、如何记录观察。
 *
 * region / span / ratio / quadrant / diff 等图像测量仍不在核心里计算：
 * 它们必须由后续的通用推理从操作与观察中派生。
 */

import { Attention } from './attention.ts'
import { Board } from './board.ts'
import {
  type Concept,
  CompoundOperationConcept,
  type ConceptKind,
  type OperationConcept,
  type OperationSampling,
} from './concept.ts'
import { Drive } from './drive.ts'
import { Memory, type MemoryView, type SpatialMemoryEntry } from './memory.ts'
import {
  createDefaultOperationRegistry,
  type OperationAccess,
  type OperationOutcome,
  type OperationPlan,
  type OperationSpec,
} from './operations.ts'
import { binaryColorSensor, termFromLabel } from './sensor.ts'
import {
  chooseAttentionTarget,
  DEFAULT_ATTENTION,
  normalizeAttention,
  type AttentionSettings,
} from './targeting.ts'
export type { AttentionSettings } from './targeting.ts'
import { runCycle, type CycleResult } from './cycle.ts'
import { derivePair, type Derivation, type RuleName } from './inference.ts'
import { Goal, Judgment, Question, sentenceKey, truthOf, type Sentence } from './sentence.ts'
import { OperationTerm, type Term } from './term.ts'
import { EvidentialBase, TruthValue } from './value.ts'

/** 信念：词项 + 真值（f 频率，c 置信度） */
export type Belief = {
  term: Term
  f: number
  c: number
}

/** 真值上限：f、c 都必须严格小于 1 */
const TRUTH_MAX = 1 - 1e-9

/** 信念记忆（按词项键存放）—— 信念层未实现，先留槽位 */
const beliefs = new Map<string, Belief>()

/** 记忆变化监听器 */
const updateListeners = new Set<() => void>()

/** 输入句子的证据序号 */
let inputStamp = 0

/** 订阅记忆变化，返回取消订阅函数 */
export function subscribe(_listener: () => void): () => void {
  throw new Error('TODO: 未实现 subscribe')
}

/** 输入一条判断；证据基每次递增，后续同陈述可被修订 */
export function tell(term: Term, f = 0.99, c = 0.9): void {
  inputStamp += 1
  const judgment = new Judgment(
    term,
    new TruthValue(f, c),
    '输入',
    undefined,
    new EvidentialBase([inputStamp]),
  )
  memory.addSentence(judgment)
  answerQuestions()
}

/** 提一个精确内容的问题；答案由同内容的信念/派生判断给出 */
export function ask(term: Term): Question {
  inputStamp += 1
  const question = new Question(
    term,
    '提问',
    undefined,
    new EvidentialBase([inputStamp]),
  )
  memory.addSentence(question)
  answerQuestions()
  return question
}

/* ------------------------------------------------------------------ */
/* 视野 / 操作                                                          */
/* ------------------------------------------------------------------ */

/** 视野：当前黑白画板；Sensor 负责把原始读数翻译成词项 */
const board = new Board()
const sensor = binaryColorSensor

/** 操作注册表：默认只有 shiftX / shiftY / readColor，可继续注册 */
const operations = createDefaultOperationRegistry(sensor)

/** 可用操作袋 */
const attention = new Attention()

/** 记忆：概念袋 */
const memory = new Memory()

/** 驱动力：目标强度 + 熟练度 → 引导度 */
const drive = new Drive()

/** 上一步用到的引导度（界面显示用） */
let lastGuidance = 0

/** 相对于本次观察起点的空间累积（不是画幅像素坐标） */
let relativeTotal = { x: 0, y: 0 }

/** 2D/3D 调试用的空间操作轨迹；只给显示，不进入记忆/推理 */
const trail: Array<{ x: number; y: number; dx: number; dy: number }> = []

/** 注意力/惯性/节能参数；只影响操作选择，不产生形状词项 */
let attentionSettings: AttentionSettings = { ...DEFAULT_ATTENTION }
const visitedTargets = new Set<string>()
let lastTargetDelta: { x: number; y: number } | null = null

export function attentionParams(): AttentionSettings {
  return { ...attentionSettings }
}

export function setAttentionParams(patch: Partial<AttentionSettings>): AttentionSettings {
  attentionSettings = normalizeAttention({ ...attentionSettings, ...patch })
  return attentionParams()
}

/**
 * 注册新的可执行算子。默认不改变现有 shift 计划；只有 activate 时才把它
 * 追加到当前计划里。真正的读写语义由 OperationSpec.execute 决定。
 */
export function registerOperation(
  spec: OperationSpec,
  options: { activate?: boolean } = {},
): void {
  operations.register(spec)
  if (options.activate) {
    const plan = operations.plan()
    operations.definePlan({ ...plan, children: [...plan.children, spec.operator] })
    resetOperations()
  }
}

/** 替换整个操作计划（例如把 shift 换成“观察 + 移动”的组合） */
export function setOperationPlan(plan: OperationPlan): void {
  operations.definePlan(plan)
  resetOperations()
}

/** 当前注册的算子（只读视图） */
export function operationSpecs(): readonly OperationSpec[] {
  return operations.list()
}

/** 当前操作计划（副本） */
export function operationPlan(): OperationPlan {
  return operations.plan()
}

/** NAL-9 心理操作（NARS-2025 附录 B.14）：参数受限、由系统内部执行 */
export const MENTAL_OPERATORS = [
  'satisfied',
  'novel',
  'busy',
  'healthy',
  'happy',
  'tell',
  'want',
  'ask',
  'query',
  'think',
  'observe',
  'consider',
] as const

/** 句子缓冲：同一个句子合并计数 */
const sentenceMap = new Map<string, { sentence: Sentence; count: number; order: number }>()

/** 句子种类上限 */
const SENTENCE_KINDS = 24

let sentenceOrder = 0
let stepCount = 0
let lastStep: StepRecord | null = null

/** 上一次扫描到的颜色；顺序对「上次 → 这次」由它生成 */

/** 目标词项（黑 / 白）；null = 没设目标 */
let goalTerm: Term | null = null

/** 目标概念在记忆里的 key */
let goalKey: string | null = null

/** 设目标时，记忆里本来就有这个概念吗 */
let goalFound = false

/** 上一步落在什么颜色上：用来判断「刚刚找到目标」 */
let lastSeen: string | null = null

/** 一步的记录（给界面看） */
export type StepRecord = {
  index: number
  /** 这一步实际做了什么，如 shift (0.30, 0.70) */
  operation: string
  /** 这一步计划的读写类型；混合计划按 write 计 */
  access: OperationAccess
  percept: string
  /** 位移（格），可为小数；只读操作为 0 */
  dx: number
  dy: number
  /** 落点浮点坐标 */
  x: number
  y: number
  column: number
  row: number
  /** 是不是追着目标跳过去的 */
  pursuit: boolean
}

/** 概念排序的一行 */
export type ConceptEntry = {
  rank: number
  key: string
  label: string
  kind: ConceptKind
  /** 句子数（信念 + 欲望 + 问题） */
  sentences: number
  /** 任务表条数 */
  tasks: number
  /** 任务链数 */
  links: number
  /** 排序用的活跃度 = 句子 + 任务链 */
  activity: number
  priority: number
  /** 概念自身 f / c */
  frequency: number
  confidence: number
  share: number
}

/** 句子排序的一行 */
export type SentenceEntry = {
  rank: number
  key: string
  text: string
  truth: string
  count: number
  share: number
}

/** 目标状态 */
export type GoalInfo = {
  label: string | null
  /** 设目标时记忆里已经有这个概念 */
  found: boolean
  /** 概念 key（界面用来高亮） */
  key: string | null
  /** 这个概念下已有多少条句子 */
  beliefs: number
}

/** 视野快照 */
export type BoardSnapshot = {
  side: number
  /** 像素格：1 = 黑（背景），0 = 白（笔画） */
  cells: number[][]
  /** 扫描头浮点坐标 */
  x: number
  y: number
  column: number
  row: number
  /** 扫描头脚下这一格：1 = 黑，0 = 白 */
  reading: 0 | 1
  stepCount: number
  /** 句子缓冲里的句子总数（界面「缓冲」） */
  bufferSize: number
  /** 记忆里的词项概念数（不含操作 / 心理操作概念） */
  conceptCount: number
  sentenceSize: number
  lastStep: StepRecord | null
}

/** 词项显示：shiftX / 黑 / 黑白 / {白黑, 黑白} */
export function formatTerm(term: Term): string {
  return term.format()
}

/** 按当前 OperationPlan 重建注意力区的复合操作概念 */
function resetOperations() {
  attention.clear()
  const plan = operations.plan()
  const childConcepts = plan.children.map((operator) =>
    memory.getOperationConcept(operator, operations.samplingFor(operator)),
  )
  const operation = new OperationTerm(plan.name)
  const sampling: OperationSampling = operations.samplingFor(plan.name)
  const existing = memory.getConcept(operation)
  const sameChildren =
    existing instanceof CompoundOperationConcept &&
    existing.children.length === childConcepts.length &&
    existing.children.every((child, index) => child.operator === childConcepts[index]?.operator)

  let concept: CompoundOperationConcept
  if (existing instanceof CompoundOperationConcept && sameChildren) {
    concept = existing
  } else {
    concept = new CompoundOperationConcept(operation, childConcepts, sampling)
    // 计划变更时替换旧复合概念，避免继续拿旧 children 执行
    const registered = memory.replaceConcept(concept)
    if (!(registered instanceof CompoundOperationConcept)) return
    concept = registered
  }
  attention.push(concept, concept.priority)
}

/** 一条句子：进概念（Memory）+ 进注意力缓冲（同句合并计数） */
function ingest(sentence: Sentence, parent?: Concept, anchor?: { x: number; y: number }) {
  memory.addSentence(sentence, parent, anchor)
  const key = sentenceKey(sentence)
  const existing = sentenceMap.get(key)
  if (existing) {
    existing.count += 1
    existing.sentence = sentence
    return
  }
  sentenceMap.set(key, { sentence, count: 1, order: sentenceOrder })
  sentenceOrder += 1
  if (sentenceMap.size > SENTENCE_KINDS) {
    let oldestKey: string | null = null
    let oldestOrder = Number.POSITIVE_INFINITY
    for (const [otherKey, record] of sentenceMap) {
      if (record.order < oldestOrder) {
        oldestOrder = record.order
        oldestKey = otherKey
      }
    }
    if (oldestKey) sentenceMap.delete(oldestKey)
  }
}

/* ------------------------------------------------------------------ */
/* 对外动作                                                             */
/* ------------------------------------------------------------------ */

/** 换一张视野图：扫描头归中、缓冲和记忆清空、目标保留 */
export function setBoardImage(pixels: Uint8Array) {
  board.setPixels(pixels)
  board.resetCursor()
  relativeTotal = { x: 0, y: 0 }
  trail.length = 0
  cycleLog.length = 0
  visitedTargets.clear()
  lastTargetDelta = null
  resetBuffer()
  memory.clear()
  attention.clear()
  // 传感器能读到的词项先建概念；观察句会继续累积
  for (const reading of sensor.readings) {
    memory.createConcept(reading, 512)
  }
  if (goalTerm) {
    const concept = memory.createConcept(goalTerm)
    goalKey = concept.key
    goalFound = false
    ingest(new Goal(goalTerm, new TruthValue(1, 0.9), '目标'))
  }
}

/** 清空句子缓冲与步数（记忆里的概念不动） */
export function resetBuffer() {
  sentenceMap.clear()
  stepCount = 0
  lastStep = null
  lastSeen = null
}

/** 清空记忆（目标也一起忘掉），操作概念重新就位 */
export function clearMemory() {
  memory.clear()
  attention.clear()
  drive.reset()
  lastGuidance = 0
  relativeTotal = { x: 0, y: 0 }
  trail.length = 0
  cycleLog.length = 0
  visitedTargets.clear()
  lastTargetDelta = null
  goalTerm = null
  goalKey = null
  goalFound = false
}

/**
 * 设目标：目标是任意可观察词项，不再限定黑 / 白。
 * 系统会去记忆里找这个概念——找到就记下「已有 n 条」，
 * 没有就先建一个空概念。设目标会同时把目标强度提起来。
 */
export function setGoal(color: '黑' | '白' | null): GoalInfo
export function setGoal(term: Term | null): GoalInfo
export function setGoal(goal: '黑' | '白' | Term | null): GoalInfo {
  if (goal === null) {
    goalTerm = null
    goalKey = null
    goalFound = false
    drive.setGoal(false)
    lastGuidance = 0
    return goalInfo()
  }
  const term = typeof goal === 'string' ? termFromLabel(goal, sensor) : goal
  goalTerm = term
  lastSeen = null
  drive.setGoal(true)
  const existing = memory.getConcept(term)
  const concept = existing ?? memory.createConcept(term)
  goalKey = concept.key
  goalFound = existing !== undefined
  ingest(new Goal(term, new TruthValue(1, 0.9), '目标'))
  return goalInfo()
}

/** 当前 Sensor 能读到的词项；界面用它生成目标选项 */
export function readableTerms(): Term[] {
  return [...sensor.readings]
}

/** 目标状态 */
export function goalInfo(): GoalInfo {
  return {
    label: goalTerm ? goalTerm.format() : null,
    found: goalFound,
    key: goalKey,
    beliefs: goalTerm ? memory.getConcept(goalTerm)?.sentenceCount ?? 0 : 0,
  }
}

/** 驱动力状态（界面显示） */
export type DriveInfo = {
  /** 目标强度 0..1 */
  goalStrength: number
  /** 当前计划里每个算子的熟练度 */
  skills: Record<string, number>
  /** 上一步的引导度 0..1 */
  guidance: number
}

/** 驱动力状态 */
export function driveInfo(): DriveInfo {
  const plan = operations.plan()
  const skills = Object.fromEntries(plan.children.map((operator) => [operator, drive.skillOf(operator)]))
  return {
    goalStrength: drive.goalStrength,
    skills,
    guidance: lastGuidance,
  }
}

/** 一次复合操作的结果（计划里的子操作都执行完） */
type CompoundOperationResult = {
  dx: number
  dy: number
  x: number
  y: number
  column: number
  row: number
  percept: Term
  pursuit: boolean
  success: boolean
  access: OperationAccess
  event: Term | null
}

/** 一条操作句子进概念；叶子满了就丢 */
function recordOperationSentence(
  concept: OperationConcept,
  spec: OperationSpec | undefined,
  outcome: OperationOutcome,
): void {
  if (!concept.canRecordAt(outcome.x, outcome.y)) return
  concept.recordAt(outcome.x, outcome.y)
  const content =
    spec?.record === 'observation'
      ? outcome.observation ?? outcome.operation
      : outcome.operation
  ingest(
    new Judgment(
      content,
      new TruthValue(1, 0.9),
      '动作',
      undefined,
      undefined,
      { x: outcome.x, y: outcome.y },
      outcome.value,
    ),
  )
}

/** 复合操作自己的节点（如 shift），没有额外观察 */
function recordPlanNode(concept: OperationConcept): void {
  if (!concept.canRecordAt(board.x, board.y)) return
  concept.recordAt(board.x, board.y)
  ingest(
    new Judgment(concept.operation, new TruthValue(1, 0.9), '动作', undefined, undefined, {
      x: board.x,
      y: board.y,
    }),
  )
}

/** 找到复合概念对应的计划；没有注册计划时退回 children 顺序 */
function planFor(concept: CompoundOperationConcept): OperationPlan {
  return (
    operations.planFor(concept.operator) ?? {
      name: concept.operator,
      children: concept.children.map((child) => child.operator),
    }
  )
}

/** 执行复合操作：计划里的孩子顺序执行，读写语义由各自的 OperationSpec 决定 */
function performCompoundOperation(
  concept: CompoundOperationConcept,
  plan: OperationPlan,
  targetPoint: { x: number; y: number } | null,
  goal: Term | null,
  guidance: number,
): CompoundOperationResult | null {
  const startX = board.x
  const startY = board.y
  const outcomes: OperationOutcome[] = []

  for (const child of concept.children) {
    const spec = operations.get(child.operator)
    if (!spec) return null
    const outcome = operations.executeOn(child.operation, board, {
      goal,
      guidance,
      targetPoint,
      rng: Math.random,
    })
    if (!outcome) return null
    recordOperationSentence(child, spec, outcome)
    outcomes.push(outcome)
  }
  if (!outcomes.length) return null

  const last = outcomes[outcomes.length - 1]!
  recordPlanNode(concept)

  // 成功以最后一个有观察的子操作为准；没有观察时才回退到当前格的 Sensor
  const finalReading = sensor.observe(board, board.x, board.y)
  const success =
    goal !== null &&
    (last.readings.length > 0
      ? last.success
      : finalReading !== null && finalReading.key === goal.key)
  const access: OperationAccess = outcomes.some((outcome) => outcome.access === 'write')
    ? 'write'
    : 'read'

  return {
    dx: board.x - startX,
    dy: board.y - startY,
    x: board.x,
    y: board.y,
    column: last.column,
    row: last.row,
    percept: last.observation ?? finalReading ?? last.percept,
    pursuit: targetPoint !== null || last.pursuit,
    success,
    access,
    event: operations.eventFor(plan, outcomes),
  }
}

/** 一步操作：执行当前计划、记录事件，再跑通用工作周期 */
export function step(): StepRecord | null {
  if (!attention.size) resetOperations()
  const concept = attention.take()
  if (!concept) return null
  attention.push(concept, concept.priority)
  if (!(concept instanceof CompoundOperationConcept)) return null

  const plan = planFor(concept)
  const conceptSkill = goalTerm
    ? Math.min(1, (memory.getConcept(goalTerm)?.sentenceCount ?? 0) / 12)
    : 0
  const trainable = plan.children.filter((operator) => {
    const spec = operations.get(operator)
    return spec !== undefined && spec.access === 'write' && spec.trainable !== false
  })
  const guidance = goalTerm === null ? 0 : drive.guidanceFor(trainable, conceptSkill)
  lastGuidance = guidance

  const attentionTarget =
    goalTerm === null && operations.needsTarget(plan)
      ? chooseAttentionTarget(
          board,
          visitedTargets,
          lastTargetDelta,
          attentionSettings,
          (x, y) => {
            const relX = relativeTotal.x + (x - board.x)
            const relY = relativeTotal.y + (y - board.y)
            let best = 0
            for (const entry of memory.queryLeaf(relX, relY)) {
              best = Math.max(
                best,
                entry.concept.priority * 0.5 + entry.concept.confidence * 0.5,
              )
            }
            return best
          },
        )
      : null
  const outcome = performCompoundOperation(concept, plan, attentionTarget, goalTerm, guidance)
  if (!outcome) return null

  lastTargetDelta = { x: outcome.dx, y: outcome.dy }

  if (goalTerm !== null) {
    for (const operator of trainable) drive.reinforce(operator, outcome.success)
  }

  relativeTotal = { x: relativeTotal.x + outcome.dx, y: relativeTotal.y + outcome.dy }
  const anchor = { x: relativeTotal.x, y: relativeTotal.y }
  // 计划事件（默认仍是 [shift dx dy]）带相对锚点进记忆
  if (outcome.event) {
    ingest(
      new Judgment(
        outcome.event,
        new TruthValue(1, 0.9),
        '动作',
        undefined,
        undefined,
        { x: outcome.x, y: outcome.y },
      ),
      undefined,
      anchor,
    )
  }
  // 通用工作周期：优先处理当前相对锚点附近的句子（2D bag）
  trail.push({ x: outcome.x, y: outcome.y, dx: outcome.dx, dy: outcome.dy })
  if (trail.length > 64) trail.shift()
  cycleOnce(relativeTotal)

  // 只在「刚达到目标」时加强目标
  if (goalTerm && outcome.percept.key === goalTerm.key && lastSeen !== goalTerm.key) {
    drive.raiseGoal()
  }
  lastSeen = outcome.percept.key
  concept.activate(outcome.success ? 0.02 : -0.01)

  stepCount += 1
  lastStep = {
    index: stepCount,
    operation: `${concept.operator} (${outcome.x.toFixed(2)}, ${outcome.y.toFixed(2)})`,
    access: outcome.access,
    percept: outcome.percept.format(),
    dx: outcome.dx * board.side,
    dy: outcome.dy * board.side,
    x: outcome.x,
    y: outcome.y,
    column: outcome.column,
    row: outcome.row,
    pursuit: outcome.pursuit,
  }
  return lastStep
}

/* ------------------------------------------------------------------ */
/* 通用推理                                                             */
/* ------------------------------------------------------------------ */

export type InferenceRecord = {
  rule: RuleName
  statement: string
  truth: string
  premises: [string, string]
}

function memoryBeliefs(): Judgment[] {
  const byKey = new Map<string, Judgment>()
  for (const concept of memory.concepts()) {
    for (const belief of concept.beliefTable) {
      const existing = byKey.get(belief.content.key)
      if (
        !existing ||
        belief.truth.confidence > existing.truth.confidence ||
        (belief.truth.confidence === existing.truth.confidence &&
          belief.truth.frequency > existing.truth.frequency)
      ) {
        byKey.set(belief.content.key, belief)
      }
    }
  }
  return [...byKey.values()]
}

/** 通用工作周期入口：概念袋 → 任务 → 信念 → 规则 */
const cycleLog: CycleResult[] = []

export function cycleOnce(focus: { x: number; y: number } | null = null): CycleResult | null {
  const record = runCycle(memory, focus)
  if (record) {
    cycleLog.push(record)
    if (cycleLog.length > 32) cycleLog.shift()
  }
  return record
}

/** 最近的工作周期记录（最新在前） */
export function cycleEntries(limit = 12): CycleResult[] {
  return cycleLog.slice(-limit).reverse()
}

/** 2D 调试用的扫描轨迹；不参与推理 */
export function scanTrail(): Array<{ x: number; y: number }> {
  return trail.map((point) => ({ x: point.x, y: point.y }))
}

/** 带位移的空间操作轨迹，给 2D/3D 做方向与差的可视化；不参与推理 */
export function operationTrace(): Array<{ x: number; y: number; dx: number; dy: number }> {
  return trail.map((point) => ({ ...point }))
}

/** 兼容旧名 */
export function shiftTrace(): Array<{ x: number; y: number; dx: number; dy: number }> {
  return operationTrace()
}

/** 连续跑若干工作周期；用于批处理和调试 */
export function runCycles(steps = 16): CycleResult[] {
  const records: CycleResult[] = []
  for (let index = 0; index < steps; index++) {
    const record = cycleOnce()
    if (record) records.push(record)
  }
  return records
}

/** 用当前记忆里的信念推一步；保留给批处理/规则测试 */
export function inferOnce(): InferenceRecord | null {
  const current = memoryBeliefs()
  for (let i = 0; i < current.length; i++) {
    for (let j = i + 1; j < current.length; j++) {
      for (const derivation of derivePair(current[i]!, current[j]!)) {
        const known = memory
          .getConcept(derivation.statement)
          ?.beliefTable.some((belief) => belief.content.key === derivation.statement.key)
        if (known) continue
        const judgment = new Judgment(
          derivation.statement,
          derivation.truth,
          '推理',
          undefined,
          derivation.evidence,
        )
        memory.addSentence(judgment)
        answerQuestions()
        return toRecord(derivation)
      }
    }
  }
  return null
}

function toRecord(derivation: Derivation): InferenceRecord {
  return {
    rule: derivation.rule,
    statement: derivation.statement.format(),
    truth: derivation.truth.format(),
    premises: derivation.premises,
  }
}

/** 问题目前只做精确内容匹配；继承/相似问题的反向推理以后再接入。 */
function answerQuestions(): void {
  for (const concept of memory.concepts()) {
    for (const question of concept.questionTable) {
      const target = memory.getConcept(question.content)
      question.solution = target?.getTruth() ?? null
    }
  }
}

/* ------------------------------------------------------------------ */
/* 快照                                                                 */
/* ------------------------------------------------------------------ */

/**
 * 概念排序：按概念里的句子数排（概念就是句子的容器），
 * 同句数按优先级。初始只有黑 / 白，所以允许 0 句的非操作概念上榜；
 * 操作 / 心理操作概念只有真正有句子时才出现。
 */
export function conceptEntries(limit = 10): ConceptEntry[] {
  const concepts = memory
    .snapshot()
    .concepts.filter(
      (concept) =>
        concept.activity > 0 || (concept.kind !== 'operation' && concept.kind !== 'mental'),
    )
  const sentenceCountOf = (concept: (typeof concepts)[number]) =>
    concept.counts.beliefs + concept.counts.desires + concept.counts.questions
  const kindRank = (kind: string) =>
    kind === 'operation' || kind === 'mental'
      ? 0
      : kind === 'sequence'
        ? 1
        : kind === 'statement' ||
            kind === 'set' ||
            kind === 'intersection' ||
            kind === 'difference'
          ? 2
          : 3
  const maxSentences = concepts.reduce((max, concept) => Math.max(max, sentenceCountOf(concept)), 1)
  const sorted = concepts.sort(
    (left, right) =>
      kindRank(left.kind) - kindRank(right.kind) ||
      sentenceCountOf(right) - sentenceCountOf(left) ||
      right.priority - left.priority ||
      left.complexity - right.complexity,
  )
  const visible = sorted.slice(0, limit)
  // 序列概念句数少、c 低，容易被高频操作概念挤出榜单；
  // 调试时至少保留一个序列槽位，便于观察它是否形成。
  const topSequence = sorted.find((concept) => concept.kind === 'sequence')
  if (limit > 0 && topSequence && !visible.some((concept) => concept.key === topSequence.key)) {
    if (visible.length >= limit) visible[visible.length - 1] = topSequence
    else visible.push(topSequence)
  }
  return visible.map((concept, index) => {
    const sentences = sentenceCountOf(concept)
    return {
      rank: index + 1,
      key: concept.key,
      label: concept.label,
      kind: concept.kind,
      sentences,
      tasks: concept.counts.tasks,
      links: concept.counts.taskLinks,
      activity: concept.activity,
      priority: concept.priority,
      frequency: concept.frequency,
      confidence: concept.confidence,
      share: sentences / maxSentences,
    }
  })
}

/** 句子缓冲排序：出现次数多的在前 */
export function sentenceEntries(): SentenceEntry[] {
  const records = [...sentenceMap.values()]
  const total = records.reduce((sum, record) => sum + record.count, 0)
  return records
    .sort((left, right) => right.count - left.count || left.order - right.order)
    .map((record, index) => ({
      rank: index + 1,
      key: sentenceKey(record.sentence),
      text: record.sentence.format(),
      truth: truthOf(record.sentence)?.format() ?? '—',
      count: record.count,
      share: total ? record.count / total : 0,
    }))
}

/** 视野 + 运行状态快照 */
export function boardSnapshot(): BoardSnapshot {
  const { column, row } = board.cellAt()
  let bufferSize = 0
  for (const record of sentenceMap.values()) bufferSize += record.count
  // 「概念排序」只列词项概念；shift 概念有句子时才一起算进来
  const conceptCount = memory
    .concepts()
    .filter(
      (concept) =>
        (concept.kind !== 'operation' && concept.kind !== 'mental') || concept.activity > 0,
    ).length
  return {
    side: board.side,
    cells: board.cells,
    x: board.x,
    y: board.y,
    column,
    row,
    reading: board.read(),
    stepCount,
    bufferSize,
    conceptCount,
    sentenceSize: sentenceMap.size,
    lastStep,
  }
}

/** 记忆快照：概念 → 句子表（界面按这个渲染树） */
export function memorySnapshot(): MemoryView {
  return memory.snapshot()
}

/** 记忆里的概念数 */
export function memoryConceptCount(): number {
  return memory.size
}

/** 2D bag 邻域查询：返回相对锚点附近的句子（不做区域/形状判定） */
export function spatialNeighbors(x: number, y: number, radius = 0.15): SpatialMemoryEntry[] {
  return memory.querySpace(x, y, radius)
}

/* ------------------------------------------------------------------ */
/* NAL-9：心理操作                                                      */
/* ------------------------------------------------------------------ */

/** 取 / 建一个心理操作概念（consider、think…） */
export function mentalOperation(operator: string): Concept {
  return memory.getMentalOperation(operator)
}

/**
 * NAL-9 的 consider(t)：提高由 t 标识的概念的优先级，
 * 让它在接下来的工作周期里更容易被选中。
 */
export function consider(term: Term): Concept | null {
  const concept = memory.getConcept(term)
  if (!concept) return null
  concept.activate(0.2)
  return concept
}

/* ------------------------------------------------------------------ */
/* 信念层（占位）                                                       */
/* ------------------------------------------------------------------ */

/** 当前信念快照 */
export function beliefList(): Belief[] {
  return Array.from(beliefs.values())
}

/** 查询某词项当前 c；记忆中没有则给极低值 */
export function confidenceOf(_term: Term): number {
  throw new Error('TODO: 未实现 confidenceOf')
}

/** 当前信念条数 */
export function size(): number {
  throw new Error('TODO: 未实现 size')
}

/** 清空记忆 */
export function clear(): void {
  throw new Error('TODO: 未实现 clear')
}

/** 监听器槽位（信念层用，暂未接出） */
export function listenerCount(): number {
  return updateListeners.size
}

/** 真值上限（信念层用） */
export function truthMax(): number {
  return TRUTH_MAX
}

/** 信念存储（信念层用） */
export function beliefCount(): number {
  return beliefs.size
}
