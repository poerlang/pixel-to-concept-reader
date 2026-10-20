// 多观察答案合并：同一陈述的多个答案，在证据基础不相交时用 revision 合并。
// 通用控制，不认识具体类别/帧/像素。
import { disjoint, judgment, mergeBase, tick, type Sentence } from "./sentence.ts";
import type { Term } from "./term.ts";
import { revision, type Truth } from "./truth.ts";

export type Answer = {
  term: Term;
  truth: Truth;
  base?: number[];
  priority?: number;
};

export function mergeAnswers(answers: Answer[]): Sentence[] {
  const merged = new Map<string, Sentence>();
  for (const answer of answers) {
    const sentence = judgment(answer.term, answer.truth, answer.base ?? [tick()], answer.priority ?? 0.5);
    const known = merged.get(answer.term.key);
    if (!known) {
      merged.set(answer.term.key, sentence);
      continue;
    }
    if (!disjoint(known.base, sentence.base)) continue;
    merged.set(answer.term.key, judgment(
      answer.term,
      revision(known.truth, sentence.truth),
      mergeBase(known.base, sentence.base),
      Math.max(known.priority, sentence.priority),
    ));
  }
  return [...merged.values()];
}
