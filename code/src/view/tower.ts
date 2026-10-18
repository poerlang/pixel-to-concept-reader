// 层塔 + 四叉树：记忆概念网络的**只读**投影（给显示/调试/同行评议用，不参与推理）
//
// 层的口径：一层 = 词项的句法深度（原子 0、性质集/复合词项 1、陈述 2、关于陈述的陈述 3…）。
// 四叉树的依据：词项里出现的格原子（cell_i_j）→ 重心 → 甲板坐标（一格宽 0.75，与 pdftest5 一致）。
// 没有任何写回记忆的路径：随时可以由记忆重建，也可以丢掉。

import type { Memory } from "../nars/memory.ts";
import type { Term } from "../nars/term.ts";
import { atomsOf } from "../nars/term.ts";
import { expectation } from "../nars/truth.ts";

export type TowerPoint = {
  key: string;
  label: string;
  layer: number;
  complexity: number;
  x: number;
  y: number;
  f: number;
  c: number;
  priority: number;
};

export type TowerLeaf = { cx: number; cy: number; half: number; depth: number; points: TowerPoint[] };
export type TowerLayer = { index: number; name: string; count: number; leaves: TowerLeaf[] };
export type Tower = {
  layers: TowerLayer[];
  stats: { concepts: number; placed: number; leaves: number };
};

const CELL = /^cell_(\d+)_(\d+)$/;
const CELL_WIDTH = 12 / 16;
const HALF = 6;
const CAPACITY = 4;
const DEPTH = 4;

const LAYER_NAMES = ["L0 原子", "L1 性质集 / 复合词项", "L2 陈述", "L3 关于陈述的陈述"];

/** 格原子的重心 → 甲板坐标；没有格原子的概念按 key 散到一个确定的位置 */
function hashOf(text: string, salt: number): number {
  let h = 2166136261 ^ salt;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return ((h >>> 0) % 100000) / 100000;
}

function positionOf(termKey: string, atoms: string[]): { x: number; y: number; spatial: boolean } {
  let sx = 0;
  let sy = 0;
  let n = 0;
  for (const name of atoms) {
    const hit = CELL.exec(name);
    if (!hit) continue;
    sx += Number(hit[1]) + 0.5;
    sy += Number(hit[2]) + 0.5;
    n++;
  }
  // 格内抖动：同一个格上的多个概念（10 个类别、上千条陈述）不再叠成一个点
  const jx = (hashOf(termKey, 0x9e37) - 0.5) * 0.5;
  const jy = (hashOf(termKey, 0x85eb) - 0.5) * 0.5;
  if (n > 0) return { x: -HALF + (sx / n) * CELL_WIDTH + jx, y: -HALF + (sy / n) * CELL_WIDTH + jy, spatial: true };
  return { x: (hashOf(termKey, 0xc2b2) - 0.5) * 2 * HALF * 0.8, y: (hashOf(termKey, 0x27d4) - 0.5) * 2 * HALF * 0.8, spatial: false };
}

type QuadNode = { depth: number; cx: number; cy: number; half: number; children: QuadNode[] | null; points: TowerPoint[] };

const makeNode = (depth: number, cx: number, cy: number, half: number): QuadNode => ({ depth, cx, cy, half, children: null, points: [] });

function insert(node: QuadNode, point: TowerPoint): void {
  if (!node.children) {
    if (node.depth >= DEPTH || node.points.length < CAPACITY) {
      node.points.push(point);
      return;
    }
    // 该分了：先把已有的点分下去，否则它们会留在父节点里、在叶子里看不到
    const half = node.half / 2;
    node.children = [
      makeNode(node.depth + 1, node.cx - half, node.cy - half, half),
      makeNode(node.depth + 1, node.cx + half, node.cy - half, half),
      makeNode(node.depth + 1, node.cx - half, node.cy + half, half),
      makeNode(node.depth + 1, node.cx + half, node.cy + half, half),
    ];
    const existing = node.points;
    node.points = [];
    for (const old of existing) insert(node, old);
  }
  const right = point.x >= node.cx ? 1 : 0;
  const bottom = point.y >= node.cy ? 1 : 0;
  insert(node.children[bottom * 2 + right]!, point);
}

function collectLeaves(node: QuadNode, out: TowerLeaf[]): void {
  if (node.children) {
    for (const child of node.children) collectLeaves(child, out);
    return;
  }
  if (node.points.length === 0) return;
  out.push({ cx: node.cx, cy: node.cy, half: node.half, depth: node.depth, points: node.points });
}

export function buildTower(memory: Memory): Tower {
  // 概念的标识词项与它们的成分词项都进视图：没有信念的词项（性质集、原子）也是记忆网络的一部分
  const terms = new Map<string, Term>();
  const collect = (term: Term): void => {
    if (terms.has(term.key)) return;
    terms.set(term.key, term);
    for (const comp of term.comps ?? []) collect(comp);
  };
  for (const concept of memory.concepts.values()) collect(concept.term);

  const roots = new Map<number, QuadNode>();
  let placed = 0;
  for (const term of terms.values()) {
    const belief = memory.concepts.get(term.key)?.best() ?? null;
    const layer = term.depth;
    const position = positionOf(term.key, atomsOf(term));
    const point: TowerPoint = {
      key: term.key,
      label: labelOf(term.key),
      layer,
      complexity: term.complexity,
      x: position.x,
      y: position.y,
      f: belief?.truth.f ?? 0.5,
      c: belief?.truth.c ?? 0,
      priority: belief ? expectation(belief.truth) : 0,
    };
    if (!roots.has(layer)) roots.set(layer, makeNode(0, 0, 0, HALF));
    insert(roots.get(layer)!, point);
    placed++;
  }
  const layers: TowerLayer[] = [];
  let leaves = 0;
  for (const index of [...roots.keys()].sort((a, b) => a - b)) {
    const out: TowerLeaf[] = [];
    collectLeaves(roots.get(index)!, out);
    leaves += out.length;
    layers.push({ index, name: LAYER_NAMES[index] ?? `L${index} 更深结构`, count: out.reduce((sum, leaf) => sum + leaf.points.length, 0), leaves: out });
  }
  return { layers, stats: { concepts: memory.size(), placed, leaves } };
}

/** 把词项 key 变成短标签：只保留最有信息的那几个原子 */
export function labelOf(key: string): string {
  const atoms = key.replace(/[()[\],]/g, " ").split(/\s+/).filter((part) => part.length > 0);
  return atoms.slice(0, 3).join(" ");
}
