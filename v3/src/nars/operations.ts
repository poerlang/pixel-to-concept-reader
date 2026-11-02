import { numberTerm } from './arithmetic.ts'
import type { Board } from './board.ts'
import {
  DEFAULT_OPERATION_SAMPLING,
  type OperationSampling,
} from './concept.ts'
import { binaryColorSensor, type Sensor } from './sensor.ts'
import { OperationTerm, type Term } from './term.ts'

/** 操作是只读还是可写；只读操作不改变世界，但仍会产生观察句 */
export type OperationAccess = 'read' | 'write'

/** 画幅上的目标点（视野单位 0..1） */
export type OperationTarget = { x: number; y: number }

/** 一次操作执行的结果：旧字段保留给 2D/3D 调试，新字段给通用调度 */
export type OperationOutcome = {
  /** 实际执行的操作词项（含参数） */
  operation: OperationTerm
  access: OperationAccess
  /** 这次操作产生的全部观察；只读操作也至少有一条 */
  readings: Term[]
  /** 最后一条观察，等价于 percept */
  observation: Term | null
  /** 实际位移（视野单位 0..1，浮点） */
  dx: number
  dy: number
  /** 落点读到的东西；没有观察时退回操作词项，保证 UI 有可显示文本 */
  percept: Term
  /** 是不是「跟着目标走」的这一步 */
  pursuit: boolean
  /** 走完之后目标是否达成 */
  success: boolean
  /** 落点浮点坐标 */
  x: number
  y: number
  /** 落点所在格 */
  column: number
  row: number
  /** 这次操作的绝对坐标，-1..1；只读操作或无数值参数时为 null */
  value: number | null
  /** 这次操作自己的事件词项；由计划统一生成时为 null */
  event: Term | null
}

/** 执行参数；target 是旧 API，targetPoint 是通用坐标目标 */
export type OperationOptions = {
  /** 目标词项，或旧 API 的 0/1 颜色编码 */
  goal?: Term | 0 | 1 | null
  /** 引导度 0..1：越大越跟着目标走，越小越随机 */
  guidance?: number
  /** 旧 API：直接指定一个轴的绝对坐标 0..1 */
  target?: number
  /** 通用 API：给操作一个二维目标点 */
  targetPoint?: OperationTarget | null
  /** 可注入随机源，便于测试 */
  rng?: () => number
}

/** 操作执行时看到的世界和能力，不绑定具体算子 */
export type OperationContext = {
  board: Board
  sensor: Sensor
  goal: Term | null
  guidance: number
  targetPoint: OperationTarget | null
  targetValue: number | null
  rng: () => number
}

/** 一个算子的可插拔定义 */
export type OperationSpec = {
  operator: string
  access: OperationAccess
  /** 当前默认 shift 计划是否包含它 */
  inDefaultPlan?: boolean
  /** 二维目标如何投影到这个算子；none 表示不需要坐标目标 */
  targetAxis?: 'x' | 'y' | 'both' | 'none'
  /** 是否参与 Drive 的熟练度训练；默认 write 才训练 */
  trainable?: boolean
  /** 记录这次操作时写操作词项，还是写观察词项 */
  record?: 'operation' | 'observation'
  /** 空间句子采样配置；省略则用默认 shift 配置 */
  sampling?: Partial<OperationSampling>
  execute(context: OperationContext, term: OperationTerm): OperationOutcome | null
}

/** 复合操作计划：默认 shift 仍按 shiftX → shiftY 执行 */
export type OperationPlan = {
  name: string
  children: string[]
  /** 整个计划的事件词项；默认 shift 仍是 [shift dx dy] */
  event?: (outcomes: OperationOutcome[]) => Term | null
}

function goalTermOf(
  goal: Term | 0 | 1 | null | undefined,
  sensor: Sensor,
): Term | null {
  if (goal === null || goal === undefined) return null
  if (typeof goal === 'number') return sensor.termFor(goal)
  return goal
}

function makeOutcome(
  term: OperationTerm,
  access: OperationAccess,
  fields: Omit<OperationOutcome, 'operation' | 'access' | 'readings' | 'observation' | 'percept'> & {
    reading?: Term | null
  },
): OperationOutcome {
  const { reading = null, ...rest } = fields
  return {
    operation: term,
    access,
    readings: reading ? [reading] : [],
    observation: reading,
    percept: reading ?? term,
    ...rest,
  }
}

/** 默认 shift 事件：保持 [shift dx dy] 不变 */
function shiftEvent(outcomes: OperationOutcome[]): Term {
  const dx = outcomes.reduce((sum, outcome) => sum + outcome.dx, 0)
  const dy = outcomes.reduce((sum, outcome) => sum + outcome.dy, 0)
  return new OperationTerm('shift', [numberTerm(dx), numberTerm(dy)])
}

/** shiftX / shiftY 的共享实现 */
function createShiftSpec(operator: 'shiftX' | 'shiftY'): OperationSpec {
  const axis = operator === 'shiftX' ? 'x' : 'y'
  return {
    operator,
    access: 'write',
    inDefaultPlan: true,
    targetAxis: axis,
    trainable: true,
    record: 'operation',
    sampling: {
      leafDepth: 4,
      leafCap: 2,
      beliefCapacity: 512,
    },
    execute(context, term) {
      const { board, sensor, goal, guidance, targetPoint, targetValue, rng } = context
      const goalCode = goal ? sensor.codeOf(goal) : null
      const startX = board.x
      const startY = board.y

      let pursuit = false
      let target: number | null = targetValue
      if (target === null && targetPoint) {
        target = axis === 'x' ? targetPoint.x : targetPoint.y
        pursuit = true
      }
      if (target === null && goalCode !== null && rng() < guidance) {
        const hits = board.searchPixels().filter((item) => item.data.value === goalCode)
        if (hits.length > 0) {
          // 优先选另一轴离当前位置最近的像素
          let best = hits[0]!
          let bestDistance = Number.POSITIVE_INFINITY
          for (const hit of hits) {
            const distance =
              axis === 'x'
                ? Math.abs(hit.y - board.y) * 2 + Math.abs(hit.x - board.x)
                : Math.abs(hit.x - board.x) * 2 + Math.abs(hit.y - board.y)
            if (distance < bestDistance) {
              bestDistance = distance
              best = hit
            }
          }
          target = axis === 'x' ? best.x : best.y
          pursuit = true
        }
      }
      if (target === null) target = rng()
      target = Math.min(1, Math.max(0, target))

      if (axis === 'x') board.jumpTo(target, board.y)
      else board.jumpTo(board.x, target)

      const { column, row } = board.cellAt()
      const reading = sensor.observe(board, board.x, board.y)
      const success = goal !== null && reading !== null && reading.key === goal.key

      return makeOutcome(term, 'write', {
        reading,
        dx: board.x - startX,
        dy: board.y - startY,
        pursuit,
        success,
        x: board.x,
        y: board.y,
        column,
        row,
        value: target * 2 - 1,
        event: null,
      })
    },
  }
}

/** 只读观察：读当前格的颜色，不移动扫描头 */
function createReadColorSpec(): OperationSpec {
  return {
    operator: 'readColor',
    access: 'read',
    inDefaultPlan: false,
    targetAxis: 'none',
    trainable: false,
    record: 'observation',
    sampling: {
      leafDepth: 4,
      leafCap: 1,
      beliefCapacity: 64,
    },
    execute(context, term) {
      const { board, sensor, goal } = context
      const reading = sensor.observe(board, board.x, board.y)
      const { column, row } = board.cellAt()
      const success = goal !== null && reading !== null && reading.key === goal.key
      return makeOutcome(term, 'read', {
        reading,
        dx: 0,
        dy: 0,
        pursuit: false,
        success,
        x: board.x,
        y: board.y,
        column,
        row,
        value: null,
        event: null,
      })
    },
  }
}

/** 操作注册表：新算子只要注册 execute，不需要改 nars.step 的分支 */
export class OperationRegistry {
  private readonly specs = new Map<string, OperationSpec>()
  private currentPlan: OperationPlan = { name: 'shift', children: [] }
  readonly sensor: Sensor

  constructor(sensor: Sensor = binaryColorSensor) {
    this.sensor = sensor
  }

  register(spec: OperationSpec): this {
    if (this.specs.has(spec.operator)) {
      throw new Error(`operation already registered: ${spec.operator}`)
    }
    this.specs.set(spec.operator, spec)
    return this
  }

  get(operator: string): OperationSpec | undefined {
    return this.specs.get(operator)
  }

  list(): OperationSpec[] {
    return [...this.specs.values()]
  }

  terms(): Term[] {
    return this.list().map((spec) => new OperationTerm(spec.operator))
  }

  definePlan(plan: OperationPlan): this {
    if (!plan.name) throw new Error('operation plan needs a name')
    if (!plan.children.length) throw new Error('operation plan needs at least one child')
    for (const operator of plan.children) {
      if (!this.specs.has(operator)) {
        throw new Error(`operation plan references unknown operator: ${operator}`)
      }
    }
    this.currentPlan = { ...plan, children: [...plan.children] }
    return this
  }

  plan(): OperationPlan {
    return { ...this.currentPlan, children: [...this.currentPlan.children] }
  }

  planFor(name: string): OperationPlan | null {
    return this.currentPlan.name === name ? this.plan() : null
  }

  samplingFor(operator: string): OperationSampling {
    return {
      ...DEFAULT_OPERATION_SAMPLING,
      ...(this.specs.get(operator)?.sampling ?? {}),
    }
  }

  needsTarget(plan: OperationPlan = this.currentPlan): boolean {
    return plan.children.some((operator) => {
      const axis = this.specs.get(operator)?.targetAxis
      return axis === 'x' || axis === 'y' || axis === 'both'
    })
  }

  targetAxisOf(operator: string): 'x' | 'y' | 'both' | 'none' {
    return this.specs.get(operator)?.targetAxis ?? 'none'
  }

  /** 执行：把 board 和参数一起交给算子 */
  executeOn(
    term: Term,
    board: Board,
    options: OperationOptions = {},
  ): OperationOutcome | null {
    if (!(term instanceof OperationTerm)) return null
    const spec = this.specs.get(term.operator)
    if (!spec) return null
    const context: OperationContext = {
      board,
      sensor: this.sensor,
      goal: goalTermOf(options.goal, this.sensor),
      guidance: options.guidance ?? 0,
      targetPoint: options.targetPoint ?? null,
      targetValue: options.target ?? null,
      rng: options.rng ?? Math.random,
    }
    return spec.execute(context, term)
  }

  eventFor(plan: OperationPlan, outcomes: OperationOutcome[]): Term | null {
    if (plan.event) return plan.event(outcomes)
    // 没有计划级事件时，允许最后一个算子提供自己的事件
    for (let index = outcomes.length - 1; index >= 0; index -= 1) {
      const event = outcomes[index]?.event
      if (event) return event
    }
    return null
  }
}

/** 默认计划：shiftX → shiftY；事件仍是 [shift dx dy] */
export function createDefaultOperationRegistry(
  sensor: Sensor = binaryColorSensor,
): OperationRegistry {
  const registry = new OperationRegistry(sensor)
  registry.register(createShiftSpec('shiftX'))
  registry.register(createShiftSpec('shiftY'))
  registry.register(createReadColorSpec())
  const children = registry
    .list()
    .filter((spec) => spec.inDefaultPlan)
    .map((spec) => spec.operator)
  registry.definePlan({
    name: 'shift',
    children,
    event: shiftEvent,
  })
  return registry
}

/** 默认注册表；兼容旧 API 使用 */
export const defaultOperationRegistry = createDefaultOperationRegistry(binaryColorSensor)

/** 可用操作：注册表里所有算子（含只读 readColor） */
export function availableOperations(registry: OperationRegistry = defaultOperationRegistry): Term[] {
  return registry.terms()
}

/** 算子是否可执行 */
export function isExecutable(
  term: Term,
  registry: OperationRegistry = defaultOperationRegistry,
): boolean {
  return term instanceof OperationTerm && registry.get(term.operator) !== undefined
}

/** 操作的目标轴；只读/无目标算子返回 null */
export function operationAxis(
  term: Term,
  registry: OperationRegistry = defaultOperationRegistry,
): 'x' | 'y' | 'both' | null {
  if (!(term instanceof OperationTerm)) return null
  const axis = registry.targetAxisOf(term.operator)
  return axis === 'none' ? null : axis
}

/** 旧入口：执行一个操作；内部走默认注册表 */
export function executeOperation(
  term: Term,
  board: Board,
  options: OperationOptions = {},
  registry: OperationRegistry = defaultOperationRegistry,
): OperationOutcome | null {
  return registry.executeOn(term, board, options)
}
