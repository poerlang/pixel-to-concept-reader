// 视觉经验：图 → 蔓延粗点 → Shift → 相对矢量/二阶差 → 曲率判断。
//
//   node tools/visual.ts
//
// 训练词项只用 ex_i + Shift 的 shift_vec / shift_accel；
// 图形名字只用于报告，不进入 NAL。

import { VisualExperience } from "../src/visual/learn.ts";
import { memoryScore } from "../src/experience/store.ts";
import { allFigures } from "./visual-fixtures.ts";

const { simple, complex } = allFigures();
const visual = VisualExperience.load();
const before = memoryScore(visual.memory);

console.log(`loaded: ${visual.memory.size()} concepts, score=${before.toFixed(1)}`);

for (let pass = 0; pass < 2; pass++) {
  for (const figure of simple) visual.learn(figure, 100);
}

const after = memoryScore(visual.memory);
const saved = after > before + 0.01 ? visual.save() : null;
console.log(`learned: ${visual.memory.size()} concepts, score=${after.toFixed(1)}${saved ? `, binary ${saved.bytes} bytes` : " (keep previous snapshot)"}`);

const order = [
  "line_h_1",
  "line_v_1",
  "circle_1",
  "angle_1",
  "s_1",
  "arc_1",
  "thick_line_3",
  "thick_ring_3",
];
const byId = new Map(simple.map((figure) => [figure.id, figure]));
const profile = (p: Record<string, number>): string => `zero:${p.zero} small:${p.small} large:${p.large}`;

for (const id of order) {
  const figure = byId.get(id);
  if (!figure) continue;
  const verdict = visual.judge(figure.grid);
  console.log(`\n${figure.name}`);
  console.log(`  steps=${verdict.steps} maxAccel=${verdict.maxAbsAccel.toFixed(3)} meanAccel=${verdict.meanAbsAccel.toFixed(3)} ${verdict.straight ? "straight" : "curved"}`);
  console.log(`  ${profile(verdict.profile)}`);
}

for (const figure of complex) {
  const verdict = visual.judge(figure.grid);
  console.log(`\n${figure.name}`);
  console.log(`  steps=${verdict.steps} maxAccel=${verdict.maxAbsAccel.toFixed(3)} meanAccel=${verdict.meanAbsAccel.toFixed(3)} ${verdict.straight ? "straight" : "curved"}`);
}
