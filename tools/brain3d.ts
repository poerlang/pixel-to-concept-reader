// 3D 经验场：一个通用世界 → 有限 Buffer → NAL 记忆 → 3D 图。
//
// 没有形状/近邻检测器。世界只给普通属性观察：
//   thing_0 → color_red、thing_0 → x_n、thing_0 → moving ...
// Buffer 决定哪些观察同时进入这一轮；NAL 通过共同主项的比较、交集、修订
// 自己形成“哪些属性总一起出现”“哪些实体相似”等经验。
//
//   node tools/brain3d.ts

import { copyFileSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import type { TraceEvent } from "../src/nars/engine.ts";
import type { Term } from "../src/nars/term.ts";
import { Experience } from "../src/experience/grow.ts";
import { loadMemory } from "../src/experience/store.ts";
import { spreadLabel } from "../src/experience/spread.ts";
import { World, type Entity } from "../src/experience/world.ts";

const OUT = resolve("public/brain3d");
const EPOCHS = 12;
const CYCLES = 500;
const DERIVE_LIMIT = 160;

type Instance = {
  id: string;
  kind: "entity";
  label: string;
  x: number;
  z: number;
  r: number;
};

type Step = {
  kind: "instance" | "observe" | "derive";
  rule?: string;
  task?: string;
  belief?: string;
  conclusion: string;
  label: string;
  layer: number;
  truth: { f: number; c: number };
  instance?: string;
  worker?: string;
  focus?: { x: number; z: number };
};

type Label = { label: string; layer: number };

type Figure = {
  id: string;
  name: string;
  code: string;
  family: string;
  accent: string;
  holdMs: number;
  shape: { kind: "line"; x0: number; y0: number; x1: number; y1: number };
  instances: Instance[];
  steps: Step[];
  labels: Record<string, Label>;
  stats: {
    objects: number;
    links: number;
    steps: number;
    concepts: number;
    compounds: number;
    similar: boolean;
  };
};

function termLabel(term: Term): string {
  if (term.atom) return term.key;
  if (term.copula === "[]") return term.comps?.[0]?.key ?? term.key;
  const parts = term.comps ?? [];
  if (term.copula === "→") return `${termLabel(parts[0]!)} → ${termLabel(parts[1]!)}`;
  if (term.copula === "↔") return `${termLabel(parts[0]!)} ↔ ${termLabel(parts[1]!)}`;
  if (term.copula === "∩") return `(${parts.map(termLabel).join(" ∩ ")})`;
  return term.key;
}

function layerOf(term: Term, kind: Step["kind"], rule?: string): number {
  if (kind === "instance") return 4;
  if (kind === "observe") return 0;
  if (term.copula === "↔") return 1;
  if (rule === "∩" || term.copula === "∩") return 3;
  return 2;
}

const world = new World();
const saved = loadMemory("memory/experience.bin");
const experience = new Experience(24, 8, saved ?? undefined);
const instances: Instance[] = [];
const steps: Step[] = [];
const labels: Record<string, Label> = {};
const seen = new Set<string>();
let observations = 0;

const addLabel = (term: Term, layer: number): void => {
  if (!labels[term.key]) labels[term.key] = { label: termLabel(term), layer };
};

const scene = ((): Entity[] => {
  let current = world.entities;
  for (let epoch = 0; epoch < EPOCHS; epoch++) {
    const next = world.step();
    current = next.entities;
    const shiftStart = experience.shifts.length;
    const askStart = experience.spreads.length;
    const traces = experience.run(world, next, CYCLES);
    const shift = experience.shifts.length > shiftStart ? experience.shifts.at(-1)! : null;
    const focus = shift ? new Set([shift.from.id, shift.to.id]) : null;

    // 观察节点：只展示这次 Shift/焦点真正送入经验的事件。
    for (const observation of world.observations(next)) {
      if (focus && !focus.has(observation.entity)) continue;
      const key = observation.term.key;
      addLabel(observation.term, 0);
      if (!seen.has(key)) {
        seen.add(key);
        observations++;
        steps.push({
          kind: "observe",
          conclusion: key,
          label: labels[key]!.label,
          layer: 0,
          truth: observation.truth,
          instance: observation.entity,
          focus: {
            x: (next.entities.find((entity) => entity.id === observation.entity)?.x ?? 0) * 0.7,
            z: (next.entities.find((entity) => entity.id === observation.entity)?.z ?? 0) * 0.7,
          },
        });
      }
    }

    // Shift 与问句：操作/询问本身也是经验节点。
    if (shift) {
      const key = `shift_${epoch}`;
      labels[key] = { label: `shift ${shift.from.id}→${shift.to.id} Δ${shift.changed.length}`, layer: 1 };
      steps.push({
        kind: "derive",
        rule: "shift",
        conclusion: key,
        label: labels[key]!.label,
        layer: 1,
        truth: { f: 1, c: 0.9 },
      });
    }
    for (const ask of experience.spreads.slice(askStart)) {
      const key = `ask_${epoch}_${ask.kind}`;
      if (labels[key]) continue;
      labels[key] = { label: spreadLabel(ask), layer: 1 };
      steps.push({
        kind: "derive",
        rule: "?",
        conclusion: key,
        label: labels[key]!.label,
        layer: 1,
        truth: ask.truth ?? { f: 0.5, c: 0.01 },
      });
    }

    // 派生节点：只展示引擎真实产生的前若干条经验。
    for (const trace of traces) {
      if (steps.filter((step) => step.kind === "derive").length >= DERIVE_LIMIT) break;
      if (seen.has(trace.conclusion.key)) continue;
      seen.add(trace.conclusion.key);
      addLabel(trace.conclusion, layerOf(trace.conclusion, "derive", trace.rule));
      addLabel(trace.task, 0);
      addLabel(trace.belief, 2);
      steps.push({
        kind: "derive",
        rule: trace.rule,
        task: trace.task.key,
        belief: trace.belief.key,
        conclusion: trace.conclusion.key,
        label: labels[trace.conclusion.key]!.label,
        layer: labels[trace.conclusion.key]!.layer,
        truth: trace.truth,
        worker: trace.instanceId,
      });
    }
  }
  return current;
})();

const scale = 0.7;
for (const entity of scene) {
  instances.push({
    id: entity.id,
    kind: "entity",
    label: entity.id,
    x: entity.x * scale,
    z: entity.z * scale,
    r: entity.size === "big" ? 0.18 : 0.11,
  });
  labels[entity.id] = { label: entity.id, layer: 4 };
  steps.unshift({
    kind: "instance",
    conclusion: entity.id,
    label: entity.id,
    layer: 4,
    truth: { f: 1, c: 1 },
    instance: entity.id,
    focus: { x: entity.x * scale, z: entity.z * scale },
  });
}

const stats = experience.stats();
const figure: Figure = {
  id: "growth",
  name: "经验成长",
  code: "GROW",
  family: "experience",
  accent: "#57e0d0",
  holdMs: 2600,
  shape: { kind: "line", x0: 1, y0: 8, x1: 14, y1: 8 },
  instances,
  steps,
  labels,
  stats: {
    objects: instances.length,
    links: stats.similar,
    steps: observations,
    concepts: stats.concepts,
    compounds: stats.compounds,
    similar: stats.similar > 0,
  },
};

const payload = {
  generatedAt: new Date().toISOString(),
  title: "EXPERIENCE // GROWING FIELD",
  note: "通用世界 → 有限 Buffer → NAL 记忆。没有形状检测器；节点是观察和引擎真实派生的经验。",
  layerNames: ["观察", "相似/比较", "派生继承", "∩ 复合", "实例"],
  params: { epochs: EPOCHS, cycles: CYCLES, deriveLimit: DERIVE_LIMIT },
  figures: [figure],
};

mkdirSync(OUT, { recursive: true });
const vendor = join(OUT, "vendor");
mkdirSync(vendor, { recursive: true });
for (const file of ["three.module.min.js", "three.core.min.js"]) {
  const source = resolve("../pdftest4/node_modules/three/build", file);
  if (!existsSync(source)) {
    console.warn(`缺少 ${source}；three.js 需要手动复制到 ${vendor}`);
    continue;
  }
  copyFileSync(source, join(vendor, file));
}
writeFileSync(join(OUT, "data.js"), `export const BRAIN_DATA = ${JSON.stringify(payload)};\n`);

console.log(`经验场：${instances.length} 个实体，${observations} 条观察，${steps.filter((step) => step.kind === "derive").length} 条派生`);
console.log(`记忆：${stats.concepts} 概念 / ${stats.beliefs} 信念 / ${stats.similar} 相似 / ${stats.compounds} 复合`);
console.log(`写入 ${join(OUT, "data.js")}`);
