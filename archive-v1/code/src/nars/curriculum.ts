// 课程工具：从一组经典图的结构词项里找“稳定/偏好”项与“独有”项；不接分类。
export type CurriculumFigure = {
  name: string;
  terms: string[];
};

/** 至少在 ratio 比例的图里出现的词项；用来选“稳定概念”。 */
export function preferredTerms(figures: CurriculumFigure[], ratio = 0.8): string[] {
  if (figures.length === 0) return [];
  const counts = new Map<string, number>();
  for (const figure of figures) for (const term of new Set(figure.terms)) {
    counts.set(term, (counts.get(term) ?? 0) + 1);
  }
  return [...counts.entries()]
    .filter(([, count]) => count / figures.length >= ratio)
    .map(([term]) => term)
    .sort();
}

/** 只在一个图里出现的词项；用来选“区分性经验”。 */
export function uniqueTerms(figures: CurriculumFigure[]): Map<string, string[]> {
  const counts = new Map<string, number>();
  const owner = new Map<string, string>();
  for (const figure of figures) for (const term of new Set(figure.terms)) {
    counts.set(term, (counts.get(term) ?? 0) + 1);
    owner.set(term, figure.name);
  }
  const out = new Map<string, string[]>();
  for (const [term, count] of counts) {
    if (count !== 1) continue;
    const name = owner.get(term)!;
    if (!out.has(name)) out.set(name, []);
    out.get(name)!.push(term);
  }
  return out;
}
