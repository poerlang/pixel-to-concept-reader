// MNIST 读出（只有搬运与降采样，没有任何识别成分）
import { readFileSync } from "node:fs";

export type Mnist = {
  size: number;
  pixels: Uint8Array;
  segments: Array<{ digit: number; start: number; count: number }>;
};

export function loadMnist(dir = "public/mnist"): Mnist {
  const meta = JSON.parse(readFileSync(`${dir}/mnist.json`, "utf8")) as {
    size: number;
    segments?: Array<{ digit: number; start: number; count: number }>;
  };
  const pixels = new Uint8Array(readFileSync(`${dir}/mnist.bin`));
  return { size: meta.size, pixels, segments: meta.segments ?? [] };
}

/** 某类数字的第 offset..offset+count 张（返回全局下标） */
export function indicesOf(mnist: Mnist, digit: number, offset: number, count: number): number[] {
  const segment = mnist.segments.find((s) => s.digit === digit);
  if (!segment) return [];
  const out: number[] = [];
  for (let i = segment.start + offset; i < segment.start + segment.count && out.length < count; i++) out.push(i);
  return out;
}

/** 28×28 → gs×gs 的均值降采样，读数 0..1 */
export function gridOf(mnist: Mnist, index: number, gs = 16): number[] {
  const src = mnist.size;
  const out = new Array<number>(gs * gs).fill(0);
  for (let y = 0; y < gs; y++) {
    for (let x = 0; x < gs; x++) {
      const x0 = Math.floor((x * src) / gs);
      const x1 = Math.max(x0 + 1, Math.floor(((x + 1) * src) / gs));
      const y0 = Math.floor((y * src) / gs);
      const y1 = Math.max(y0 + 1, Math.floor(((y + 1) * src) / gs));
      let sum = 0;
      let n = 0;
      for (let sy = y0; sy < y1; sy++) {
        for (let sx = x0; sx < x1; sx++) {
          sum += mnist.pixels[index * src * src + sy * src + sx]!;
          n++;
        }
      }
      out[y * gs + x] = n > 0 ? sum / n / 255 : 0;
    }
  }
  return out;
}
