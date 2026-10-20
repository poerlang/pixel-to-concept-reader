// 推理实例池：同一个词法/函数，多个 instance id，逻辑并行，共享黑板。
//
// 这不是把 term 改名成 `v1_xxx`。所有实例看到的是同一套 Term：
//   v1#0: thing#0 → color_red
//   v2#0: thing#0 → color_red
// id 只进入句子的 instance/sources、trace 和任务调度，不改变 term 的语义。
// 这样同一种功能可以复制很多份来分担工作（视网膜、皮肤、V1/V2/V3 的通道实例），
// 需要汇总时再用 merge()/共享 Memory 做证据合并。

import { Engine, type EngineOptions, type TraceEvent } from "./engine.ts";
import { Memory } from "./memory.ts";
import type { Term } from "./term.ts";
import type { Truth } from "./truth.ts";

export type InstanceAnswer = {
  instanceId: string;
  term: Term;
  truth: Truth;
};

export type InstancePoolOptions = {
  /** 所有实例共用的引擎参数；实例 id 与 trace 由池注入。 */
  engine?: Omit<EngineOptions, "instanceId" | "trace">;
  /** 池级 trace；事件里的 instanceId 标明是哪个实例派生的。 */
  trace?: (event: TraceEvent) => void;
  /** 共享黑板；默认 new Memory()。 */
  memory?: Memory;
  /** 默认 false：所有实例共享同一个 Memory。true：每个实例独立记忆，需要 merge()。 */
  local?: boolean;
  /** 生成默认 id 时的前缀。 */
  prefix?: string;
};

export class ReasoningInstance {
  readonly id: string;
  readonly memory: Memory;
  readonly engine: Engine;

  constructor(id: string, memory: Memory, options: InstancePoolOptions = {}) {
    this.id = id;
    this.memory = memory;
    this.engine = new Engine(memory, {
      ...options.engine,
      instanceId: id,
      trace: options.trace,
    });
  }
}

const hash = (text: string): number => {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
};

export class InstancePool {
  readonly instances: ReasoningInstance[] = [];
  readonly byId = new Map<string, ReasoningInstance>();
  readonly memory: Memory;
  readonly local: boolean;
  readonly trace?: (event: TraceEvent) => void;
  private cursor = 0;
  steps = 0;
  fed = 0;

  constructor(ids: string[] | number = 4, options: InstancePoolOptions = {}) {
    this.local = options.local ?? false;
    this.trace = options.trace;
    this.memory = options.memory ?? new Memory();
    const list = typeof ids === "number"
      ? Array.from({ length: Math.max(0, Math.floor(ids)) }, (_, index) => `${options.prefix ?? "instance"}#${index}`)
      : ids;
    for (const id of list) {
      if (this.byId.has(id)) continue;
      const memory = this.local ? new Memory() : this.memory;
      const worker = new ReasoningInstance(id, memory, options);
      this.instances.push(worker);
      this.byId.set(id, worker);
    }
  }

  get size(): number {
    return this.instances.length;
  }

  instance(id: string): ReasoningInstance | null {
    return this.byId.get(id) ?? null;
  }

  /** 按 term key 哈希到实例，保持同一 term 的连续工作落在同一实例；也可显式指定 all/id。 */
  feed(term: Term, truth: Truth, priority = 0.6, target?: string | string[] | "all"): number {
    if (this.instances.length === 0) return 0;
    let workers: ReasoningInstance[];
    if (target === "all") {
      workers = this.instances;
    } else if (typeof target === "string") {
      const worker = this.byId.get(target);
      if (!worker) throw new Error(`unknown instance: ${target}`);
      workers = [worker];
    } else if (Array.isArray(target)) {
      workers = target.map((id) => this.byId.get(id)).filter((worker): worker is ReasoningInstance => !!worker);
    } else {
      workers = [this.instances[hash(term.key) % this.instances.length]!];
    }
    for (const worker of workers) {
      worker.engine.feed(term, truth, priority);
      this.fed++;
    }
    return workers.length;
  }

  /** 每个实例轮流走一步；这是逻辑并行，实际由调用方决定是否放到 worker/线程里。 */
  step(cycles = 1): number {
    let ran = 0;
    for (let cycle = 0; cycle < cycles; cycle++) {
      for (const worker of this.instances) {
        if (worker.engine.step()) {
          ran++;
          this.steps++;
        }
      }
    }
    return ran;
  }

  run(cycles = 1000): number {
    return this.step(Math.max(0, Math.floor(cycles)));
  }

  /** 每个实例各自能给出的答案；共享黑板时结果会相同，但 instanceId 保留。 */
  ask(term: Term): InstanceAnswer[] {
    const answers: InstanceAnswer[] = [];
    for (const worker of this.instances) {
      const answer = worker.memory.ask(term);
      if (answer) answers.push({ instanceId: worker.id, term: answer.term, truth: answer.truth });
    }
    return answers;
  }

  /** 独立记忆时汇总到目标 Memory（共享模式直接返回目标）。 */
  merge(target: Memory = this.memory): Memory {
    if (!this.local) return target;
    for (const worker of this.instances) {
      for (const belief of worker.memory.beliefs()) target.addBelief(belief);
    }
    return target;
  }

  stats(): Array<{ id: string; steps: number; derived: number; concepts: number }> {
    return this.instances.map((worker) => ({
      id: worker.id,
      steps: worker.engine.steps,
      derived: worker.engine.derived,
      concepts: worker.memory.size(),
    }));
  }
}
