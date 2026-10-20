// 蔓延求同：不做全配对，只从当前观察出发，向记忆问几个 NAL 问题。
//
// 问题都是普通 Narsese 变量问句，例如：
//   thing_0 → ?p        “它有什么性质？”
//   ?e → moving         “谁也有这个性质？”
//   thing_0 ↔ ?e        “谁和它相似？”
//
// 每次只问有限的几个问题；答案由记忆里已有信念给出，不额外生成全组合。

import type { Memory } from "../nars/memory.ts";
import { question } from "../nars/sentence.ts";
import { variable, inheritance, similarity, termFromKey, type Term } from "../nars/term.ts";
import type { Truth } from "../nars/truth.ts";

export type SpreadAnswer = {
  question: Term;
  answer: Term | null;
  truth: Truth | null;
  kind: "property" | "entity" | "similar";
};

const predicateOf = (term: Term): Term | null => {
  if (term.copula === "[]" && term.comps?.[0]) return predicateOf(term.comps[0]);
  if (term.copula !== "→" || !term.comps || term.comps.length < 2) return null;
  return term.comps[1]!;
};

/** 从 term 出发，最多问 limit 个问题；只返回记忆已有的答案。 */
export function spread(memory: Memory, term: Term, limit = 3): SpreadAnswer[] {
  const out: SpreadAnswer[] = [];
  const ask = (questionTerm: Term, kind: SpreadAnswer["kind"]): void => {
    if (out.length >= limit) return;
    const task = question(questionTerm, 0.9);
    memory.addQuestion(task);
    out.push({
      question: questionTerm,
      answer: task.solutionTerm ? termFromKey(task.solutionTerm) : null,
      truth: task.solution ?? null,
      kind,
    });
  };

  const propertyQuestion = inheritance(term, variable("p"));
  ask(propertyQuestion, "property");
  const propertyAnswer = out[0]?.answer;
  const predicate = propertyAnswer ? predicateOf(propertyAnswer) : null;
  if (predicate && out.length < limit) {
    ask(inheritance(variable("e"), predicate), "entity");
  }
  if (out.length < limit) {
    ask(similarity(term, variable("e")), "similar");
  }
  return out;
}

/** 问句的简短标签，只用于 trace/3D；不参与推理。 */
export function spreadLabel(answer: SpreadAnswer): string {
  const q = answer.question.key;
  const a = answer.answer?.key ?? "?";
  return `${q} ? ${a}`;
}
