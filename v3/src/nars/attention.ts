import { Bag } from './bag.ts'
import type { OperationConcept } from './concept.ts'

/**
 * 可用操作区：一次取一个操作概念来执行，执行完再放回去。
 * 默认计划是 shiftX / shiftY，但袋里放的是 OperationConcept，
 * 因此注册更多算子后不需要改这里；谁被取到由优先级随机决定。
 *
 * 注意袋里放的是 OperationConcept（概念），不是孤立的操作对象：
 * 操作的句子、任务链、优先级都留在概念里。
 */
export class Attention {
  private bag = new Bag<OperationConcept>(64)

  /** 送入一个操作概念；优先级越高越容易被取到 */
  push(concept: OperationConcept, priority = 0.5): OperationConcept {
    this.bag.put(concept, priority)
    return concept
  }

  /** 取出一个操作概念 */
  take(): OperationConcept | undefined {
    return this.bag.take()
  }

  /** 当前可用的操作数 */
  get size(): number {
    return this.bag.size
  }

  /** 清空 */
  clear(): void {
    this.bag.clear()
  }
}
