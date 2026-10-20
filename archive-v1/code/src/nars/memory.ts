// 记忆：概念袋 + 概念内的信念/任务表 + 词项链（书A ch5-0029/0032、书B ch6-0149~0186）
//
// 概念由词项标识；一个句子的"家"是内容词项所标识的概念；它同时被内容里的每个词项链过去，
// 于是三段论需要的那两条信念（共享一个词项）可以从同一个词项链里找出来。
// 简化（写进 README）：任务只放在引擎缓冲里，概念内只放信念与待答问题。

import { Bag } from "./bag.ts";
import type { Sentence } from "./sentence.ts";
import { conceptKey, disjoint, judgment, mergeBase, tick } from "./sentence.ts";
import { atomsOf, components, hasVariable, instantiate, unify, type Term } from "./term.ts";
import { expectation, revision, type Truth } from "./truth.ts";

export class Concept {
  readonly term: Term;
  readonly beliefs = new Bag<Sentence>(16);
  readonly tasks = new Bag<Sentence>(8);
  priority = 0.5;
  durability = 0.9;
  quality = 0.5;

  constructor(term: Term) {
    this.term = term;
  }

  best(): Sentence | null {
    let best: Sentence | null = null;
    for (const belief of this.beliefs.all()) {
      if (!best || expectation(belief.truth) > expectation(best.truth)) best = belief;
    }
    return best;
  }
}

const simplicity = (term: Term): number => 1 / Math.pow(term.complexity, 0.3);

export class Memory {
  readonly concepts = new Map<string, Concept>();
  /** 词项链：词项 key → 内容里含该词项的概念 key */
  private readonly links = new Map<string, Set<string>>();
  private readonly asked = new Set<string>();

  concept(term: Term, create = true): Concept | null {
    const known = this.concepts.get(term.key);
    if (known) return known;
    if (!create) return null;
    const concept = new Concept(term);
    this.concepts.set(term.key, concept);
    for (const key of new Set([term.key, ...components(term).map((t) => t.key), ...atomsOf(term)])) {
      const bucket = this.links.get(key) ?? new Set<string>();
      bucket.add(term.key);
      this.links.set(key, bucket);
    }
    return concept;
  }

  /** 与这些词项相关的（内容里含它们的）概念 */
  related(terms: Term[]): Concept[] {
    const out: Concept[] = [];
    const seen = new Set<string>();
    for (const term of terms) {
      for (const key of this.links.get(term.key) ?? []) {
        if (seen.has(key)) continue;
        seen.add(key);
        const concept = this.concepts.get(key);
        if (concept) out.push(concept);
      }
    }
    return out;
  }

  /** 忘掉一个词项：删掉由它链到的所有概念（例如一帧的 256 条观察与 10 条相似判断）。
   *  只用于通道缓冲里的一次性经验，不动物类概念（它们只被类别原子链住）。 */
  forget(term: Term): number {
    const keys = new Set(this.links.get(term.key) ?? []);
    keys.add(term.key);
    let removed = 0;
    for (const key of keys) {
      const concept = this.concepts.get(key);
      if (!concept) continue;
      const linked = new Set([key, ...components(concept.term).map((t) => t.key), ...atomsOf(concept.term)]);
      for (const linkKey of linked) {
        const bucket = this.links.get(linkKey);
        if (!bucket) continue;
        bucket.delete(key);
        if (bucket.size === 0) this.links.delete(linkKey);
      }
      this.concepts.delete(key);
      this.asked.delete(key);
      removed++;
    }
    return removed;
  }

  /** 把判断放进记忆：同词项且证据不相交 → 修订；否则按容量放进信念表 */
  addBelief(sentence: Sentence): Sentence {
    const concept = this.concept(sentence.term)!;
    const existing = concept.beliefs.all().find((b) => b.term.key === sentence.term.key && disjoint(b.base, sentence.base));
    if (existing) {
      const merged = revision(existing.truth, sentence.truth);
      existing.truth = merged;
      existing.base = mergeBase(existing.base, sentence.base);
      existing.stamp = tick();
      existing.quality = Math.max(existing.quality, sentence.quality);
      existing.priority = Math.max(existing.priority, sentence.priority);
      this.notify(existing);
      return existing;
    }
    concept.beliefs.mergeKey(conceptKey(sentence), sentence, conceptKey);
    concept.priority = Math.max(concept.priority, sentence.priority);
    this.notify(sentence);
    return sentence;
  }

  /** 问句：找出一个解（变量问句靠绑定，非变量问句靠同词项信念） */
  ask(term: Term): { term: Term; truth: Truth } | null {
    let best: { term: Term; truth: Truth } | null = null;
    let bestScore = -1;
    const consider = (candidate: Sentence, bind: Map<string, Term>): void => {
      const instance = instantiate(term, bind) ?? candidate.term;
      const score = expectation(candidate.truth) * simplicity(instance);
      if (score > bestScore) {
        bestScore = score;
        best = { term: candidate.term, truth: candidate.truth };
      }
    };
    if (!hasVariable(term)) {
      const belief = this.concept(term, false)?.best() ?? null;
      return belief ? { term: belief.term, truth: belief.truth } : null;
    }
    for (const concept of this.related(components(term).filter((t) => !hasVariable(t)))) {
      for (const belief of concept.beliefs.all()) {
        const bind = new Map<string, Term>();
        if (unify(term, belief.term, bind)) consider(belief, bind);
      }
    }
    return best;
  }

  /** 新信念到达后，更新能与之合一的待答问题 */
  private notify(belief: Sentence): void {
    if (this.asked.size === 0) return;
    const keys = new Set([belief.term.key, ...atomsOf(belief.term)]);
    for (const key of keys) {
      for (const conceptKey2 of this.links.get(key) ?? []) {
        if (!this.asked.has(conceptKey2)) continue;
        const concept = this.concepts.get(conceptKey2);
        if (!concept) continue;
        for (const task of concept.tasks.all()) {
          if (task.punct !== "?") continue;
          const bind = new Map<string, Term>();
          if (!unify(task.term, belief.term, bind)) continue;
          const score = expectation(belief.truth);
          const current = task.solution ? expectation(task.solution) : -1;
          if (score > current) {
            task.solution = belief.truth;
            task.solutionTerm = instantiate(task.term, bind)?.key ?? belief.term.key;
          }
        }
      }
    }
  }

  /** 问题进入记忆：放在它自己的概念里，并立即找一次解 */
  addQuestion(sentence: Sentence): void {
    const concept = this.concept(sentence.term)!;
    concept.tasks.put(sentence);
    this.asked.add(concept.term.key);
    const answer = this.ask(sentence.term);
    if (answer) {
      sentence.solution = answer.truth;
      sentence.solutionTerm = answer.term.key;
    }
  }

  /** 输入判断（初始处理）：记成信念 */
  assert(term: Term, truth: Truth, base: number[], priority = 0.5): Sentence {
    return this.addBelief(judgment(term, truth, base, priority));
  }

  size(): number {
    return this.concepts.size;
  }

  /** 存盘：术语按 key 展开，概念只存信念与预算 */
  toJSON(): unknown {
    const terms = new Map<string, unknown>();
    const expand = (term: Term): void => {
      if (terms.has(term.key)) return;
      terms.set(term.key, {
        a: term.atom ? 1 : 0,
        v: term.variable ? 1 : 0,
        c: term.copula,
        s: (term.comps ?? []).map((t) => t.key),
      });
      for (const comp of term.comps ?? []) expand(comp);
    };
    const concepts: unknown[] = [];
    for (const concept of this.concepts.values()) {
      const beliefs = concept.beliefs.all();
      if (beliefs.length === 0) continue;
      expand(concept.term);
      concepts.push({
        t: concept.term.key,
        p: concept.priority,
        b: beliefs.map((b) => [b.truth.f, b.truth.c, b.priority, b.base]),
      });
    }
    return { terms: [...terms.entries()], concepts };
  }

  static fromJSON(data: { terms: Array<[string, { a: number; v: number; c?: string; s?: string[] }]>; concepts: Array<{ t: string; p: number; b: Array<[number, number, number, number[]]> }> }): Memory {
    const table = new Map(data.terms);
    const rebuild = (key: string): Term => {
      const raw = table.get(key)!;
      if (raw.a) return raw.v ? variableOf(key) : atomOf(key);
      const comps = (raw.s ?? []).map(rebuild);
      return compoundOf(raw.c!, comps, raw.c === "↔");
    };
    const memory = new Memory();
    for (const saved of data.concepts) {
      const term = rebuild(saved.t);
      const concept = memory.concept(term)!;
      concept.priority = saved.p;
      for (const [f, c, priority, base] of saved.b) {
        concept.beliefs.put(judgment(term, { f, c }, base, priority));
      }
    }
    return memory;
  }
}

// 只给 fromJSON 用的最小构造器（避免循环 import）
import { atom as atomOf, variable as variableOf, compound as compoundOf } from "./term.ts";
