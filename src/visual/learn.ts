// 视觉经验：图 → Shift 轨迹 → 相对位置/相对矢量/二阶差 → NAL 记忆。
//
// 不保存 2×2/3×3/4×4 像素块；只保存 Shift 产生的 shift_vec / shift_accel。
// 曲率来自相邻位置差的差，不是手写圆/线检测器。

import { readFileSync, writeFileSync } from "node:fs";
import { Engine } from "../nars/engine.ts";
import { Memory } from "../nars/memory.ts";
import { atom, inheritance, property } from "../nars/term.ts";
import { loadMemory, saveMemory } from "../experience/store.ts";
import { accelerations, accelProfile, shiftObservations, traceShift } from "./shift.ts";
import type { Figure } from "./types.ts";

export type CurveVerdict = {
  straight: boolean;
  steps: number;
  maxAbsAccel: number;
  meanAbsAccel: number;
  profile: Record<string, number>;
};

const MAP_PATH = "memory/visual.map.json";

export class VisualExperience {
  readonly memory: Memory;
  readonly engine: Engine;
  readonly names = new Map<string, string>();
  private readonly byName = new Map<string, string>();
  private next = 0;

  constructor(memory = new Memory()) {
    this.memory = memory;
    this.engine = new Engine(memory, {
      learn: true,
      compose: true,
      composeLimit: 64,
    });
    try {
      const saved = JSON.parse(readFileSync(MAP_PATH, "utf8")) as Record<string, string>;
      for (const [key, value] of Object.entries(saved)) {
        this.names.set(key, value);
        if (!this.byName.has(value)) this.byName.set(value, key);
      }
      this.next = this.names.size;
    } catch {
      // 没有旁路 map 就从头编号；不影响记忆加载。
    }
  }

  /** 看一个图形：只喂 Shift 轨迹里的相对量/二阶量。 */
  learn(figure: Figure, cycles = 240, example?: string): string {
    const id = example ?? this.byName.get(figure.name) ?? `ex_${this.next++}`;
    this.names.set(id, figure.name);
    this.byName.set(figure.name, id);
    this.engine.resetComposition();
    for (const term of shiftObservations(traceShift(figure.grid))) {
      this.engine.feed(inheritance(atom(id), property(term)), { f: 1, c: 0.9 }, 0.6);
    }
    this.engine.run(cycles);
    return id;
  }

  /** 只看 Shift 的加速度分布，不查像素块，也不查候选列表。 */
  judge(grid: number[]): CurveVerdict {
    const trace = traceShift(grid);
    const accels = trace.episodes.flatMap((episode) => accelerations(episode.steps));
    const maxAbsAccel = accels.reduce((max, accel) => Math.max(max, accel.mag), 0);
    const meanAbsAccel = accels.length
      ? accels.reduce((sum, accel) => sum + accel.mag, 0) / accels.length
      : 0;
    const profile = { zero: 0, small: 0, large: 0 };
    for (const episode of trace.episodes) {
      const part = accelProfile(episode.steps);
      profile.zero += part.zero ?? 0;
      profile.small += part.small ?? 0;
      profile.large += part.large ?? 0;
    }
    return {
      straight: maxAbsAccel < 0.6,
      steps: trace.steps.length,
      maxAbsAccel,
      meanAbsAccel,
      profile,
    };
  }

  save(): { concepts: number; beliefs: number; bytes: number } {
    const info = saveMemory(this.memory, "memory/visual.bin");
    writeFileSync(MAP_PATH, JSON.stringify(Object.fromEntries(this.names), null, 0));
    return { concepts: info.concepts, beliefs: info.beliefs, bytes: info.bytes };
  }

  static load(): VisualExperience {
    return new VisualExperience(loadMemory("memory/visual.bin") ?? new Memory());
  }
}
