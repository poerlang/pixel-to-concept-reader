import { Atom } from './term.ts'

/**
 * 会话词表：系统说到的那些“东西”。
 *
 * 这个项目处理的是词项/集合，不生成 <当前格 --> 白> 这类陈述句；
 * 初始只有黑、白两个颜色词项，扫描后由它们合成顺序对和集合。
 */
export const Vocabulary = {
  /** 黑白两种感知 */
  black: new Atom('黑'),
  white: new Atom('白'),
} as const
