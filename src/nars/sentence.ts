// 句子：判断（.）或问题（?），带真值、证据基础与预算（书A ch5-0003、书B ch6-0079~0112）

import type { Term } from "./term.ts";
import type { Truth } from "./truth.ts";

export type Punct = "." | "?";

export type Sentence = {
  term: Term;
  punct: Punct;
  truth: Truth;
  /** 证据基础：推出它的那些输入句子的序号。两份证据有交集时不得修订（书A ch4-0032） */
  base: number[];
  /** 内部时钟 */
  stamp: number;
  priority: number;
  durability: number;
  quality: number;
  /** 问句：目前最好的解（判断的真值），以及它绑定出来的词项 */
  solution?: Truth;
  solutionTerm?: string;
  /** 产生/处理这条句子的功能实例 id（同一个 term 可以由很多实例并行处理） */
  instance?: string;
  /** 合并多个实例证据时保留的来源 id（可选） */
  sources?: string[];
};

let clock = 0;
export const tick = (): number => ++clock;

/** 质量 q = gmean(s, b)：s 是句法简单度（1/n^r），b 是确定性（书B ch7-0086~0089） */
export function quality(term: Term, truth: Truth): number {
  const simplicity = 1 / Math.pow(term.complexity, 0.3);
  const certainty = Math.max(truth.c, 2 * Math.abs(truth.f - 0.5));
  return Math.sqrt(simplicity * certainty);
}

export function judgment(term: Term, truthValue: Truth, base: number[], priority = 0.5, instance?: string): Sentence {
  return {
    term,
    punct: ".",
    truth: truthValue,
    base,
    stamp: tick(),
    priority,
    durability: 0.8,
    quality: quality(term, truthValue),
    instance,
    sources: instance ? [instance] : undefined,
  };
}

export function question(term: Term, priority = 0.9, instance?: string): Sentence {
  return {
    term,
    punct: "?",
    truth: { f: 0.5, c: 0.01 },
    base: [tick()],
    stamp: tick(),
    priority,
    durability: 0.9,
    quality: quality(term, { f: 0.5, c: 0.01 }),
    instance,
    sources: instance ? [instance] : undefined,
  };
}

export function disjoint(a: number[], b: number[]): boolean {
  for (const id of a) if (b.includes(id)) return false;
  return true;
}

export function mergeBase(a: number[], b: number[], limit = 8): number[] {
  const merged = [...new Set([...a, ...b])];
  return merged.slice(0, limit);
}

/** 同名（同词项）的句子放在同一个概念里：概念键就是内容词项的 key */
export const conceptKey = (sentence: Sentence): string => sentence.term.key;
