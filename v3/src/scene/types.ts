/** 图像边长（MNIST 与基础形状统一用 28×28） */
export const IMAGE_SIDE = 28
/** 每张图的字节数 */
export const PIXEL_COUNT = IMAGE_SIDE * IMAGE_SIDE

/** 素材来源类型 */
export type SceneKind = 'mnist' | 'shape'

/** 场景里的一个对象 */
export type SceneItem = {
  id: string
  kind: SceneKind
  /** 列表/画布上显示的名字 */
  label: string
  /** 来源标记，如 mnist:1234 / shape:circle */
  source: string
  /** 中心点，0..1 */
  x: number
  /** 中心点，0..1 */
  y: number
  /** 半径（半边长），0..1 */
  radius: number
  /** 反色显示 */
  invert: boolean
  /** 28×28 灰度，0..255 */
  pixels: Uint8Array
}

/** 素材库里的一条（还没有放进场景） */
export type LibrarySample = {
  key: string
  kind: SceneKind
  label: string
  source: string
  pixels: Uint8Array
}
