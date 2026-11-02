/**
 * 记忆（NARS-2025 第 6.3 节末）：
 *
 *   Memory
 *   ├ conceptBag    概念袋：key（词项）→ Concept
 *   ├ getConcept    按词项取概念
 *   ├ createConcept 建概念；操作词项建 OperationConcept，复合词项会与各成分概念互建词项链
 *   ├ createMentalOperation  NAL-9 心理操作概念
 *   └ addSentence   句子 → 它内容所标识的概念；并在成分概念 / 操作概念上加任务链
 *
 * 概念之间不直接嵌套：嵌套关系体现在「概念由词项命名 → 词项可以有成分 →
 * 成分各有自己的概念，彼此用词项链相连」。
 */

import {
  Concept,
  DEFAULT_OPERATION_SAMPLING,
  MentalOperationConcept,
  OperationConcept,
  Task,
  TaskLink,
  TermLink,
  type ConceptKind,
  type OperationSampling,
} from './concept.ts'
import { type Sentence, truthOf } from './sentence.ts'
import { SpatialBag } from './spatial.ts'
import { OperationTerm, Statement, componentsOf, termKind, type Term } from './term.ts'

/** 一条句子的展示形式（同句已合并计数） */
export type SentenceView = {
  text: string
  truth: string
  punct: string
  /** 推理来源：像素 / 动作 / 目标 */
  source: string
  count: number
}

/** 一条句子的空间实例（3D 场景按 x/y 放点） */
export type SentenceInstance = {
  key: string
  text: string
  truth: string
  punct: string
  source: string
  x: number
  y: number
  /** 空间操作的 -1..1 绝对坐标 */
  value: number | null
}

/** 一个概念的展示形式 */
export type ConceptView = {
  key: string
  label: string
  kind: ConceptKind
  /** 封装深度（3D 分层用） */
  depth: number
  complexity: number
  isConstant: boolean
  priority: number
  /** 概念自身的 f / c（OpenNARS 修正累积） */
  frequency: number
  confidence: number
  /** 最近一次被研究模式研究的步数 */
  lastStudiedAt: number
  /** 句子数 + 任务链数 */
  activity: number
  counts: {
    tasks: number
    beliefs: number
    desires: number
    questions: number
    taskLinks: number
  }
  sentences: SentenceView[]
  /** 每个带位置的句子实例（不合并；3D 用） */
  instances: SentenceInstance[]
  /** 研究模式下挂到本概念的操作子句 */
  childTasks: string[]
  /** 词项的直接成分（复合词项才有） */
  components: string[]
  /** 词项链：↓成分 / ↑含它的复合词项 */
  links: string[]
}

/** 整棵记忆的展示形式 */
export type MemoryView = {
  conceptCount: number
  sentenceCount: number
  taskCount: number
  concepts: ConceptView[]
}

/** 2D bag 中的一条空间记忆：句子本身 + 它所属概念 */
export type SpatialMemoryEntry = {
  concept: Concept
  sentence: Sentence
}

export class Memory {
  /** 概念袋：词项 key → 概念 */
  readonly conceptBag = new Map<string, Concept>()

  /** 2D bag：按相对空间锚点索引，供工作周期做邻域查询 */
  readonly spatial = new SpatialBag<SpatialMemoryEntry>(2048)

  /** 句子的相对锚点（不是画幅像素坐标） */
  private readonly anchors = new Map<string, { x: number; y: number }>()

  /** 概念数 */
  get size(): number {
    return this.conceptBag.size
  }

  /** 所有概念里的任务数 */
  get taskCount(): number {
    let total = 0
    for (const concept of this.conceptBag.values()) total += concept.taskTable.length
    return total
  }

  /** 所有概念里的句子数 */
  get sentenceCount(): number {
    let total = 0
    for (const concept of this.conceptBag.values()) total += concept.sentenceCount
    return total
  }

  /** 按词项取概念 */
  getConcept(term: Term): Concept | undefined {
    return this.conceptBag.get(term.key)
  }

  /** 建概念：操作词项建 OperationConcept；复合词项会与每个成分概念互建词项链 */
  createConcept(term: Term, beliefCapacity?: number): Concept {
    const existing = this.conceptBag.get(term.key)
    if (existing) return existing

    const concept =
      term instanceof OperationTerm
        ? new OperationConcept(term)
        : new Concept(term, termKind(term), beliefCapacity)
    this.conceptBag.set(term.key, concept)

    const components = componentsOf(term)
    components.forEach((component, index) => {
      const componentConcept = this.getConcept(component) ?? this.createConcept(component)
      concept.addTermLink(new TermLink(component, false, [index]))
      componentConcept.addTermLink(new TermLink(term, true, [index]))
    })
    return concept
  }

  /** 注册运行台手工建好的特殊概念（例如复合操作计划） */
  registerConcept(concept: Concept): Concept {
    const existing = this.conceptBag.get(concept.key)
    if (existing) return existing
    this.conceptBag.set(concept.key, concept)
    return concept
  }

  /** 替换一个已注册概念（操作计划变更时使用） */
  replaceConcept(concept: Concept): Concept {
    this.conceptBag.set(concept.key, concept)
    return concept
  }

  /** 取一个算子概念；没有就按采样配置建 OperationConcept */
  getOperationConcept(
    operator: string,
    sampling: OperationSampling = DEFAULT_OPERATION_SAMPLING,
  ): OperationConcept {
    const term = new OperationTerm(operator)
    const existing = this.conceptBag.get(term.key)
    // 正常情况下操作概念由 resetOperations 先建好；万一已有同名普通概念，就沿用它
    if (existing) return existing as OperationConcept
    const concept = new OperationConcept(term, false, sampling)
    this.conceptBag.set(term.key, concept)
    return concept
  }

  /** NAL-9：取一个心理操作概念；没有就建 MentalOperationConcept */
  getMentalOperation(operator: string): Concept {
    const term = new OperationTerm(operator)
    const existing = this.conceptBag.get(term.key)
    if (existing) return existing
    const concept = new MentalOperationConcept(operator)
    this.conceptBag.set(term.key, concept)
    return concept
  }

  /**
   * 收一条句子：
   * 1. 放进它内容所标识的概念（按标点进任务/信念/欲望/问题表）
   * 2. 在内容各成分的概念上挂一条任务链
   * 3. 若内容是「操作 --> 动作」这类陈述，再在算子概念上挂一条任务链
   */
  addSentence(
    sentence: Sentence,
    parent?: Concept,
    anchor?: { x: number; y: number },
  ): Concept {
    const concept = this.getConcept(sentence.content) ?? this.createConcept(sentence.content)
    const task = new Task(sentence)
    concept.addTask(task)
    // 研究模式：父概念挂一条操作子句，形成概念 → 操作子句的记忆树边
    if (parent && parent !== concept) parent.addChildTask(task)
    if (anchor) {
      const truth = truthOf(sentence)
      const key = `${sentence.key}|${sentence.creationTime}`
      this.anchors.set(key, anchor)
      this.spatial.put({
        key,
        x: anchor.x,
        y: anchor.y,
        span: 0,
        priority: truth ? truth.frequency * truth.confidence : sentence.budget.priority,
        data: { concept, sentence },
      })
    }

    for (const component of componentsOf(sentence.content)) {
      const componentConcept = this.getConcept(component) ?? this.createConcept(component)
      componentConcept.addTaskLink(new TaskLink(task))
    }

    if (sentence.content instanceof Statement && sentence.content.subject instanceof OperationTerm) {
      const subjectConcept = this.getConcept(sentence.content.subject)
      const operatorConcept = this.getOperationConcept(sentence.content.subject.operator)
      // 无参数的算子词项（如 [consider]）本身就是算子概念，别重复挂链
      if (operatorConcept !== subjectConcept) operatorConcept.addTaskLink(new TaskLink(task))
    }
    return concept
  }

  /** 全部概念 */
  concepts(): Concept[] {
    return [...this.conceptBag.values()]
  }

  /** 清空 */
  clear(): void {
    this.conceptBag.clear()
    this.spatial.clear()
    this.anchors.clear()
  }

  /** 查询某个相对锚点附近的句子（2D bag） */
  querySpace(x: number, y: number, radius: number): SpatialMemoryEntry[] {
    return this.spatial
      .queryCircle(x, y, radius)
      .map((entry) => entry.data)
      .filter(({ concept, sentence }) => {
        const same = (items: Sentence[]) =>
          items.some(
            (item) => item.creationTime === sentence.creationTime && item.key === sentence.key,
          )
        return (
          same(concept.beliefTable) ||
          same(concept.desireTable) ||
          same(concept.questionTable)
        )
      })
  }

  /** 查询与相对锚点同一四叉树叶的记忆（2D bag 自己的局部范围） */
  queryLeaf(x: number, y: number): SpatialMemoryEntry[] {
    return this.spatial
      .queryLeaf(x, y)
      .map((entry) => entry.data)
      .filter(({ concept, sentence }) => {
        const same = (items: Sentence[]) =>
          items.some(
            (item) => item.creationTime === sentence.creationTime && item.key === sentence.key,
          )
        return (
          same(concept.beliefTable) ||
          same(concept.desireTable) ||
          same(concept.questionTable)
        )
      })
  }

  /** 句子的相对锚点；没有空间记忆则返回 null */
  anchorOf(sentence: Sentence): { x: number; y: number } | null {
    return this.anchors.get(`${sentence.key}|${sentence.creationTime}`) ?? null
  }

  /** 给界面用的快照 */
  snapshot(): MemoryView {
    const concepts = this.concepts().map((concept) => this.viewOf(concept))
    const sentenceCount = concepts.reduce(
      (sum, concept) => sum + concept.counts.beliefs + concept.counts.desires + concept.counts.questions,
      0,
    )
    const taskCount = concepts.reduce((sum, concept) => sum + concept.counts.tasks, 0)
    return { conceptCount: concepts.length, sentenceCount, taskCount, concepts }
  }

  private viewOf(concept: Concept): ConceptView {
    const grouped = new Map<string, SentenceView>()
    const all = [...concept.beliefTable, ...concept.desireTable, ...concept.questionTable]
    const instances: SentenceInstance[] = []
    for (const sentence of all) {
      const existing = grouped.get(sentence.key)
      if (existing) {
        existing.count += 1
      } else {
        grouped.set(sentence.key, {
          text: sentence.format(),
          truth: truthOf(sentence)?.format() ?? '—',
          punct: sentence.punctuation,
          source: sentence.source,
          count: 1,
        })
      }
      if (sentence.placement) {
        instances.push({
          key: `${sentence.key}|${sentence.creationTime}`,
          text: sentence.format(),
          truth: truthOf(sentence)?.format() ?? '—',
          punct: sentence.punctuation,
          source: sentence.source,
          x: sentence.placement.x,
          y: sentence.placement.y,
          value: sentence.value,
        })
      }
    }

    return {
      key: concept.term.key,
      label: concept.term.format(),
      kind: concept.kind,
      depth: concept.depth,
      complexity: concept.term.complexity,
      isConstant: concept.term.isConstant,
      priority: concept.priority,
      frequency: concept.frequency,
      confidence: concept.confidence,
      lastStudiedAt: concept.lastStudiedAt,
      activity: concept.activity,
      counts: {
        tasks: concept.taskTable.length,
        beliefs: concept.beliefTable.length,
        desires: concept.desireTable.length,
        questions: concept.questionTable.length,
        taskLinks: concept.taskLinks.length,
      },
      sentences: [...grouped.values()].sort((left, right) => right.count - left.count),
      instances,
      childTasks: concept.childTasks
        .map((task) => task.sentence)
        .filter((sentence) => sentence.content instanceof OperationTerm)
        .map((sentence) => {
          const position = sentence.placement
            ? ` @ (${sentence.placement.x.toFixed(2)}, ${sentence.placement.y.toFixed(2)})`
            : ''
          const span = sentence.value === null ? '' : ` · span ${sentence.value.toFixed(2)}`
          return `${sentence.content.format()}${position}${span}`
        }),
      components: componentsOf(concept.term).map((component) => component.format()),
      links: concept.termLinks.map((link) => link.format()),
    }
  }
}
