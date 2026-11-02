/**
 * 无框架冒烟测试：受控世界 + 注册表，检查“只读/可写/默认计划”三条路径。
 * 运行：node --experimental-strip-types tools/check-operations.ts
 */

import { Board } from '../src/nars/board.ts'
import {
  createDefaultOperationRegistry,
  executeOperation,
  type OperationOutcome,
  type OperationSpec,
} from '../src/nars/operations.ts'
import { OperationTerm } from '../src/nars/term.ts'
import { numberTerm } from '../src/nars/arithmetic.ts'
import {
  driveInfo,
  operationPlan,
  operationSpecs,
  setBoardImage,
  setGoal,
  setOperationPlan,
  step,
} from '../src/nars/index.ts'

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`FAIL: ${message}`)
}

function whiteBoard(): Uint8Array {
  return new Uint8Array(28 * 28).fill(255)
}

function customOutcome(term: OperationTerm): OperationOutcome {
  return {
    operation: term,
    access: 'write',
    readings: [],
    observation: null,
    percept: term,
    dx: 0,
    dy: 0,
    pursuit: false,
    success: false,
    x: 0.25,
    y: 0.75,
    column: 7,
    row: 21,
    value: null,
    event: new OperationTerm('nudge', [numberTerm(0.25), numberTerm(0.75)]),
  }
}

const board = new Board()
board.setPixels(whiteBoard())

const read = executeOperation(new OperationTerm('readColor'), board)
assert(read, 'readColor should execute')
assert(read.access === 'read', 'readColor must be read-only')
assert(read.dx === 0 && read.dy === 0, 'readColor must not move')
assert(read.observation?.format() === '白', 'white board should read 白')

const moved = executeOperation(new OperationTerm('shiftX'), board, { target: 1, rng: () => 1 })
assert(moved, 'shiftX should execute')
assert(moved.dx > 0.4, 'shiftX should jump to the target')
assert(moved.success === false, 'no goal means no success')

const registry = createDefaultOperationRegistry()
const nudge: OperationSpec = {
  operator: 'nudge',
  access: 'write',
  targetAxis: 'none',
  execute: ({ board: target }, term) => {
    target.jumpTo(0.25, 0.75)
    return customOutcome(term)
  },
}
registry.register(nudge)
const nudged = registry.executeOn(new OperationTerm('nudge'), board)
assert(nudged, 'registered write operation should execute')
assert(nudged.x === 0.25 && nudged.y === 0.75, 'custom operation should own its effect')

assert(operationPlan().children.join(',') === 'shiftX,shiftY', 'default plan must stay shiftX → shiftY')
assert(
  operationSpecs().some((spec) => spec.operator === 'readColor' && spec.access === 'read'),
  'readColor should be registered as a read operation',
)

setBoardImage(whiteBoard())
setGoal('白')
const record = step()
assert(record, 'default step should run')
assert(record.operation.startsWith('shift '), 'default step should still be the shift plan')
assert(record.access === 'write', 'default shift plan is writable')
assert(record.percept === '白', 'goal color should be observed')
assert(driveInfo().skills.shiftX > 0.2, 'successful goal step should train shiftX')

// 计划可以整体换成只读观察，step 不需要知道 readColor 的名字
setOperationPlan({ name: 'observeOnly', children: ['readColor'] })
const observed = step()
assert(observed, 'read-only plan should run')
assert(observed.access === 'read', 'read-only plan must not claim a write')
assert(observed.dx === 0 && observed.dy === 0, 'read-only plan must not move the cursor')
assert(observed.operation.startsWith('observeOnly '), 'step should use the registered plan name')

console.log('ok: read/write operations, custom registry entry, default shift plan preserved')
