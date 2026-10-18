// 词项：概念的标识符（书A ch3-0009、书B ch6 §6.1）
//
// 只有三种东西：原子、变量、复合（连接符 + 分量）。
// 词项的身份 = key（复合词项的 key 由「连接符 + 分量 key」递归决定，书A ch7-0018）。
// 相似是对称系词，所以 ↔ 的两个分量在 key 里排序，A↔B 与 B↔A 是同一个词项。

export type Term = {
  key: string;
  atom: boolean;
  variable?: boolean;
  copula?: string;
  comps?: Term[];
  complexity: number;
  depth: number;
};

const pool = new Map<string, Term>();

function intern(term: Term): Term {
  const known = pool.get(term.key);
  if (known) return known;
  pool.set(term.key, term);
  return term;
}

export function atom(name: string): Term {
  return intern({ key: name, atom: true, complexity: 1, depth: 0 });
}

export function variable(name: string): Term {
  return intern({ key: `?${name}`, atom: true, variable: true, complexity: 1, depth: 0 });
}

export function compound(copula: string, comps: Term[], symmetric = false): Term {
  const parts = symmetric
    ? [...comps].sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0))
    : comps;
  const key = `${copula}(${parts.map((t) => t.key).join(",")})`;
  return intern({
    key,
    atom: false,
    copula,
    comps: parts,
    complexity: 1 + parts.reduce((sum, t) => sum + t.complexity, 0),
    depth: 1 + Math.max(...parts.map((t) => t.depth)),
  });
}

/** 继承 S → P */
export const inheritance = (s: Term, p: Term): Term => compound("→", [s, p]);

/** 相似 S ↔ P（对称） */
export const similarity = (s: Term, p: Term): Term => compound("↔", [s, p], true);

/** 性质：X → [c] 里的 [c]，即「有 c 这个性质」（书A ch6 的性质系词 →◦） */
export const property = (name: string): Term => compound("[]", [atom(name)]);

/** 交集复合词项：交给 NAL-3 的 ∩，不在感知层手写。 */
export const intersection = (terms: Term[]): Term => compound("∩", terms, true);

/** 从报告里保存的 key 还原词项；只支持本项目用到的原子/属性/∩ 复合。 */
export function termFromKey(key: string): Term {
  if (key.startsWith("∩(")) {
    const body = key.slice(2, -1);
    const parts = body.split(",").map((part) => {
      const hit = /^\[\]\((.+)\)$/.exec(part.trim());
      return property(hit ? hit[1]! : part.trim());
    });
    return compound("[]", [intersection(parts)]);
  }
  return property(key);
}
/** 否定词项 ¬t（书A ch9-0096、书B ch6-0064；只作词项，真值变换见 truth.negate） */
export const negative = (t: Term): Term => compound("¬", [t]);

export const isStatement = (t: Term): boolean => !t.atom && (t.copula === "→" || t.copula === "↔");
export const isSimilarity = (t: Term): boolean => !t.atom && t.copula === "↔";
export const components = (t: Term): Term[] => t.comps ?? [];

/** 把变量绑成常量：pattern 里的 ?x 可以绑任意词项，其它要求 key 相等 */
export function unify(pattern: Term, target: Term, bind: Map<string, Term>): boolean {
  if (pattern.variable) {
    const bound = bind.get(pattern.key);
    if (bound) return bound.key === target.key;
    bind.set(pattern.key, target);
    return true;
  }
  if (pattern.key === target.key) return true;
  if (pattern.atom || target.atom || pattern.copula !== target.copula) return false;
  const a = pattern.comps ?? [];
  const b = target.comps ?? [];
  if (a.length !== b.length) return false;
  return a.every((part, index) => unify(part, b[index]!, bind));
}

/** 用绑定实例化一个模式（用于把「问句模式」变成候选答案） */
export function instantiate(pattern: Term, bind: Map<string, Term>): Term | null {
  if (pattern.variable) return bind.get(pattern.key) ?? null;
  if (pattern.atom) return pattern;
  const parts: Term[] = [];
  for (const comp of pattern.comps ?? []) {
    const filled = instantiate(comp, bind);
    if (!filled) return null;
    parts.push(filled);
  }
  return compound(pattern.copula!, parts, pattern.copula === "↔");
}

/** 词项里所有的原子名（给显示与空间定位用） */
export function atomsOf(t: Term, out: string[] = []): string[] {
  if (t.atom) {
    if (!t.variable) out.push(t.key);
  } else for (const comp of t.comps ?? []) atomsOf(comp, out);
  return out;
}

export const hasVariable = (t: Term): boolean =>
  t.variable ? true : (t.comps ?? []).some((comp) => hasVariable(comp));
