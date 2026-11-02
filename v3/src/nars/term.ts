/**
 * 词项层级（NARS-2025 第 6.1 节 + NAL-3 集合论复合词项）。
 *
 *   Term                  全系统唯一的 key、是否常量、句法复杂度
 *   ├ Atom                原子词项
 *   └ Compound            复合词项：连接符 + 成分列表 + 是否可交换
 *      ├ Statement        两个词项 + 系词（--> / <-> / ...）
 *      ├ OperationTerm    算子 + 参数（NAL-8 的操作词项）
 *      ├ SetExt           外延集合 {a, b}
 *      ├ SetInt           内涵集合 [a, b]
 *      ├ IntersectionExt  外延交 (a ∩ b)
 *      ├ IntersectionInt  内涵交 (a ∪ b)
 *      ├ DifferenceExt    外延差 (a − b)
 *      └ DifferenceInt    内涵差 (a ⊖ b)
 *
 * 本项目以 NAL-3 的复合词项为主；变量、关系、事件等更高层词项暂不引入。
 * 词项不引用概念；词项到概念的映射放在 Memory 里。
 */

/** 词项基类 */
export abstract class Term {
  /** 是否常量：未实现的变量词项会是 false */
  readonly isConstant: boolean = true

  /** 全系统唯一的键 */
  abstract get key(): string

  /** 句法复杂度：原子为 1 */
  abstract get complexity(): number

  /** 人话写法 */
  abstract format(): string

  /** 同 key 视为同词项 */
  equals(other: Term): boolean {
    return this.key === other.key
  }

  toString(): string {
    return this.format()
  }
}

/** 原子词项 */
export class Atom extends Term {
  readonly name: string

  constructor(name: string) {
    super()
    this.name = name
  }

  get key(): string {
    return this.name
  }

  get complexity(): number {
    return 1
  }

  format(): string {
    return this.name
  }
}

/** 按 key 去重、排序（交换律词项用） */
function uniqueSorted(components: Term[]): Term[] {
  const byKey = new Map<string, Term>()
  for (const component of components) {
    if (!byKey.has(component.key)) byKey.set(component.key, component)
  }
  return [...byKey.values()].sort((left, right) => (left.key < right.key ? -1 : left.key > right.key ? 1 : 0))
}

/** 复合词项：连接符 + 按顺序区分的成分 */
export class Compound extends Term {
  readonly connector: string
  readonly components: Term[]
  readonly isCommutative: boolean

  constructor(connector: string, components: Term[], isCommutative = false) {
    super()
    this.connector = connector
    this.isCommutative = isCommutative
    this.components = [...components]
    if (isCommutative) {
      this.components.sort((left, right) => (left.key < right.key ? -1 : left.key > right.key ? 1 : 0))
    }
  }

  get key(): string {
    return `${this.connector}(${this.components.map((component) => component.key).join(',')})`
  }

  get complexity(): number {
    return 1 + this.components.reduce((sum, component) => sum + component.complexity, 0)
  }

  format(): string {
    return `[${[this.connector, ...this.components.map((component) => component.format())].join(' ')}]`
  }
}

/** 由系词连接两个词项的陈述 */
export class Statement extends Compound {
  constructor(connector: string, subject: Term, predicate: Term) {
    super(connector, [subject, predicate])
  }

  get subject(): Term {
    return this.components[0]!
  }

  get predicate(): Term {
    return this.components[1]!
  }

  format(): string {
    return `<${this.subject.format()} ${this.connector} ${this.predicate.format()}>`
  }
}

/** 操作词项（NAL-8）：连接符是算子名，成分是参数 */
export class OperationTerm extends Compound {
  constructor(operator: string, args: Term[] = []) {
    super(operator, args)
  }

  get operator(): string {
    return this.connector
  }

  format(): string {
    // 本项目不再用 [shiftY 1] 这种带参数写法：无参数时直接显示 shiftY
    if (!this.components.length) return this.connector
    return `[${[this.connector, ...this.components.map((component) => component.format())].join(' ')}]`
  }
}

/**
 * 顺序对（本项目扫描用）：上一次看到的 → 这一次看到的，如 黑白。
 * 有顺序：黑白与白黑是两个不同词项；二者一起出现时可再合成无排序的集合。
 */
export class SequenceTerm extends Compound {
  constructor(components: Term[]) {
    if (components.length !== 2) throw new Error('顺序对需要两个成分')
    super('·', components)
  }

  format(): string {
    return this.components.map((component) => component.format()).join('')
  }
}

/* ------------------------------------------------------------------ */
/* NAL-3：集合论复合词项                                                */
/* ------------------------------------------------------------------ */

/** 外延集合 {T1, ..., Tn}：交换、去重 */
export class SetExt extends Compound {
  constructor(components: Term[]) {
    super('{}', uniqueSorted(components), true)
  }

  format(): string {
    return `{${this.components.map((component) => component.format()).join(', ')}}`
  }
}

/** 内涵集合 [T1, ..., Tn]：交换、去重 */
export class SetInt extends Compound {
  constructor(components: Term[]) {
    super('[]', uniqueSorted(components), true)
  }

  format(): string {
    return `[${this.components.map((component) => component.format()).join(', ')}]`
  }
}

/** 外延交 (T1 ∩ T2)：交换 */
export class IntersectionExt extends Compound {
  constructor(components: Term[]) {
    super('∩', uniqueSorted(components), true)
  }

  format(): string {
    return `(${this.components.map((component) => component.format()).join(' ∩ ')})`
  }
}

/** 内涵交 (T1 ∪ T2)：交换 */
export class IntersectionInt extends Compound {
  constructor(components: Term[]) {
    super('∪', uniqueSorted(components), true)
  }

  format(): string {
    return `(${this.components.map((component) => component.format()).join(' ∪ ')})`
  }
}

/** 外延差 (T1 − T2)：有顺序，恰好两个成分 */
export class DifferenceExt extends Compound {
  constructor(components: Term[]) {
    if (components.length !== 2) throw new Error('外延差需要两个成分')
    super('−', components)
  }

  format(): string {
    return `(${this.components[0]!.format()} − ${this.components[1]!.format()})`
  }
}

/** 内涵差 (T1 ⊖ T2)：有顺序，恰好两个成分 */
export class DifferenceInt extends Compound {
  constructor(components: Term[]) {
    if (components.length !== 2) throw new Error('内涵差需要两个成分')
    super('⊖', components)
  }

  format(): string {
    return `(${this.components[0]!.format()} ⊖ ${this.components[1]!.format()})`
  }
}

/* ------------------------------------------------------------------ */
/* 类型判断                                                             */
/* ------------------------------------------------------------------ */

/** 是否为原子词项 */
export function isAtom(term: Term): term is Atom {
  return term instanceof Atom
}

/** 是否为复合词项 */
export function isCompound(term: Term): term is Compound {
  return term instanceof Compound
}

/** 是否为操作词项 */
export function isOperationTerm(term: Term): term is OperationTerm {
  return term instanceof OperationTerm
}

/** 是否为 NAL-3 集合 / 交 / 差 */
export function isSet(term: Term): boolean {
  return term instanceof SetExt || term instanceof SetInt
}

/** 词项的种类（界面展示用） */
export type TermKind =
  | 'atom'
  | 'statement'
  | 'operation'
  | 'sequence'
  | 'set'
  | 'intersection'
  | 'difference'
  | 'compound'

export function termKind(term: Term): TermKind {
  if (term instanceof Atom) return 'atom'
  if (term instanceof Statement) return 'statement'
  if (term instanceof OperationTerm) return 'operation'
  if (term instanceof SequenceTerm) return 'sequence'
  if (term instanceof SetExt || term instanceof SetInt) return 'set'
  if (term instanceof IntersectionExt || term instanceof IntersectionInt) return 'intersection'
  if (term instanceof DifferenceExt || term instanceof DifferenceInt) return 'difference'
  if (term instanceof Compound) return 'compound'
  return 'atom'
}

/**
 * 词项的封装深度：原子 = 0，顺序对 = 1，集合（成分是顺序对）= 2……
 * 3D 场景按这个深度分层；无参数的 shiftX / shiftY 也算 0 层。
 */
export function termDepth(term: Term): number {
  if (term instanceof Atom) return 0
  if (term instanceof OperationTerm && term.components.length === 0) return 0
  if (term instanceof Compound) {
    if (!term.components.length) return 0
    return 1 + Math.max(...term.components.map(termDepth))
  }
  return 0
}

/** 词项的直接成分（原子没有） */
export function componentsOf(term: Term): Term[] {
  return term instanceof Compound ? term.components : []
}
