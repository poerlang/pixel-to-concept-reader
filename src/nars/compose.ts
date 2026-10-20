// NAL-3 复合规则（交集引入）：M→T1、M→T2 ⇒ M→(T1∩T2)。
// 只实现交集引入；真值按书A 表 7.3 的强函数：f=f1·f2，c=c1·c2。
import type { Sentence } from "./sentence.ts";
import { inheritance, intersection, type Term } from "./term.ts";
import type { Truth } from "./truth.ts";

function contains(term: Term, part: Term): boolean {
  if (term.key === part.key) return true;
  return (term.comps ?? []).some((child) => contains(child, part));
}

/** 交集消去（分析真理）：(A∩B)→A、(A∩B)→B。 */
export function decomposeIntersection(term: Term): Array<{ term: Term; truth: Truth }> {
  if (term.copula !== "∩" || !term.comps || term.comps.length < 2) return [];
  return term.comps.map((part) => ({ term: inheritance(term, part), truth: { f: 1, c: 1 } }));
}

export function composeIntersection(first: Sentence, second: Sentence): { term: Term; truth: Truth } | null {
  if (first.term.copula !== "→" || second.term.copula !== "→") return null;
  const [subjectA, predicateA] = first.term.comps as [Term, Term];
  const [subjectB, predicateB] = second.term.comps as [Term, Term];
  if (subjectA.key !== subjectB.key) return null;
  if (predicateA.key === predicateB.key) return null;
  if (contains(predicateA, predicateB) || contains(predicateB, predicateA)) return null;
  return {
    term: inheritance(subjectA, intersection([predicateA, predicateB])),
    truth: { f: first.truth.f * second.truth.f, c: first.truth.c * second.truth.c },
  };
}
