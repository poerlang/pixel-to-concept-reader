// 图形世界：只生成像素图，不做识别。
//
// 这些是“给系统看的经验材料”，不是感知代码；系统只看到 16×16 的 0/1 格。

import { SIZE, type Figure } from "../src/visual/types.ts";

export type { Figure } from "../src/visual/types.ts";

export function blank(value = 0): number[] {
  return Array(SIZE * SIZE).fill(value);
}

const put = (grid: number[], x: number, y: number): void => {
  if (x >= 0 && x < SIZE && y >= 0 && y < SIZE) grid[y * SIZE + x] = 1;
};

const disc = (grid: number[], cx: number, cy: number, r: number): void => {
  for (let y = 0; y < SIZE; y++) for (let x = 0; x < SIZE; x++) {
    if (Math.hypot(x + 0.5 - cx, y + 0.5 - cy) <= r) put(grid, x, y);
  }
};

const ring = (grid: number[], cx: number, cy: number, r: number, thickness: number): void => {
  const inner = Math.max(0, r - thickness / 2);
  const outer = r + thickness / 2;
  for (let y = 0; y < SIZE; y++) for (let x = 0; x < SIZE; x++) {
    const d = Math.hypot(x + 0.5 - cx, y + 0.5 - cy);
    if (d >= inner && d <= outer) put(grid, x, y);
  }
};

const stroke = (grid: number[], cx: number, cy: number, thickness: number): void => {
  if (thickness <= 1) put(grid, Math.round(cx), Math.round(cy));
  else disc(grid, cx, cy, thickness / 2);
};

const line = (grid: number[], x0: number, y0: number, x1: number, y1: number, thickness: number): void => {
  const steps = Math.ceil(Math.hypot(x1 - x0, y1 - y0) * 5);
  for (let i = 0; i <= steps; i++) {
    const t = i / Math.max(1, steps);
    stroke(grid, x0 + (x1 - x0) * t, y0 + (y1 - y0) * t, thickness);
  }
};

const arc = (grid: number[], cx: number, cy: number, r: number, start: number, end: number, thickness: number): void => {
  const steps = Math.ceil(Math.abs(end - start) * r * 6);
  for (let i = 0; i <= steps; i++) {
    const a = start + (end - start) * (i / Math.max(1, steps));
    stroke(grid, cx + Math.cos(a) * r, cy + Math.sin(a) * r, thickness);
  }
};

const polyline = (grid: number[], points: Array<[number, number]>, thickness: number): void => {
  for (let i = 1; i < points.length; i++) {
    line(grid, points[i - 1]![0], points[i - 1]![1], points[i]![0], points[i]![1], thickness);
  }
};

const figure = (id: string, name: string, grid: number[], background: "black" | "white", parts: string[] = []): Figure =>
  ({ id, name, grid, background, parts });

export function simpleFigures(): Figure[] {
  const out: Figure[] = [];
  out.push(figure("bg_black", "纯黑背景", blank(0), "black"));
  out.push(figure("bg_white", "纯白背景", blank(1), "white"));

  for (const r of [1, 2, 3]) out.push(figure(`dot_${r}`, `${r}号圆点`, (() => {
    const g = blank(); disc(g, 8, 8, r); return g;
  })(), "black", ["dot"]));

  for (const t of [1, 2, 3]) out.push(figure(`circle_${t}`, `${t}号细圆`, (() => {
    const g = blank(); ring(g, 8, 8, 5, t); return g;
  })(), "black", ["circle"]));

  for (const t of [1, 2, 3]) {
    const g = blank(); line(g, 2, 8, 13, 8, t);
    out.push(figure(`line_h_${t}`, `${t}号横线`, g, "black", ["line"]));
    const v = blank(); line(v, 8, 2, 8, 13, t);
    out.push(figure(`line_v_${t}`, `${t}号竖线`, v, "black", ["line"]));
  }

  for (const t of [1, 2, 3]) {
    const g = blank(); line(g, 3, 12, 12, 3, t);
    out.push(figure(`line_d_${t}`, `${t}号斜线`, g, "black", ["line"]));
  }

  for (const t of [1, 2]) {
    const g = blank();
    line(g, 3, 12, 12, 12, t);
    line(g, 12, 12, 12, 3, t);
    out.push(figure(`angle_${t}`, `${t}号角`, g, "black", ["angle"]));
  }

  for (const t of [1, 2]) {
    const g = blank();
    for (let x = 3; x <= 12; x++) {
      const y = 8 + 3.2 * Math.sin(((x - 3) / 9) * Math.PI * 2);
      stroke(g, x, y, t);
    }
    out.push(figure(`s_${t}`, `${t}号S`, g, "black", ["s"]));
  }

  for (const t of [1, 2, 3]) {
    const g = blank(); arc(g, 8, 8, 5, Math.PI, Math.PI * 2, t);
    out.push(figure(`arc_${t}`, `${t}号半圆`, g, "black", ["arc"]));
  }

  for (const t of [3, 4]) {
    const g = blank(); line(g, 2, 8, 13, 8, t);
    out.push(figure(`thick_line_${t}`, `${t}号粗线`, g, "black", ["line"]));
  }

  for (const t of [3, 4]) {
    const g = blank(); ring(g, 8, 8, 5.5, t);
    out.push(figure(`thick_ring_${t}`, `${t}号粗圆`, g, "black", ["circle"]));
  }

  const p1 = blank(); polyline(p1, [[3, 12], [6, 5], [9, 11], [12, 4]], 1);
  out.push(figure("polyline_1", "1号折线", p1, "black", ["polyline"]));
  const p2 = blank(); polyline(p2, [[2, 12], [5, 8], [8, 11], [11, 6], [13, 9]], 2);
  out.push(figure("polyline_2", "2号折线", p2, "black", ["polyline"]));

  // 白底版本：只把 0/1 反过来；系统仍只看到局部 0/1 模式。
  const invert = (grid: number[]): number[] => grid.map((cell) => (cell ? 0 : 1));
  const whiteCircle = blank(); ring(whiteCircle, 8, 8, 5, 1);
  out.push(figure("white_circle_1", "白底细圆", invert(whiteCircle), "white", ["circle"]));
  const whiteLine = blank(); line(whiteLine, 2, 8, 13, 8, 1);
  out.push(figure("white_line_1", "白底横线", invert(whiteLine), "white", ["line"]));
  const whiteDot = blank(); disc(whiteDot, 8, 8, 2);
  out.push(figure("white_dot_2", "白底圆点", invert(whiteDot), "white", ["dot"]));
  return out;
}

function combine(a: Figure, b: Figure, dx: number, dy: number): number[] {
  const out = a.grid.slice();
  for (let y = 0; y < SIZE; y++) for (let x = 0; x < SIZE; x++) {
    const bx = x - dx;
    const by = y - dy;
    if (bx < 0 || by < 0 || bx >= SIZE || by >= SIZE) continue;
    if (b.grid[by * SIZE + bx]) out[y * SIZE + x] = 1;
  }
  return out;
}

export function complexFigures(simple: Figure[]): Figure[] {
  const byId = new Map(simple.map((item) => [item.id, item]));
  const get = (id: string): Figure => byId.get(id)!;
  const out: Figure[] = [];
  const pairs: Array<[string, string, number, number, string]> = [
    ["circle_1", "line_h_1", 0, 5, "圆 + 横线"],
    ["circle_2", "dot_2", 4, 4, "圆 + 圆点"],
    ["angle_1", "dot_1", -4, 2, "角 + 圆点"],
    ["s_1", "line_v_1", 4, 0, "S + 竖线"],
    ["arc_1", "line_d_1", 4, 4, "半圆 + 斜线"],
    ["thick_ring_3", "thick_line_3", 0, -4, "粗圆 + 粗线"],
    ["polyline_1", "circle_1", 4, -3, "折线 + 圆"],
  ];
  for (const [a, b, dx, dy, name] of pairs) {
    const left = get(a);
    const right = get(b);
    out.push(figure(`complex_${a}_${b}`, name, combine(left, right, dx, dy), "black", [a, b]));
  }
  return out;
}

export function allFigures(): { simple: Figure[]; complex: Figure[] } {
  const simple = simpleFigures();
  return { simple, complex: complexFigures(simple) };
}
