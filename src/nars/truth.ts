// 真值：只由证据算（书A ch3-0029、附录 C 表 C.3）
//
// 内部用 (w+, w) 记证据量，对外报 ⟨f, c⟩：f = w+/w，c = w/(w+k)。
// k = 1（证据视野，系统参数，书A ch3-0033）。
// 表 C.3 的函数逐条照抄：强三段论（演绎/类比/相似）与弱三段论（溯因/归纳/例证/比较）
// 的差别就在置信度的上界——弱推理 c ≤ 1/(1+k) = 0.5，这正是「结论超出前提」要付的代价。

export type Truth = { f: number; c: number };

export const EVIDENCE_HORIZON = 1;

const clamp = (x: number, lo: number, hi: number): number => (x < lo ? lo : x > hi ? hi : x);
const and = (...xs: number[]): number => xs.reduce((a, b) => a * b, 1);
const or = (...xs: number[]): number => 1 - xs.reduce((a, b) => a * (1 - b), 1);

export const truth = (f: number, c: number): Truth => ({
  f: clamp(f, 0, 1),
  c: clamp(c, 1e-6, 1 - 1e-9),
});

/** ⟨f,c⟩ → 证据量 w（书A 表3.1：w = c·k/(1−c)） */
export const evidence = (t: Truth): number => (t.c * EVIDENCE_HORIZON) / (1 - t.c);
const w = evidence;
/** 由证据量回 ⟨f,c⟩ */
const fromW = (wp: number, total: number): Truth =>
  truth(total <= 0 ? 0.5 : wp / total, total / (total + EVIDENCE_HORIZON));

export const expectation = (t: Truth): number => t.c * (t.f - 0.5) + 0.5;

/** 否定：交换正证据与负证据（书A ch9-0096、表9.8 的 F_neg：f = 1−f₁，c = c₁） */
export const negate = (t: Truth): Truth => truth(1 - t.f, t.c);

/** 修订：两份证据合起来（前提证据基础必须不相交，书A ch4-0032） */
export function revision(t1: Truth, t2: Truth): Truth {
  const total = w(t1) + w(t2);
  return fromW(t1.f * w(t1) + t2.f * w(t2), total);
}

/** 演绎 F_ded：f = f1·f2，c = f1·f2·c1·c2（强） */
export const deduction = (t1: Truth, t2: Truth): Truth =>
  truth(and(t1.f, t2.f), and(t1.f, t2.f, t1.c, t2.c));

/** 类比 F_ana（前提1 是相似，前提2 是继承）：f = f1·f2，c = f2·c1·c2（强） */
export const analogy = (t1: Truth, t2: Truth): Truth =>
  truth(and(t1.f, t2.f), and(t2.f, t1.c, t2.c));

/** 相似 F_res：f = f1·f2，c = or(f1,f2)·c1·c2（强） */
export const resemblance = (t1: Truth, t2: Truth): Truth =>
  truth(and(t1.f, t2.f), and(or(t1.f, t2.f), t1.c, t2.c));

/** 溯因 F_abd：w+ = f1f2c1c2，w = f1c1c2（弱） */
export const abduction = (t1: Truth, t2: Truth): Truth =>
  fromW(and(t1.f, t2.f, t1.c, t2.c), and(t1.f, t1.c, t2.c));

/** 归纳 F_ind：w+ = f1f2c1c2，w = f2c1c2（弱） */
export const induction = (t1: Truth, t2: Truth): Truth =>
  fromW(and(t1.f, t2.f, t1.c, t2.c), and(t2.f, t1.c, t2.c));

/** 例证 F_exe：f = 1，c = w/(w+k)，w = f1f2c1c2（弱） */
export const exemplification = (t1: Truth, t2: Truth): Truth =>
  truth(1, and(t1.f, t2.f, t1.c, t2.c) / (and(t1.f, t2.f, t1.c, t2.c) + EVIDENCE_HORIZON));

/** 比较 F_com：f = f1f2/or(f1,f2)，c = or(f1,f2)c1c2/(…+k)（弱） */
export const comparison = (t1: Truth, t2: Truth): Truth =>
  fromW(and(t1.f, t2.f, t1.c, t2.c), and(or(t1.f, t2.f), t1.c, t2.c));
