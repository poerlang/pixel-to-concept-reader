// 只读的报告证据层：把 Shift 词项映射回它经过的格子。
//
// 不参与推理、不写记忆，只给 test_report_v2.html 的 hover 高亮使用。

import { accelerations, episodeObservations, type ShiftTrace } from "../src/visual/shift.ts";

export type EvidencePoint = { x: number; y: number };

/** 词项 → 该词项对应的 Shift 目标格。 */
export function evidenceIndex(trace: ShiftTrace): Map<string, EvidencePoint[]> {
  const index = new Map<string, EvidencePoint[]>();
  const episodes = episodeObservations(trace);
  const add = (term: string, point: EvidencePoint): void => {
    const bucket = index.get(term) ?? [];
    if (!bucket.some((item) => item.x === point.x && item.y === point.y)) bucket.push(point);
    index.set(term, bucket);
  };

  for (let e = 0; e < trace.episodes.length; e++) {
    const episode = trace.episodes[e]!;
    const terms = episodes[e] ?? [];
    const accels = accelerations(episode.steps);
    let cursor = 0;

    for (const step of episode.steps) {
      const term = terms[cursor++];
      if (term) add(term, step.to);
    }
    for (let i = 0; i < accels.length; i++) {
      const term = terms[cursor++];
      const target = episode.steps[i + 1]?.to ?? episode.points[i + 1] ?? episode.points[0];
      if (term && target) add(term, target);
    }
    // closure 只取首尾；area/span 没有单一步骤，不给局部落点。
    for (; cursor < terms.length; cursor++) {
      const term = terms[cursor]!;
      if (term.startsWith("shift_closure_")) {
        if (episode.points[0]) add(term, episode.points[0]);
        const last = episode.points.at(-1);
        if (last) add(term, last);
      } else if (term.startsWith("shift_point_")) {
        for (const point of episode.points) add(term, point);
      }
    }
  }
  return index;
}

/** 一组概念子表征命中的格子并集。 */
export function evidenceFor(index: Map<string, EvidencePoint[]>, terms: Iterable<string>): EvidencePoint[] {
  const out: EvidencePoint[] = [];
  const seen = new Set<string>();
  for (const term of terms) {
    for (const point of index.get(term) ?? []) {
      const key = `${point.x},${point.y}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(point);
    }
  }
  return out;
}
