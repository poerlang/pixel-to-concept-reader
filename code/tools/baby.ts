// 婴儿系统 v7：记忆从结构词项开始；识别只用 NAL 比较/修订/问句（没有分类器）。
//
//   node tools/baby.ts train     # 结构词项 → digit_d → [词项] 信念 + 二进制
//   node tools/baby.ts test      # 200 张测试：正确率 + public/test/ 可视化
//   node tools/baby.ts report    # 同 test
//   node tools/baby.ts shift     # 平移探针
//   node tools/baby.ts trace     # 一张图的 loop/Shift/词项与 NAL 答案
//   node tools/baby.ts tower     # 记忆层塔
//
// 边界（agents.md）：L0/L1 像素/小特征不进记忆；只允许 NAL 推理。
// 不引入贝叶斯/kNN/线性/树模型等任何非推理分类器，也不做对照。

import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { gridOf, indicesOf, loadMnist } from "../src/mnist.ts";
import { binaryInfo, decodeMemory, encodeMemory } from "../src/nars/binary.ts";
import { Engine } from "../src/nars/engine.ts";
import { Memory } from "../src/nars/memory.ts";
import { frequencyTruth, rankHypotheses, type Hypothesis } from "../src/nars/hypothesis.ts";
import { ringEvidence } from "../src/perception/rings.ts";
import { chainPartitions } from "../src/perception/partition-report.ts";
import { compareShifts } from "../src/perception/shift-compare.ts";
import { structureOf, termLayer, type Structure } from "../src/perception/structure.ts";
import { atom, inheritance, property, similarity, termFromKey, variable, type Term } from "../src/nars/term.ts";
import { expectation, type Truth } from "../src/nars/truth.ts";
import { prettyTerm, rankConcepts, renderReport, type ConceptUse, type ReportData, type SampleReport } from "../src/view/report.ts";
import { buildTower } from "../src/view/tower.ts";

const GRID = 16;
const TRAIN_PER = 80;
const TEST_OFFSET = 200;
const TEST_PER = 20;
const MEMORY_PATH = "memory/nars.json";
const TERMS_PATH = "memory/terms.json";

const mnist = loadMnist("public/mnist");
const digitTerm = (digit: number): Term => atom(`digit_${digit}`);

type Verdict = {
  digit: number | null;
  truth: Truth | null;
  runnerUp: { digit: number; truth: Truth } | null;
  structure: Structure;
  scores: Array<{ digit: number; f: number; c: number; expectation: number }>;
};

function loadMemory(): Memory {
  if (!existsSync(MEMORY_PATH)) throw new Error(`没有 ${MEMORY_PATH}，先跑 train`);
  return Memory.fromJSON(JSON.parse(readFileSync(MEMORY_PATH, "utf8")));
}

function loadTerms(): string[] {
  if (!existsSync(TERMS_PATH)) throw new Error(`没有 ${TERMS_PATH}，先跑 train`);
  return JSON.parse(readFileSync(TERMS_PATH, "utf8")) as string[];
}

type Curriculum = { unique: Record<string, string[]> };

function loadCurriculum(): Curriculum | null {
  try {
    return JSON.parse(readFileSync("docs/curriculum.json", "utf8")) as Curriculum;
  } catch {
    return null;
  }
}

function curriculumMatch(structure: Structure, curriculum: Curriculum | null): { figure: string; matches: number; total: number } | null {
  if (!curriculum) return null;
  let best: { figure: string; matches: number; total: number } | null = null;
  for (const [figure, terms] of Object.entries(curriculum.unique)) {
    const matches = terms.filter((term) => structure.terms.has(term)).length;
    if (!best || matches / Math.max(1, terms.length) > best.matches / Math.max(1, best.total)) best = { figure, matches, total: terms.length };
  }
  return best;
}

function digitOf(term: Term, frame: Term): number | null {
  for (const part of term.comps ?? []) {
    if (part.atom && part.key !== frame.key) {
      const hit = /^digit_(\d)$/.exec(part.key);
      if (hit) return Number(hit[1]);
    }
  }
  return null;
}

function classify(memory: Memory, terms: string[], name: string, grid: number[]): Verdict {
  const structure = structureOf(grid);
  const engine = new Engine(memory, { isCategory: (candidate) => /^digit_\d+$/.test(candidate.key) });
  const frame = atom(name);
  const present = new Set([...structure.terms.keys(), ...structure.compounds.map((compoundUse) => compoundUse.key)]);
  for (const term of terms) {
    engine.feed(inheritance(frame, termFromKey(term)), { f: present.has(term) ? 0.99 : 0.01, c: 0.9 }, 0.6);
  }
  engine.run(60000);
  const answer = memory.ask(similarity(frame, variable("x")));
  const ranked = memory
    .related([frame])
    .map((concept) => concept.best())
    .filter((belief): belief is NonNullable<typeof belief> => !!belief && belief.term.copula === "↔")
    .map((belief) => ({ digit: digitOf(belief.term, frame), truth: belief.truth }))
    .filter((row): row is { digit: number; truth: Truth } => row.digit !== null)
    .sort((a, b) => expectation(b.truth) - expectation(a.truth));
  const scores = Array.from({ length: 10 }, (_, d) => {
    const row = ranked.find((item) => item.digit === d);
    return {
      digit: d,
      f: row?.truth.f ?? 0.5,
      c: row?.truth.c ?? 0,
      expectation: row ? expectation(row.truth) : 0,
    };
  }).sort((a, b) => b.expectation - a.expectation);
  const digit = answer ? digitOf(answer.term, frame) : scores[0]?.digit ?? null;
  return {
    digit,
    truth: answer?.truth ?? ranked[0]?.truth ?? null,
    runnerUp: ranked.find((row) => row.digit !== digit) ?? null,
    structure,
    scores,
  };
}

function train(): void {
  const samples: Array<{ digit: number; structure: Structure }> = [];
  const vocabulary = new Set<string>();
  const presence: Array<Map<string, number>> = Array.from({ length: 10 }, () => new Map<string, number>());
  for (let digit = 0; digit <= 9; digit++) {
    for (const index of indicesOf(mnist, digit, 0, TRAIN_PER)) {
      const structure = structureOf(gridOf(mnist, index, GRID));
      samples.push({ digit, structure });
      for (const term of structure.terms.keys()) {
        vocabulary.add(term);
        presence[digit]!.set(term, (presence[digit]!.get(term) ?? 0) + 1);
      }
      for (const compoundUse of structure.compounds) {
        vocabulary.add(compoundUse.key);
        presence[digit]!.set(compoundUse.key, (presence[digit]!.get(compoundUse.key) ?? 0) + 1);
      }
    }
  }
  const terms = [...vocabulary].sort();

  // 记忆只存结构词项：digit_d → [词项]，f = 该类训练样本里出现该词项的比例
  const memory = new Memory();
  for (let digit = 0; digit <= 9; digit++) {
    for (const term of terms) {
      const f = (presence[digit]!.get(term) ?? 0) / TRAIN_PER;
      memory.assert(inheritance(digitTerm(digit), termFromKey(term)), { f: Math.max(0.01, f), c: 0.99 }, [digit], 0.5);
    }
  }

  const binary = encodeMemory(memory);
  const info = binaryInfo(binary);
  mkdirSync("memory", { recursive: true });
  writeFileSync(MEMORY_PATH, JSON.stringify(memory.toJSON()));
  writeFileSync("memory/nars.bin", binary);
  writeFileSync(TERMS_PATH, JSON.stringify(terms));
  console.log(`经验已保存 ${MEMORY_PATH}：${memory.size()} 个概念`
    + `（JSON ${(statSync(MEMORY_PATH).size / 1024).toFixed(1)} KB · 二进制 ${(binary.length / 1024).toFixed(1)} KB`
    + ` / ${info.terms} 词项 / ${info.beliefs} 信念）`);
  console.log(`结构词项：${terms.length} 种；训练样本 ${samples.length}；读出 NAL 比较/修订（无分类器）`);
}

function test(): void {
  const memory = loadMemory();
  const knownTerms = loadTerms();
  const binary = encodeMemory(memory);
  const info = binaryInfo(binary);
  const roundTrip = decodeMemory(binary).size() === memory.size();
  const started = Date.now();

  let correct = 0;
  let total = 0;
  const confusion: number[][] = Array.from({ length: 10 }, () => new Array<number>(10).fill(0));
  const classTotals: number[] = new Array<number>(10).fill(0);
  const curriculum = loadCurriculum();
  const samples: SampleReport[] = [];
  const global = new Map<string, number>();

  for (let digit = 0; digit <= 9; digit++) {
    for (const index of indicesOf(mnist, digit, TEST_OFFSET, TEST_PER)) {
      const grid = gridOf(mnist, index, GRID);
      const verdict = classify(memory, knownTerms, `f${index}`, grid);
      total++;
      classTotals[digit] = (classTotals[digit] ?? 0) + 1;
      if (verdict.digit !== null) confusion[digit]![verdict.digit] = (confusion[digit]![verdict.digit] ?? 0) + 1;
      if (verdict.digit === digit) correct++;

      const terms = verdict.structure.terms;
      const chainTruth = terms.has("closure")
        ? { f: 1, c: 0.9 }
        : [...terms.keys()].some((key) => key.startsWith("shift_diff_accum"))
          ? { f: 0.8, c: 0.7 }
          : { f: 0.2, c: 0.3 };
      const ring = ringEvidence(verdict.structure.loops);
      const shiftComparison = compareShifts(verdict.structure.shifts);
      const partitions = chainPartitions(verdict.structure);
      const match = curriculumMatch(verdict.structure, curriculum);
      const directionTruth = frequencyTruth(shiftComparison.direction, shiftComparison.pairs, 0.5);
      const fullRings = [...terms.keys()].filter((key) => /^shift_diff_accum_[lr]_[3-8]_span_/.test(key));
      const doubleRingTruth = fullRings.length >= 2 ? { f: 0.8, c: 0.5 } : { f: 0, c: 0 };
      const chainE = expectation(chainTruth);
      const hypotheses = rankHypotheses([
        { term: atom("chain_explanation"), truth: chainTruth, priority: 0.8, source: "链/累积" },
        { term: atom("ring_explanation"), truth: ring ? { f: ring.support, c: 0.5 } : { f: 0, c: 0 }, priority: 0.5, source: "弱边环" },
        { term: atom("shift_direction_similarity"), truth: directionTruth, priority: 0.6, source: "方向相似" },
        { term: atom("double_ring"), truth: doubleRingTruth, priority: 0.7, source: "双环∩" },
      ] as Hypothesis[]).map((hypothesis) => ({
        source: hypothesis.source,
        label: prettyTerm(hypothesis.term),
        f: hypothesis.truth.f,
        c: hypothesis.truth.c,
        expectation: expectation(hypothesis.truth),
        enabled: hypothesis.source === "链/累积" || chainE < 0.7,
      }));
      const entries = [
        ...[...verdict.structure.terms.entries()].map(([key, count]) => ({ key, count, layer: termLayer(key) })),
        ...verdict.structure.compounds.map((compoundUse) => ({ key: compoundUse.key, count: compoundUse.count, layer: 4 })),
      ];
      const rawTotal = entries.reduce((sum, entry) => sum + entry.count, 0);
      const termTotal = Math.round(rawTotal);
      const termBase = Math.max(1, rawTotal);
      const groupCounts = [0, 0, 0, 0, 0];
      for (const entry of entries) {
        global.set(entry.key, (global.get(entry.key) ?? 0) + entry.count);
        groupCounts[entry.layer]! += entry.count;
      }

      const layers: ConceptUse[][] = [[], [], [], [], []];
      for (const entry of entries) {
        layers[entry.layer]!.push({
          label: prettyTerm(termFromKey(entry.key)),
          layer: entry.layer,
          count: entry.count,
          f: entry.count / termBase,
          c: 0.9,
        });
      }
      samples.push({
        index,
        digit,
        pred: verdict.digit,
        f: verdict.truth?.f ?? 0.5,
        c: verdict.truth?.c ?? 0,
        runnerUp: verdict.runnerUp?.digit ?? null,
        grid,
        parts: verdict.structure.loops,
        shifts: verdict.structure.shifts,
        correct: verdict.digit === digit,
        scores: verdict.scores,
        termTotal,
        groupCounts: groupCounts.map((value) => Math.round(value)),
        layers: layers.map((entries) => rankConcepts(entries, 40)),
        hypotheses,
        shiftComparison,
        partitions,
        curriculumMatch: match,
        alternatives: verdict.structure.alternatives.map((alt) => ({ name: alt.name, count: alt.terms.length })),
      });
    }
  }

  console.log(`\n测试 ${total} 张 · 正确 ${correct} · 正确率 ${((correct / Math.max(1, total)) * 100).toFixed(1)}%`);
  for (let digit = 0; digit <= 9; digit++) {
    const parts: string[] = [];
    for (let pred = 0; pred <= 9; pred++) {
      const count = confusion[digit]![pred] ?? 0;
      if (count > 0) parts.push(`digit_${pred}×${count}`);
    }
    console.log(`  digit_${digit} → ${parts.join(" ")}`);
  }

  const allConcepts: ConceptUse[] = [...global.entries()].map(([key, count]) => ({
    label: prettyTerm(termFromKey(key)),
    layer: termLayer(key),
    count,
    f: Math.min(0.99, count / 200),
    c: 0.9,
  }));
  const ranking: ConceptUse[] = (() => {
    const merged = new Map<string, ConceptUse>();
    const put = (entry: ConceptUse): void => { merged.set(`${entry.layer}|${entry.label}`, entry); };
    for (const entry of rankConcepts(allConcepts, 150)) put(entry);
    for (let layer = 0; layer < 5; layer++) {
      for (const entry of rankConcepts(allConcepts.filter((item) => item.layer === layer), 120)) put(entry);
    }
    return [...merged.values()];
  })();

  const report: ReportData = {
    generated: new Date().toISOString(),
    accuracy: { correct, total },
    confusion,
    classTotals,
    samples,
    ranking,
    memory: {
      jsonBytes: statSync(MEMORY_PATH).size,
      binaryBytes: binary.length,
      concepts: info.concepts,
      beliefs: info.beliefs,
      roundTrip,
    },
    params: {
      trainPer: TRAIN_PER,
      testOffset: TEST_OFFSET,
      testPer: TEST_PER,
      classifier: "NAL 比较/修订（无分类器）",
    },
  };

  mkdirSync("public/test", { recursive: true });
  mkdirSync("memory", { recursive: true });
  writeFileSync("memory/nars.bin", binary);
  writeFileSync("public/test/nars.bin", binary);
  writeFileSync("public/test/report.json", JSON.stringify(report, null, 2));
  writeFileSync("public/test/index.html", renderReport(report));
  console.log(`报告：public/test/index.html（错误 ${samples.filter((sample) => !sample.correct).length} 张 · 结构词项排行 ${ranking.length} 条 · `
    + `二进制 ${(binary.length / 1024).toFixed(1)} KB · 往返 ${roundTrip ? "✓" : "✗"} · ${((Date.now() - started) / 1000).toFixed(1)} s）`);
}

function shiftGrid(grid: number[], dx: number, dy: number): number[] {
  const out = new Array<number>(GRID * GRID).fill(0);
  for (let j = 0; j < GRID; j++) for (let i = 0; i < GRID; i++) {
    const si = i - dx;
    const sj = j - dy;
    if (si < 0 || si >= GRID || sj < 0 || sj >= GRID) continue;
    out[j * GRID + i] = grid[sj * GRID + si]!;
  }
  return out;
}

function shift(): void {
  const memory = loadMemory();
  const knownTerms = loadTerms();
  console.log("结构词项 + NAL 比较/修订：");
  for (const [dx, dy] of [[0, 0], [1, 0], [0, 1], [1, 1], [2, 2]] as Array<[number, number]>) {
    let correct = 0;
    let total = 0;
    for (let digit = 0; digit <= 9; digit++) {
      for (const index of indicesOf(mnist, digit, TEST_OFFSET, TEST_PER)) {
        const verdict = classify(memory, knownTerms, `h${dx}_${dy}_${index}`, shiftGrid(gridOf(mnist, index, GRID), dx, dy));
        if (verdict.digit === digit) correct++;
        total++;
      }
    }
    console.log(`  平移 (${dx},${dy})：${correct}/${total} = ${((correct / total) * 100).toFixed(1)}%`);
  }
}

function trace(): void {
  const memory = loadMemory();
  const knownTerms = loadTerms();
  const index = Number(process.argv[3] ?? indicesOf(mnist, 3, TEST_OFFSET, 1)[0]);
  const grid = gridOf(mnist, index, GRID);
  const verdict = classify(memory, knownTerms, `f${index}`, grid);
  console.log(`样本 #${index}：答案 ${verdict.digit === null ? "?" : `digit_${verdict.digit}`}`
    + `（f=${verdict.truth?.f.toFixed(3)} c=${verdict.truth?.c.toFixed(3)}`
    + `，次名 ${verdict.runnerUp ? `digit_${verdict.runnerUp.digit}` : "无"}）`);
  console.log(`loop ${verdict.structure.loops.length} 个 · 链 ${verdict.structure.chains} 条 · shift ${verdict.structure.shifts.length} 步`);
  const rows = [...verdict.structure.terms.entries()].sort((a, b) => b[1] - a[1]).slice(0, 12);
  for (const [term, count] of rows) console.log(`  [${term}] ×${count}`);
}

function tower(): void {
  const memory = loadMemory();
  const view = buildTower(memory);
  mkdirSync("memory", { recursive: true });
  writeFileSync("memory/tower.html", renderTower(view, { concepts: memory.size() }));
  console.log(`层塔视图已写出 memory/tower.html：${memory.size()} 概念 → `
    + `${view.layers.length} 层 / ${view.stats.leaves} 叶 / ${view.stats.placed} 个点`);
}

function renderTower(view: ReturnType<typeof buildTower>, meta: { concepts: number }): string {
  const size = 320;
  const scale = (value: number): number => ((value + 6) / 12) * size;
  const panels = view.layers.map((layer) => {
    const leaves = layer.leaves.map((leaf) => {
      const x = scale(leaf.cx - leaf.half);
      const y = scale(leaf.cy - leaf.half);
      const w = ((leaf.half * 2) / 12) * size;
      return `<rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${w.toFixed(1)}" height="${w.toFixed(1)}" fill="none" stroke="#243444" />`;
    }).join("");
    const points = layer.leaves.flatMap((leaf) => leaf.points).map((point) => {
      const r = point.complexity > 3 ? 1.5 : Math.min(4.5, 1.1 + point.complexity * 0.6 + point.c * 0.7);
      const alpha = 0.12 + 0.55 * Math.min(1, point.f);
      const title = `${point.label} · f=${point.f.toFixed(2)} c=${point.c.toFixed(2)}`;
      return `<circle cx="${scale(point.x).toFixed(1)}" cy="${scale(point.y).toFixed(1)}" r="${r.toFixed(1)}" fill="rgba(99,217,255,${alpha.toFixed(2)})"><title>${escapeHtml(title)}</title></circle>`;
    }).join("");
    return `<figure><figcaption>${layer.name} · ${layer.count} 个 · ${layer.leaves.length} 叶</figcaption>
      <svg viewBox="0 0 ${size} ${size}" width="${size}" height="${size}">${leaves}${points}</svg></figure>`;
  }).join("\n");
  return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><title>记忆层塔（只读视图）</title>
<style>
body{margin:0;background:#0b1014;color:#dee8f2;font:13px/1.5 "Segoe UI","Microsoft YaHei",sans-serif}
header{padding:14px 18px;border-bottom:1px solid #1d2a36}
h1{font-size:15px;margin:0 0 4px}
p{margin:0;color:#7f93a6;font-size:12px}
main{display:flex;flex-wrap:wrap;gap:18px;padding:14px 18px}
figure{margin:0}
figcaption{color:#9fb3c6;font-size:12px;margin-bottom:4px}
svg{background:#0e151c;border:1px solid #1d2a36;border-radius:4px}
</style></head><body>
<header><h1>记忆的层塔视图（层 = 词项句法深度；四叉树 = 格原子的重心）</h1>
<p>由记忆只读投影而来，不参与推理。概念 ${meta.concepts} 个；只含结构词项的类别信念。</p></header>
<main>${panels}</main></body></html>`;
}

const escapeHtml = (text: string): string => text.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c] ?? c);

const command = process.argv[2] ?? "test";
if (command === "train") train();
else if (command === "test" || command === "report") test();
else if (command === "tower") tower();
else if (command === "trace") trace();
else if (command === "shift") shift();
else console.log("用法：node tools/baby.ts [train|test|report|tower|trace|shift]");
