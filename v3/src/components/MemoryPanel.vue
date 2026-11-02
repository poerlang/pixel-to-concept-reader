<script setup lang="ts">
import { computed } from 'vue'
import { clearMemory, goalInfo, memorySnapshot, type MemoryView } from '../nars/index.ts'
import { markNarsChanged, narsRevision } from '../narsLive.ts'

/** 一行：概念 / 句子 / 细节（成分、项链） */
type Row = {
  key: string
  kind: 'concept' | 'sentence' | 'detail'
  label: string
  meta: string
  goal: boolean
}

const view = computed<MemoryView>(() => {
  narsRevision.value
  return memorySnapshot()
})

/** 概念 → 句子 → 词项成分/项链，拍平成带层级的行 */
const rows = computed<Row[]>(() => {
  const goal = goalInfo()
  const sorted = [...view.value.concepts].sort((left, right) => {
    // 目标概念置顶；然后是有句子的概念（按句子数）；空概念排最后
    if (left.key === goal.key) return -1
    if (right.key === goal.key) return 1
    const leftEmpty = totalCount(left) === 0
    const rightEmpty = totalCount(right) === 0
    if (leftEmpty !== rightEmpty) return leftEmpty ? 1 : -1
    if (leftEmpty) return left.complexity - right.complexity
    return totalCount(right) - totalCount(left)
  })

  const list: Row[] = []
  for (const concept of sorted) {
    const total = totalCount(concept)
    list.push({
      key: `c:${concept.key}`,
      kind: 'concept',
      label: concept.label,
      meta: `${total ? `${total} 句` : '空概念'} · f ${concept.frequency.toFixed(2)} · c ${concept.confidence.toFixed(2)} · 复杂度 ${concept.complexity}`,
      goal: concept.key === goal.key,
    })
    // 空概念只有一行，不展开成分/项链，免得刷屏
    if (!total) continue
    for (const sentence of concept.sentences) {
      list.push({
        key: `s:${concept.key}:${sentence.punct}:${sentence.text}`,
        kind: 'sentence',
        label: sentence.text,
        meta: `${sentence.truth}${sentence.count > 1 ? ` ×${sentence.count}` : ''}`,
        goal: false,
      })
    }
    if (concept.components.length) {
      list.push({
        key: `k:${concept.key}`,
        kind: 'detail',
        label: `成分 ${concept.components.join(' · ')}`,
        meta: '',
        goal: false,
      })
    }
    if (concept.childTasks.length) {
      const shown = concept.childTasks.slice(0, 6)
      list.push({
        key: `t:${concept.key}`,
        kind: 'detail',
        label: `子句 ${shown.join(' · ')}${concept.childTasks.length > shown.length ? ` … +${concept.childTasks.length - shown.length}` : ''}`,
        meta: '',
        goal: false,
      })
    }
    if (concept.links.length) {
      list.push({
        key: `l:${concept.key}`,
        kind: 'detail',
        label: `词项链 ${concept.links.join(' ')}`,
        meta: '',
        goal: false,
      })
    }
  }
  return list
})

/** 空概念个数 */
const emptyCount = computed(() => {
  return view.value.concepts.filter((concept) => totalCount(concept) === 0).length
})

function totalCount(concept: MemoryView['concepts'][number]): number {
  return concept.counts.beliefs + concept.counts.desires + concept.counts.questions
}

function clear() {
  clearMemory()
  markNarsChanged()
}
</script>

<template>
  <section class="panel memory">
    <header class="panel-head">
      <div>
        <h2 class="panel-title">记忆体</h2>
        <p class="panel-sub">
          {{ view.sentenceCount }} 句 · {{ view.conceptCount }} 概念（{{ emptyCount }} 空）
        </p>
      </div>
      <button class="btn tiny" @click="clear">清空</button>
    </header>

    <div class="scroll-y tree">
      <p v-if="!rows.length" class="empty">
        还没有记忆。设个目标或点「单步」，句子会落进它内容命名的概念里。
      </p>
      <div v-for="row in rows" :key="row.key" class="node" :class="[row.kind, { goal: row.goal }]">
        <span class="node-label mono">{{ row.label }}</span>
        <span v-if="row.meta" class="node-meta mono">{{ row.meta }}</span>
        <span v-if="row.goal" class="badge">目标</span>
      </div>
    </div>
  </section>
</template>

<style scoped>
.memory {
  flex: 0 0 356px;
  min-height: 0;
}

.tree {
  padding: 6px 8px 10px;
}

.node {
  display: flex;
  align-items: baseline;
  gap: 6px;
  padding: 3px 6px 3px 0;
  border-radius: 6px;
  font-size: 11.5px;
  color: var(--muted);
  min-width: 0;
}

.node.concept {
  color: var(--ink);
  font-weight: 500;
  margin-top: 4px;
  padding-left: 2px;
}

.node.sentence {
  padding-left: 12px;
  color: var(--muted);
}

.node.detail {
  padding-left: 12px;
  color: var(--faint);
  font-size: 10.5px;
}

.node.goal {
  background: rgba(240, 180, 41, 0.1);
  color: var(--amber);
}

.node-label {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.node-meta {
  margin-left: auto;
  flex: 0 0 auto;
  font-size: 10px;
  color: var(--faint);
}

.badge {
  flex: 0 0 auto;
  padding: 0 5px;
  border-radius: 999px;
  border: 1px solid rgba(240, 180, 41, 0.45);
  font-size: 9.5px;
  line-height: 1.5;
  color: var(--amber);
}

.empty {
  margin: 0;
  padding: 14px 10px;
  font-size: 11.5px;
  line-height: 1.8;
  color: var(--faint);
}
</style>
