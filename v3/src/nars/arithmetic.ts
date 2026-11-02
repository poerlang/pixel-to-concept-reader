/**
 * 通用算术操作：difference / ratio / sum / average。
 *
 * 这里不引入独立的 Quantity 类型；数就是 Narsese 词项（数可以作词项），
 * 操作是 OperationTerm，结果是另一个数词项。工作周期只有在遇到一个
 * “问这个操作”的任务时才调用它，因此是否使用由任务/推理决定。
 *
 * 这不是 truth function：不要把它塞进修订/演绎的真值计算里。
 */

import type { Term } from './term.ts'
import { Atom, OperationTerm } from './term.ts'

export type ArithmeticOperator = 'difference' | 'ratio' | 'sum' | 'average'

export const ARITHMETIC_OPERATORS: ArithmeticOperator[] = [
  'difference',
  'ratio',
  'sum',
  'average',
]

function formatNumber(value: number): string {
  if (!Number.isFinite(value)) return 'NaN'
  const rounded = Math.round(value * 1e6) / 1e6
  return String(Object.is(rounded, -0) ? 0 : rounded)
}

/** 数词项就是可解析的原子；不额外造一个数值类 */
export function numberOf(term: Term): number | null {
  if (!(term instanceof Atom)) return null
  const value = Number(term.name)
  return Number.isFinite(value) ? value : null
}

export function numberTerm(value: number): Atom {
  return new Atom(formatNumber(value))
}

export function isArithmeticOperation(term: Term): term is OperationTerm {
  if (!(term instanceof OperationTerm)) return false
  if (!ARITHMETIC_OPERATORS.includes(term.operator as ArithmeticOperator)) return false
  if (term.operator === 'difference' || term.operator === 'ratio') {
    return term.components.length === 2 && term.components.every((component) => numberOf(component) !== null)
  }
  return term.components.length >= 2 && term.components.every((component) => numberOf(component) !== null)
}

/**
 * 执行一个算术操作，返回数词项。
 * ratio 的分母为 0 时返回 null，而不是伪造一个 0 结果。
 */
export function evaluateArithmetic(term: Term): Atom | null {
  if (!isArithmeticOperation(term)) return null
  const values = term.components.map((component) => numberOf(component))
  if (values.some((value) => value === null)) return null
  const numbers = values as number[]
  if (term.operator === 'difference') return numberTerm(numbers[0]! - numbers[1]!)
  if (term.operator === 'ratio') {
    return numbers[1] === 0 ? null : numberTerm(numbers[0]! / numbers[1]!)
  }
  const sum = numbers.reduce((total, value) => total + value, 0)
  if (term.operator === 'sum') return numberTerm(sum)
  return numberTerm(sum / numbers.length)
}

export function arithmeticOperation(
  operator: 'difference' | 'ratio',
  left: Term,
  right: Term,
): OperationTerm {
  return new OperationTerm(operator, [left, right])
}

/** sum / average 可以接受两个以上数词项 */
export function arithmeticAggregate(
  operator: 'sum' | 'average',
  terms: Term[],
): OperationTerm {
  return new OperationTerm(operator, terms)
}

