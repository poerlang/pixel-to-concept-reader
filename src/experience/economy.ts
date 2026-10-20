// AIKR 经济：概念要付“复杂度租金”，靠复用/预测/压缩赚钱。
//
// 这不是语义权重：租金只看句法复杂度；收入只看使用次数、问句答案、∩ 复用。
// 低收益概念会被衰减/删除；预算有限，不保证任何具体概念存活。

import type { Engine } from "../nars/engine.ts";
import type { Memory } from "../nars/memory.ts";
import type { Sentence } from "../nars/sentence.ts";
import type { Term } from "../nars/term.ts";
import { expectation } from "../nars/truth.ts";
import type { SpreadAnswer } from "./spread.ts";

const RENT = 0.08;
const DECAY = 0.002;
const MIN_PRIORITY = 0.04;
const MAX_CONCEPTS = 600;
const EXPLORATION_EVERY = 7;

const clamp = (value: number): number => Math.max(0, Math.min(1, value));

const hasIntersection = (term: Term): boolean =>
  term.copula === "∩" || (term.comps ?? []).some((part) => hasIntersection(part));

export class Economy {
  private readonly reuse = new Map<string, number>();
  private readonly prediction = new Map<string, number>();
  private readonly seen = new Map<string, number>();
  dropped = 0;
  reinforced = 0;
  private cycles = 0;

  /** 从引擎使用记录和问句答案里收收入。 */
  observe(engine: Engine, spreads: SpreadAnswer[]): void {
    for (const [key, usage] of engine.used) {
      const before = this.seen.get(key) ?? 0;
      if (usage.count > before) this.reuse.set(key, (this.reuse.get(key) ?? 0) + usage.count - before);
      this.seen.set(key, usage.count);
    }
    for (const answer of spreads) {
      if (!answer.answer) continue;
      const key = answer.answer.key;
      if (answer.truth) this.prediction.set(key, (this.prediction.get(key) ?? 0) + expectation(answer.truth));
    }
  }

  /** 一个经验步后收租、衰减、淘汰；返回本轮删掉多少概念。 */
  step(memory: Memory): number {
    this.cycles++;
    const beliefs = memory.beliefs();
    const byKey = new Map<string, Sentence[]>();
    for (const belief of beliefs) {
      const list = byKey.get(belief.term.key) ?? [];
      list.push(belief);
      byKey.set(belief.term.key, list);
    }

    const candidates = [...memory.concepts.values()];
    let dropped = 0;
    for (const concept of candidates) {
      const key = concept.term.key;
      const evidence = byKey.get(key)?.reduce((best, belief) => Math.max(best, expectation(belief.truth)), 0) ?? 0;
      const reuse = this.reuse.get(key) ?? 0;
      const prediction = this.prediction.get(key) ?? 0;
      const compression = hasIntersection(concept.term) && reuse > 0 ? 0.5 : 0;
      const income = evidence * (0.2 + Math.log1p(reuse) + prediction + compression);
      const cost = RENT * Math.max(1, concept.term.complexity);
      const target = clamp(income / Math.max(1e-6, income + cost));
      const next = clamp(concept.priority * 0.9 + target * 0.1 - DECAY);
      concept.priority = next;
      if (next < MIN_PRIORITY && reuse === 0) {
        memory.drop(concept.term);
        dropped++;
      }
    }

    // 有限概念预算：低优先级先走。
    const alive = [...memory.concepts.values()].sort((a, b) => a.priority - b.priority);
    while (alive.length > MAX_CONCEPTS) {
      const concept = alive.shift()!;
      memory.drop(concept.term);
      dropped++;
    }

    // 探索：偶尔给低优先级概念一点机会，不被完全饿死。
    if (this.cycles % EXPLORATION_EVERY === 0) {
      const pool = [...memory.concepts.values()].sort((a, b) => a.priority - b.priority).slice(0, 3);
      for (const concept of pool) {
        concept.priority = clamp(Math.max(concept.priority, 0.25));
        this.reinforced++;
      }
    }

    this.dropped += dropped;
    return dropped;
  }
}
