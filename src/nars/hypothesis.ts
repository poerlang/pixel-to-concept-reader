// 竞争假设：同一个观察可以有多个解释；先按 NAL 的期望值 × 优先级排序，不直接选边。
import type { Term } from "./term.ts";
import { expectation, type Truth } from "./truth.ts";

export type Hypothesis = {
  term: Term;
  truth: Truth;
  priority: number;
  source: string;
};

/** 观测频率 → 真值；置信度固定为观察次数带来的弱证据。 */
export function frequencyTruth(success: number, total: number, confidence = 0.5): Truth {
  return { f: total > 0 ? success / total : 0.5, c: confidence };
}

/** 重复同一操作/性质：次数越多，置信度越高；f 固定为“这是同一模式”。 */
export function repetitionTruth(count: number): Truth {
  const n = Math.max(0, Math.floor(count));
  return { f: 0.9, c: 1 - Math.pow(0.5, n) };
}

export function rankHypotheses(hypotheses: Hypothesis[]): Hypothesis[] {
  return [...hypotheses].sort((a, b) =>
    expectation(b.truth) * b.priority - expectation(a.truth) * a.priority);
}
