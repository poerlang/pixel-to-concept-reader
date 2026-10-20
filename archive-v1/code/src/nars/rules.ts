// 推理规则表（书A 附录 B 表 B.1、ch4 表 4.7；书B ch7-0049~0060）
//
// 规则只写"两条前提共享一个词项、结论在另两个词项之间"的模式，
// 具体能触发哪些规则由**前提的形式结构**决定（数据驱动，书A ch5-0054）。
// 同一对前提可以触发多条规则 —— 这是书里明说的（附录 B appB-0004）。

import type { Sentence } from "./sentence.ts";
import type { Term } from "./term.ts";
import { hasVariable, inheritance, isStatement, similarity, unify, variable } from "./term.ts";
import { abduction, analogy, comparison, deduction, exemplification, induction, resemblance, type Truth } from "./truth.ts";

export type VarName = "S" | "P" | "M";
export type Clause = { copula: "→" | "↔"; left: VarName; right: VarName };

export type Rule = {
  id: string;
  name: string;
  p1: Clause;
  p2: Clause;
  concl: Clause;
  truth: (t1: Truth, t2: Truth) => Truth;
};

const inh = (left: VarName, right: VarName): Clause => ({ copula: "→", left, right });
const sim = (left: VarName, right: VarName): Clause => ({ copula: "↔", left, right });

/** 表 B.1 的一阶三段论 + NAL-2 的相似规则（强/弱由真值函数自带的上界区分） */
export const RULES: Rule[] = [
  { id: "ded", name: "演绎", p1: inh("M", "P"), p2: inh("S", "M"), concl: inh("S", "P"), truth: deduction },
  { id: "ind", name: "归纳", p1: inh("M", "P"), p2: inh("M", "S"), concl: inh("S", "P"), truth: induction },
  { id: "abd", name: "溯因", p1: inh("P", "M"), p2: inh("S", "M"), concl: inh("S", "P"), truth: abduction },
  { id: "exe", name: "例证", p1: inh("P", "M"), p2: inh("M", "S"), concl: inh("S", "P"), truth: exemplification },
  { id: "com", name: "比较", p1: inh("S", "M"), p2: inh("P", "M"), concl: sim("S", "P"), truth: comparison },
  { id: "ana", name: "类比", p1: sim("S", "M"), p2: inh("M", "P"), concl: inh("S", "P"), truth: analogy },
  // 表 6.2 类比的另一版本：相似词项出现在继承前提的主项位置。
  // 例：S→[M] 与 S↔P 得 P→[M]（这是"观察修订类别性质"的那一步）。
  { id: "ana2", name: "类比(同主项)", p1: inh("M", "P"), p2: sim("M", "S"), concl: inh("S", "P"), truth: analogy },
  { id: "res", name: "相似", p1: sim("S", "M"), p2: sim("M", "P"), concl: sim("S", "P"), truth: resemblance },
];

type Assignment = [Term, Term];

/** 一个陈述的所有"左/右"摆法：相似对称，两种都要试 */
function assignments(term: Term): Assignment[] {
  if (!isStatement(term)) return [];
  const [a, b] = term.comps as [Term, Term];
  return term.copula === "↔" ? [[a, b], [b, a]] : [[a, b]];
}

function matchClause(clause: Clause, pair: Assignment, term: Term, bind: Map<string, Term>): boolean {
  if (term.copula !== clause.copula) return false;
  if (!unify(variable(clause.left), pair[0], bind)) return false;
  return unify(variable(clause.right), pair[1], bind);
}


/** 按绑定把结论拼出来（变量都在前提里绑好了，这里只是查找） */
function build(clause: Clause, bind: Map<string, Term>): Term | null {
  const left = bind.get(`?${clause.left}`);
  const right = bind.get(`?${clause.right}`);
  if (!left || !right) return null;
  return clause.copula === "↔" ? similarity(left, right) : inheritance(left, right);
}

/** 两条前提能触发这条规则吗？能就给出结论与真值 */
export function applyRule(rule: Rule, first: Sentence, second: Sentence): { term: Term; truth: Truth } | null {
  for (const [a, b] of [[first, second], [second, first]] as Array<[Sentence, Sentence]>) {
    for (const pa of assignments(a.term)) {
      for (const pb of assignments(b.term)) {
        const bind = new Map<string, Term>();
        if (!matchClause(rule.p1, pa, a.term, bind)) continue;
        if (!matchClause(rule.p2, pb, b.term, bind)) continue;
        const term = build(rule.concl, bind);
        if (!term || hasVariable(term)) continue;
        if (term.key === a.term.key || term.key === b.term.key) continue;
        if (term.copula === "→" && term.comps![0]!.key === term.comps![1]!.key) continue;
        return { term, truth: rule.truth(a.truth, b.truth) };
      }
    }
  }
  return null;
}
