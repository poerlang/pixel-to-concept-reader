// 一个极简 3D 世界：只有实体、颜色、位置、运动、大小。
//
// 这里没有“圆/凸/边界/近邻”的概念，也没有形状检测；
// 只产生普通属性观察，交给 Buffer + NAL 去形成经验。

import type { Term } from "../nars/term.ts";
import { atom, inheritance, property } from "../nars/term.ts";
import type { Truth } from "../nars/truth.ts";

export type Entity = {
  id: string;
  color: "red" | "green" | "blue" | "yellow" | "cyan" | "magenta";
  x: number;
  y: number;
  z: number;
  vx: number;
  vz: number;
  size: "small" | "medium" | "big";
  moving: boolean;
};

export type Scene = {
  time: number;
  entities: Entity[];
};

export type Observation = {
  term: Term;
  truth: Truth;
  priority: number;
  entity: string;
};

/** 实体的普通属性名；没有形状/类别含义，只是通道可读的属性。 */
export function propertiesOf(entity: Entity): string[] {
  return [
    `color_${entity.color}`,
    `x_${BIN(entity.x)}`,
    `y_${BIN(entity.y)}`,
    `z_${BIN(entity.z)}`,
    entity.moving ? "moving" : "still",
    `size_${entity.size}`,
  ];
}

const START: Entity[] = [
  { id: "thing_0", color: "red", x: -1.5, y: 0.6, z: -1, vx: 0.31, vz: 0.17, size: "big", moving: true },
  { id: "thing_1", color: "green", x: 1.1, y: 0.9, z: 0.4, vx: -0.23, vz: 0.29, size: "small", moving: true },
  { id: "thing_2", color: "blue", x: 0.2, y: 0.3, z: 1.4, vx: 0.13, vz: -0.27, size: "small", moving: true },
  { id: "thing_3", color: "red", x: 1.8, y: 0.5, z: -1.6, vx: -0.17, vz: 0.21, size: "small", moving: true },
  { id: "thing_4", color: "green", x: -1.9, y: 0.4, z: 1.1, vx: 0.19, vz: -0.33, size: "big", moving: true },
];

const BIN = (value: number): string => {
  if (value < -1) return "n";
  if (value < 0) return "m";
  if (value < 1) return "p";
  return "q";
};

export class World {
  entities: Entity[] = START.map((entity) => ({ ...entity }));
  time = 0;

  step(): Scene {
    this.time++;
    for (const entity of this.entities) {
      entity.x += entity.vx;
      entity.z += entity.vz;
      if (entity.x < -2 || entity.x > 2) {
        entity.vx *= -1;
        entity.x = Math.max(-2, Math.min(2, entity.x));
      }
      if (entity.z < -2 || entity.z > 2) {
        entity.vz *= -1;
        entity.z = Math.max(-2, Math.min(2, entity.z));
      }
      entity.y = 0.5 + 0.35 * Math.abs(Math.sin((this.time + Number(entity.id.slice(-1))) * 0.7));
      entity.moving = Math.abs(entity.vx) + Math.abs(entity.vz) > 0.2;
    }
    return { time: this.time, entities: this.entities.map((entity) => ({ ...entity })) };
  }

  /** 增加一个普通实体；只给已有属性类型，不引入新概念种类。 */
  spawn(): Entity {
    const n = this.entities.length;
    const colors = ["red", "green", "blue", "yellow", "cyan", "magenta"] as const;
    const color = colors[n % colors.length]!;
    const sizes = ["small", "medium", "big"] as const;
    const entity: Entity = {
      id: `thing_${n}`,
      color,
      x: ((n % 5) - 2) * 0.8,
      y: 0.5,
      z: (((n * 2) % 5) - 2) * 0.8,
      vx: (n % 2 === 0 ? 1 : -1) * (0.11 + 0.03 * (n % 4)),
      vz: (n % 3 === 0 ? 1 : -1) * (0.09 + 0.02 * (n % 5)),
      size: sizes[n % sizes.length]!,
      moving: true,
    };
    this.entities.push(entity);
    return entity;
  }

  observations(scene: Scene): Observation[] {
    const out: Observation[] = [];
    for (const entity of scene.entities) {
      const subject = atom(entity.id);
      for (const name of propertiesOf(entity)) {
        out.push({
          term: inheritance(subject, property(name)),
          truth: { f: 1, c: 0.9 },
          priority: 0.6,
          entity: entity.id,
        });
      }
    }
    return out;
  }
}
