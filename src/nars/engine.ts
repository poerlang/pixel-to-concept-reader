// 引擎：一个工作周期 = 选一个任务 → 从词项链里选信念 → 逐条规则试 → 结论入记忆（书A ch5-0052、书B ch7-0027）
//
// v2（本程）：学习模式（learn）下，派生结论不再只存相似判断：
//   · 观察判断先入信念表（初始处理，书A ch5-0005），否则"观察 → 类别性质"的类比没有前提；
//   · 所有与问题相关或能描述类别的派生判断落盘，并按"证据基础不相交"修订（书A ch4-0020/0032）；
//   · 预算按书B ch7-0108/0109 计算：p' = or(and(p_T,p_B), q')，d' = and(or(d_T,d_B), q')。
// 测试模式（learn=false）保持 v1 的边界：只落盘相似判断，避免一次观察把类别原型改脏。
//
// 证据基础只取**这次观察**（HANDOFF §2.1）：原型里的训练样本不是"这一帧"的新证据，
// 若并进结论，同一帧的两次比较会共享基础，修订被禁止。

import { Bag } from "./bag.ts";
import type { Memory } from "./memory.ts";
import { composeIntersection } from "./compose.ts";
import { RULES, applyRule } from "./rules.ts";
import { judgment, quality, tick, type Sentence } from "./sentence.ts";
import { components, hasVariable, type Term } from "./term.ts";
import type { Truth } from "./truth.ts";

const and = (...xs: number[]): number => xs.reduce((a, b) => a * b, 1);
const or = (...xs: number[]): number => 1 - xs.reduce((a, b) => a * (1 - b), 1);

export type TraceEvent = {
  kind: "rule" | "compose";
  rule: string;
  task: Term;
  belief: Term;
  conclusion: Term;
  truth: Truth;
  /** 处理这次派生的功能实例 id（同 term 的多个实例可并行工作） */
  instanceId?: string;
};

export type EngineOptions = {
  /** 学习模式：观察入信念表，派生结论落盘。默认 false（测试只读）。 */
  learn?: boolean;
  /** 哪些原子是“类别”；引擎本身不知道具体类别名。 */
  isCategory?: (term: Term) => boolean;
  /** 可选的 NAL-3 交集引入；默认关闭，避免组合爆炸。 */
  compose?: boolean;
  /** 交集引入的注意预算：一次运行最多引入多少条复合；默认 32。 */
  composeLimit?: number;
  /** 只读推理轨迹：每次规则/交集派生时调用，用来做可视化或审计。 */
  trace?: (event: TraceEvent) => void;
  /** 这个引擎代表的功能实例 id；不改变 term 语义，只用于并行调度与溯源。 */
  instanceId?: string;
};

export type Usage = {
  term: Term;
  count: number;
  truth: Truth;
};

/** 哪些派生判断值得落盘：相似判断；以及“个体→类别”（回答）与“类别→性质”（修订原型）两类继承。 */
function persistable(term: Term, isCategory: (candidate: Term) => boolean): boolean {
  if (hasVariable(term)) return false;
  if (term.copula === "↔") return true;
  if (term.copula !== "→") return false;
  const [subject, predicate] = term.comps as [Term, Term];
  if (!subject.atom) return false;
  if (predicate.atom) return isCategory(predicate);
  if (predicate.copula === "[]") return isCategory(subject);
  return false;
}

export class Engine {
  readonly memory: Memory;
  readonly buffer = new Bag<Sentence>(2048);
  readonly learn: boolean;
  readonly isCategory: (term: Term) => boolean;
  readonly compose: boolean;
  readonly composeLimit: number;
  readonly trace?: (event: TraceEvent) => void;
  readonly instanceId?: string;
  /** 本次工作周期里每个概念被用到多少次（给测试报告/概念排行用，只读统计） */
  readonly used = new Map<string, Usage>();
  /** 由交集引入产生的复合词项（训练侧用来统计经验，不参与读出）。 */
  readonly composedTerms = new Map<string, Truth>();
  steps = 0;
  derived = 0;
  composed = 0;
  private readonly composedKeys = new Set<string>();

  constructor(memory: Memory, options: EngineOptions = {}) {
    this.memory = memory;
    this.learn = options.learn ?? false;
    this.isCategory = options.isCategory ?? (() => false);
    this.compose = options.compose ?? false;
    this.composeLimit = Math.max(0, options.composeLimit ?? 32);
    this.trace = options.trace;
    this.instanceId = options.instanceId;
  }

  private use(term: Term, truth: Truth): void {
    const known = this.used.get(term.key);
    if (known) {
      known.count++;
      if (truth.c > known.truth.c) known.truth = truth;
    } else {
      this.used.set(term.key, { term, count: 1, truth });
    }
  }

  /** 输入判断：初始处理记成信念，同时作为任务进缓冲（书A ch5-0005） */
  accept(term: Parameters<typeof judgment>[0], truth: Truth, priority = 0.5, instance = this.instanceId): Sentence {    const sentence = judgment(term, truth, [tick()], priority, instance);
    this.memory.addBelief(sentence);
    this.buffer.put(sentence);
    return sentence;
  }

  /** 感觉观察：测试模式只作为任务；学习模式按初始处理先记成信念（书A ch5-0005） */
  feed(term: Parameters<typeof judgment>[0], truth: Truth, priority = 0.6, instance = this.instanceId): void {
    const sentence = judgment(term, truth, [tick()], priority, instance);
    if (this.learn) this.memory.addBelief(sentence);
    this.buffer.put(sentence);
  }

  /** 清空本轮复合预算；每个新图形可以重新引入有限个 ∩。 */
  resetComposition(): void {
    this.composed = 0;
    this.composedKeys.clear();
    this.composedTerms.clear();
  }

  /** 工作周期 */
  step(): boolean {
    const task = this.buffer.select();
    if (!task) return false;
    this.steps++;
    if (task.punct === "?") return true;
    this.use(task.term, task.truth);
    // 交集引入是事件缓冲上的操作：当前任务与其它待处理观察共享主项时，引入复合。
    if (this.compose && this.composed < this.composeLimit) {
      for (const other of this.buffer.all()) {
        if (this.composed >= this.composeLimit) break;
        if (other === task || other.punct === "?") continue;
        const composed = composeIntersection(task, other) ?? composeIntersection(other, task);
        if (!composed || this.composedKeys.has(composed.term.key)) continue;
        this.composedKeys.add(composed.term.key);
        this.composedTerms.set((composed.term.comps as Term[])[1]!.key, composed.truth);
        this.trace?.({ kind: "compose", rule: "∩", task: task.term, belief: other.term, conclusion: composed.term, truth: composed.truth, instanceId: this.instanceId });
        const derived = judgment(composed.term, composed.truth, [...task.base], 0.5, this.instanceId);
        // 复合结论作为临时信念 + 任务继续参与推理；调用方在问完这一帧后 forget(frame)。
        this.memory.addBelief(derived);
        this.buffer.put(derived);
        this.use(composed.term, composed.truth);
        this.composed++;
        this.derived++;
      }
    }
    const candidates = this.memory
      .related([task.term, ...components(task.term)])
      .map((concept) => concept.best())
      .filter((belief): belief is Sentence => !!belief && belief.term.key !== task.term.key);
    for (const belief of candidates) {
      this.use(belief.term, belief.truth);
      for (const rule of RULES) {
        const conclusion = applyRule(rule, task, belief);
        if (!conclusion) continue;
        this.trace?.({ kind: "rule", rule: rule.id, task: task.term, belief: belief.term, conclusion: conclusion.term, truth: conclusion.truth, instanceId: this.instanceId });
        // 只取这次观察的证据基础（HANDOFF §2.1）
        const derived = judgment(conclusion.term, conclusion.truth, [...task.base], 0.6, this.instanceId);
        // 预算：书B ch7-0108/0109
        const q = quality(conclusion.term, conclusion.truth);
        derived.quality = q;
        derived.priority = or(and(task.priority, belief.priority), q);
        derived.durability = and(or(task.durability, belief.durability), q);
        const keep = this.learn
          ? persistable(conclusion.term, this.isCategory)
          : conclusion.term.copula === "↔" && !hasVariable(conclusion.term);
        if (keep || persistable(conclusion.term, this.isCategory)) this.use(conclusion.term, conclusion.truth);
        if (keep) this.memory.addBelief(derived);
        this.derived++;
      }
    }
    return true;
  }

  run(limit = 4000): number {
    let done = 0;
    while (done < limit && this.step()) done++;
    return done;
  }
}
