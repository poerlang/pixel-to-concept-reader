// 通用经验循环：世界事件 → 有限 Buffer → NAL 记忆。
//
// 这里不创建 near/aligned/continues/between，也不写圆/凸。
// Buffer 只决定哪些观察同时进入这一轮；NAL 通过共同主项的比较/复合/修订
// 自己形成“哪些属性总一起出现”“哪些实体相似”等经验。

import { Engine, type TraceEvent } from "../nars/engine.ts";
import { Memory } from "../nars/memory.ts";
import type { Sentence } from "../nars/sentence.ts";
import { atom } from "../nars/term.ts";
import { Economy } from "./economy.ts";
import { EventBuffer } from "./event.ts";
import { spread, type SpreadAnswer } from "./spread.ts";
import { planShift, type Shift } from "./shift.ts";
import type { Scene, World } from "./world.ts";

const hasIntersection = (term: Sentence["term"]): boolean =>
  term.copula === "∩" || (term.comps ?? []).some((part) => hasIntersection(part));

export class Experience {
  readonly memory: Memory;
  readonly engine: Engine;
  readonly buffer: EventBuffer;
  readonly traces: TraceEvent[] = [];
  readonly shifts: Shift[] = [];
  readonly spreads: SpreadAnswer[] = [];
  readonly economy = new Economy();
  focusId: string | null = null;
  time = 0;

  constructor(capacity = 24, composeLimit = 8, memory = new Memory()) {
    this.memory = memory;
    this.buffer = new EventBuffer(capacity);
    this.engine = new Engine(this.memory, {
      learn: true,
      compose: true,
      composeLimit,
      trace: (event) => {
        this.traces.push(event);
      },
    });
  }

  /** 看一个场景：只有被注意力（焦点/Shift）选中的事件进入经验。 */
  observe(world: World, scene: Scene, cycles = 700, focusIds?: string[]): TraceEvent[] {
    const start = this.traces.length;
    this.time = scene.time;
    const allowed = focusIds && focusIds.length > 0 ? new Set(focusIds) : null;
    for (const observation of world.observations(scene)) {
      if (allowed && !allowed.has(observation.entity)) continue;
      this.buffer.put({
        term: observation.term,
        truth: observation.truth,
        time: scene.time,
        priority: observation.priority,
      });
    }
    for (const event of this.buffer.all()) {
      this.engine.feed(event.term, event.truth, event.priority);
    }
    this.buffer.clear();
    this.engine.run(cycles);
    return this.traces.slice(start);
  }

  /** 一次经验步：Shift 选下一个焦点（少改变/近），观察焦点对，再做有限问句。 */
  run(world: World, scene: Scene, cycles = 700): TraceEvent[] {
    this.focusId ??= scene.entities[0]?.id ?? null;
    const askStart = this.spreads.length;
    const shift = this.focusId ? planShift(scene.entities, this.focusId) : null;
    if (shift) {
      this.shifts.push(shift);
      this.focusId = shift.to.id;
    }
    const focus = shift
      ? [shift.from.id, shift.to.id]
      : scene.entities.map((entity) => entity.id);
    const traces = this.observe(world, scene, cycles, focus);
    const subject = focus[0];
    if (subject) this.spreads.push(...spread(this.memory, atom(subject), 3));
    this.economy.observe(this.engine, this.spreads.slice(askStart));
    this.economy.step(this.memory);
    return traces;
  }

  beliefs(): Sentence[] {
    return this.memory.beliefs();
  }

  /** 只读快照：概念数、信念数、相似/复合计数。 */
  stats(): { concepts: number; beliefs: number; similar: number; compounds: number } {
    const beliefs = this.memory.beliefs();
    return {
      concepts: new Set(beliefs.map((sentence) => sentence.term.key)).size,
      beliefs: beliefs.length,
      similar: beliefs.filter((sentence) => sentence.term.copula === "↔").length,
      compounds: beliefs.filter((sentence) => hasIntersection(sentence.term)).length,
    };
  }
}
