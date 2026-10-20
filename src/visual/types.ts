// 视觉经验的通用类型；图形数据由 tools 侧生成。

export const SIZE = 16;

export type Figure = {
  id: string;
  name: string;
  grid: number[];
  background: "black" | "white";
  parts: string[];
};
