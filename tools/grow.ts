// 阶段性经验成长：加载旧二进制 → 继续看世界 → 只保留分数更高的快照。
//
//   node tools/grow.ts
//
// 不看分类正确率；分数只衡量经验量（概念/相似/复合/信念/置信）。
// 每次启动先加载 memory/experience.bin，不从头开始。

import { readFileSync } from "node:fs";
import { Memory } from "../src/nars/memory.ts";
import { binaryInfo } from "../src/nars/binary.ts";
import { Experience } from "../src/experience/grow.ts";
import { loadMemory, memoryScore, saveMemory } from "../src/experience/store.ts";
import { World } from "../src/experience/world.ts";

const PATH = "memory/experience.bin";
const STAGES = [4, 6, 8];
const CYCLES = 450;

const old = loadMemory(PATH);
let bestScore = old ? memoryScore(old) : -Infinity;
const experience = new Experience(24, 8, old ?? new Memory());
const world = new World();

console.log(old
  ? `加载 ${PATH}：${old.size()} 概念，score=${bestScore.toFixed(1)}`
  : `没有旧快照，从空记忆开始`);

let step = 0;
for (let stage = 0; stage < STAGES.length; stage++) {
  // 阶段递进：先看已有实体，再逐步增加同类实体，经验才可能长出新概念。
  if (stage > 0) {
    for (let i = 0; i < stage + 1; i++) world.spawn();
  }
  for (let epoch = 0; epoch < STAGES[stage]!; epoch++) {
    step++;
    const scene = world.step();
    experience.run(world, scene, CYCLES);
  }
  const score = memoryScore(experience.memory);
  const stats = experience.stats();
  console.log(`stage ${stage + 1}: steps=${step} concepts=${stats.concepts} similar=${stats.similar} compounds=${stats.compounds} score=${score.toFixed(1)} shifts=${experience.shifts.length} asks=${experience.spreads.length} drop=${experience.economy.dropped} boost=${experience.economy.reinforced}`);
  if (score > bestScore + 0.01) {
    bestScore = score;
    const info = saveMemory(experience.memory, PATH);
    console.log(`  saved ${PATH} (${info.concepts} concepts / ${info.beliefs} beliefs / ${info.bytes} bytes)`);
  } else {
    console.log(`  keep previous snapshot (score ${bestScore.toFixed(1)})`);
  }
}

const final = binaryInfo(readFileSync(PATH));
console.log(`final: ${final.concepts} concepts / ${final.beliefs} beliefs / ${final.bytes} bytes`);
