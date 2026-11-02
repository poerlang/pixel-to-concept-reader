/**
 * 感知通道：把“世界里的原始读数”翻译成词项。
 *
 * 操作只负责改变世界或读取世界，具体读到什么由 Sensor 决定。
 * 默认实现是黑底白笔画的黑白传感器；以后接入彩色/灰度/多通道画面时，
 * 只要注册新的 Sensor，不需要改 shift 或工作周期。
 */

import type { Board } from './board.ts'
import { Atom, type Term } from './term.ts'
import { Vocabulary } from './vocabulary.ts'

export interface Sensor {
  /** 这个传感器能产出的读数词项（按显示顺序） */
  readonly readings: readonly Term[]
  /** 读取 (x, y) 处的观察；没有可读值时返回 null */
  observe(board: Board, x: number, y: number): Term | null
  /** 观察词项 → 原始读数编码；未知词项返回 null */
  codeOf(term: Term): number | null
  /** 原始读数编码 → 观察词项；未知编码返回 null */
  termFor(code: number): Term | null
}

/** 黑白视野：1 = 黑（背景），0 = 白（笔画） */
export class BinaryColorSensor implements Sensor {
  readonly readings = [Vocabulary.black, Vocabulary.white] as const

  observe(board: Board, x: number, y: number): Term {
    return board.readRawAt(x, y) === 1 ? Vocabulary.black : Vocabulary.white
  }

  codeOf(term: Term): number | null {
    if (term.key === Vocabulary.black.key) return 1
    if (term.key === Vocabulary.white.key) return 0
    return null
  }

  termFor(code: number): Term | null {
    if (code === 1) return Vocabulary.black
    if (code === 0) return Vocabulary.white
    return null
  }

  /** 兼容旧 UI：按显示名找读数 */
  termForLabel(label: string): Term | null {
    return this.readings.find((term) => term.format() === label) ?? null
  }
}

/** 默认视觉通道 */
export const binaryColorSensor = new BinaryColorSensor()

/** 把显示名统一成词项；没有注册的传感器读数时退回 Atom */
export function termFromLabel(label: string, sensor: Sensor = binaryColorSensor): Term {
  return sensor.readings.find((term) => term.format() === label) ?? new Atom(label)
}
