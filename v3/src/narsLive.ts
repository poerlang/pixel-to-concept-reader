import { ref } from 'vue'

/**
 * NARS 状态版本号。
 * nars 模块本身不依赖 Vue，界面靠这个计数器知道自己该重算快照了。
 */
export const narsRevision = ref(0)

/** step / 设目标 / 换图 / 清空之后调用 */
export function markNarsChanged(): void {
  narsRevision.value += 1
}
