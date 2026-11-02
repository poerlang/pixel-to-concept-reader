<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import {
  attentionParams,
  boardSnapshot,
  conceptEntries,
  cycleEntries,
  driveInfo,
  goalInfo,
  readableTerms,
  resetBuffer,
  sentenceEntries,
  setAttentionParams,
  setGoal,
  step,
  type AttentionSettings,
  type ConceptEntry,
  type CycleResult,
  type DriveInfo,
  type GoalInfo,
  type Term,
} from '../nars/index.ts'
import { markNarsChanged, narsRevision } from '../narsLive.ts'
import { appliedId, applyItem } from '../runtime.ts'
import { useScene } from '../scene/store.ts'

const { selected, items, flash } = useScene()

const running = ref(false)
const snapshot = ref(boardSnapshot())
const concepts = ref<ConceptEntry[]>(conceptEntries())
const sentences = ref(sentenceEntries())
const goal = ref<GoalInfo>(goalInfo())
const drive = ref<DriveInfo>(driveInfo())
const cycles = ref<CycleResult[]>(cycleEntries(12))
const attention = ref<AttentionSettings>(attentionParams())

function applyAttention() {
  attention.value = setAttentionParams(attention.value)
}

const goalOptions: { text: string; value: Term | null }[] = [
  { text: '无', value: null },
  ...readableTerms().map((term) => ({ text: term.format(), value: term })),
]

let timer: ReturnType<typeof setInterval> | null = null

const lastText = computed(() => {
  const last = snapshot.value.lastStep
  if (!last) return '—'
  return `${last.pursuit ? '追 ' : ''}${last.operation} → ${last.percept}`
})

const lastPos = computed(() => {
  const last = snapshot.value.lastStep
  return last ? `(${last.x.toFixed(2)}, ${last.y.toFixed(2)})` : '—'
})

/** 当前计划里的算子熟练度；不再写死 shiftX / shiftY */
const skillText = computed(() => {
  const entries = Object.entries(drive.value.skills)
  if (!entries.length) return '暂无操作'
  return entries.map(([operator, skill]) => `${operator} ${skill.toFixed(2)}`).join(' · ')
})

const goalNote = computed(() => {
  if (!goal.value.label) return '未设目标'
  return goal.value.found ? `记忆体里有 ${goal.value.beliefs} 条` : '记忆体里没有，新建'
})

/** 当前喂给运行台的对象（扫描头画在场景里） */
const appliedLabel = computed(() => {
  narsRevision.value
  return items.value.find((item) => item.id === appliedId.value)?.label ?? '—'
})

/** 扫描头脚下这一格的颜色 */
const readingLabel = computed(() => (snapshot.value.reading === 1 ? '黑' : '白'))

function pull() {
  snapshot.value = boardSnapshot()
  concepts.value = conceptEntries()
  sentences.value = sentenceEntries()
  goal.value = goalInfo()
  drive.value = driveInfo()
  cycles.value = cycleEntries(12)
  attention.value = attentionParams()
}

function refresh() {
  pull()
  markNarsChanged()
}

function stepOnce() {
  step()
  refresh()
}

function stopRun() {
  running.value = false
  if (timer) {
    clearInterval(timer)
    timer = null
  }
}

function toggleRun() {
  if (running.value) {
    stopRun()
    return
  }
  running.value = true
  timer = setInterval(stepOnce, 160)
}

function clearBuffer() {
  resetBuffer()
  refresh()
}

function chooseGoal(value: Term | null) {
  setGoal(value)
  stopRun()
  refresh()
}

/** 把选中对象的当前像素重新喂进视野（改过像素 / 反色之后用） */
function loadSelected() {
  const item = selected.value
  if (!item) {
    flash('先在场景里选中一个对象')
    return
  }
  applyItem(item)
  stopRun()
}

// 别处（记忆体面板）清了记忆，这里跟着刷新
watch(narsRevision, () => pull())

onMounted(pull)
onBeforeUnmount(stopRun)
</script>

<template>
  <section class="panel nars">
    <header class="panel-head">
      <div>
        <h2 class="panel-title">NARS 运行台</h2>
        <p class="panel-sub">扫描 → 词项 → 概念 · 扫描头画在场景里</p>
      </div>
      <details class="attention">
        <summary>注意力</summary>
        <div class="attention-panel">
          <label class="attention-row">
            <span>节能</span>
            <input v-model.number="attention.energy" type="range" min="0" max="1" step="0.05" @input="applyAttention" />
            <b class="mono">{{ attention.energy.toFixed(2) }}</b>
          </label>
          <label class="attention-row">
            <span>惯性</span>
            <input v-model.number="attention.inertia" type="range" min="0" max="1" step="0.05" @input="applyAttention" />
            <b class="mono">{{ attention.inertia.toFixed(2) }}</b>
          </label>
          <label class="attention-row">
            <span>显著</span>
            <input v-model.number="attention.salience" type="range" min="0" max="1" step="0.05" @input="applyAttention" />
            <b class="mono">{{ attention.salience.toFixed(2) }}</b>
          </label>
          <label class="attention-row">
            <span>探索</span>
            <input v-model.number="attention.novelty" type="range" min="0" max="1" step="0.05" @input="applyAttention" />
            <b class="mono">{{ attention.novelty.toFixed(2) }}</b>
          </label>
          <label class="attention-row">
            <span>温度</span>
            <input v-model.number="attention.temperature" type="range" min="0" max="1" step="0.05" @input="applyAttention" />
            <b class="mono">{{ attention.temperature.toFixed(2) }}</b>
          </label>
          <div class="attention-note mono">只调操作选择，不产生线/曲线词项</div>
        </div>
      </details>
      <div class="nars-actions">
        <button class="btn tiny" @click="stepOnce">
          <svg class="play-icon" viewBox="0 0 16 16" aria-hidden="true">
            <path d="M4 3.2v9.6l7.4-4.8z" />
            <rect x="12.6" y="3" width="1.8" height="10" rx="0.8" />
          </svg>
          单步
        </button>
        <button class="btn tiny" :class="{ primary: running }" @click="toggleRun">
          <svg v-if="!running" class="play-icon" viewBox="0 0 16 16" aria-hidden="true">
            <path d="M4.2 2.8v10.4L13.4 8z" />
          </svg>
          <svg v-else class="play-icon" viewBox="0 0 16 16" aria-hidden="true">
            <rect x="4" y="3" width="2.6" height="10" rx="0.8" />
            <rect x="9.4" y="3" width="2.6" height="10" rx="0.8" />
          </svg>
          {{ running ? '暂停' : '连跑' }}
        </button>
        <button class="btn tiny" @click="clearBuffer">清空缓冲</button>
        <button class="btn tiny" @click="loadSelected">取选中图</button>
      </div>
    </header>

    <div class="nars-body">
      <div class="nars-meta">
        <div class="goal-row">
          <span>目标</span>
          <button
            v-for="option in goalOptions"
            :key="option.text"
            class="goal-chip"
            :class="{ active: goal.label === (option.value?.format() ?? null) }"
            @click="chooseGoal(option.value)"
          >
            {{ option.text }}
          </button>
        </div>
        <div class="goal-note">{{ goalNote }}</div>
        <div class="line">
          <span>视野</span>
          <b class="mono vision">{{ appliedLabel }} · {{ readingLabel }}</b>
        </div>
        <div
          class="guidance"
          :title="`目标强度 ${drive.goalStrength.toFixed(2)} · ${skillText}`"
        >
          <span>引导</span>
          <span class="g-bar"><i :style="{ width: `${Math.round(drive.guidance * 100)}%` }" /></span>
          <b class="mono">{{ drive.guidance.toFixed(2) }}</b>
        </div>
        <div class="line"><span>步数</span><b class="mono">{{ snapshot.stepCount }}</b></div>
        <div class="line"><span>缓冲</span><b class="mono">{{ snapshot.bufferSize }}</b></div>
        <div class="line"><span>上次</span><b class="mono">{{ lastText }}</b></div>
        <div class="line"><span>坐标</span><b class="mono">{{ lastPos }}</b></div>
      </div>

      <div class="sorted">
        <div class="sorted-head">
          <span>概念排序</span>
          <span class="sorted-note">记忆体 · {{ snapshot.conceptCount }} 概念</span>
        </div>
        <div class="list">
          <div v-if="!concepts.length" class="empty">还没有概念</div>
          <div
            v-for="entry in concepts"
            :key="entry.key"
            class="row"
            :class="{ top: entry.rank === 1 }"
            :title="`${entry.label} · ${entry.kind} · ${entry.sentences} 句 · f ${entry.frequency.toFixed(2)} · c ${entry.confidence.toFixed(2)} · 任务 ${entry.tasks} · 任务链 ${entry.links} · 优先级 ${entry.priority.toFixed(2)}`"
          >
            <span class="rank mono">{{ entry.rank }}</span>
            <span class="term mono" :class="entry.kind">{{ entry.label }}</span>
            <span class="bar"><i :style="{ width: `${Math.round(entry.share * 100)}%` }" /></span>
            <span class="c mono">c{{ entry.confidence.toFixed(2) }}</span>
            <span class="count mono">{{ entry.sentences }}</span>
          </div>
        </div>
      </div>

      <div class="sentences">
        <div class="sorted-head">
          <span>句子排序</span>
          <span class="sorted-note">注意力缓冲 · {{ snapshot.sentenceSize }} 种</span>
        </div>
        <div class="list">
          <div v-if="!sentences.length" class="empty">还没有句子</div>
          <div
            v-for="entry in sentences"
            :key="entry.key"
            class="sentence-row"
            :class="{ top: entry.rank === 1 }"
          >
            <span class="s-rank mono">{{ entry.rank }}</span>
            <span class="s-text mono">{{ entry.text }}</span>
            <span class="s-truth mono">{{ entry.truth }}</span>
            <span class="count mono">{{ entry.count }}</span>
          </div>
        </div>
      </div>
      <div class="cycles">
        <div class="sorted-head">
          <span>推理日志</span>
          <span class="sorted-note">最新 · {{ cycles.length }}</span>
        </div>
        <div class="list">
          <div v-if="!cycles.length" class="empty">还没有工作周期记录</div>
          <div v-for="(cycle, index) in cycles" :key="`${index}-${cycle.task}`" class="cycle-row">
            <span class="cycle-kind mono">{{ cycle.kind }}</span>
            <span class="cycle-body">
              <b class="mono">{{ cycle.task }}</b>
              <i v-if="cycle.rule" class="mono">{{ cycle.rule }}</i>
              <span v-if="cycle.statement" class="mono">{{ cycle.statement }}</span>
              <span v-else-if="cycle.subquestions?.length" class="mono">
                → {{ cycle.subquestions.join(' / ') }}
              </span>
            </span>
          </div>
        </div>
      </div>
    </div>
  </section>
</template>

<style scoped>
.nars {
  flex: 0 0 auto;
  height: 254px;
}

.attention {
  position: relative;
  margin-left: auto;
  margin-right: 8px;
  font-size: 10px;
  color: var(--faint);
}

.attention summary {
  cursor: pointer;
  list-style: none;
  color: rgba(94, 240, 200, 0.65);
  letter-spacing: 0.04em;
}

.attention summary::-webkit-details-marker {
  display: none;
}

.attention summary:hover {
  color: var(--cyan);
}

.attention-panel {
  position: absolute;
  right: 0;
  top: calc(100% + 6px);
  z-index: 40;
  width: 250px;
  padding: 8px 10px;
  border-radius: 10px;
  border: 1px solid var(--line-strong);
  background: rgba(6, 12, 17, 0.98);
  box-shadow: 0 16px 38px rgba(0, 0, 0, 0.5);
}

.attention-row {
  display: grid;
  grid-template-columns: 34px minmax(0, 1fr) 34px;
  align-items: center;
  gap: 6px;
  margin-bottom: 4px;
  color: var(--muted);
  font-size: 10px;
}

.attention-row input[type='range'] {
  width: 100%;
  height: 3px;
  accent-color: var(--cyan);
}

.attention-row b {
  color: var(--ink);
  font-weight: 500;
  text-align: right;
}

.attention-note {
  margin-top: 5px;
  color: var(--faint);
  font-size: 9px;
}

.nars-actions {
  display: flex;
  gap: 6px;
}

.nars-actions .btn {
  display: inline-flex;
  align-items: center;
  gap: 4px;
}

.play-icon {
  width: 11px;
  height: 11px;
  flex: 0 0 auto;
  fill: currentColor;
}

.nars-body {
  display: grid;
  grid-template-columns: 180px minmax(0, 0.9fr) minmax(0, 1fr) minmax(0, 1.25fr);
  grid-template-rows: minmax(0, 1fr);
  gap: 12px;
  padding: 12px 14px;
  min-height: 0;
  flex: 1 1 auto;
}

.nars-meta {
  display: flex;
  flex-direction: column;
  gap: 5px;
  padding-top: 2px;
  font-size: 11.5px;
  color: var(--faint);
  min-width: 0;
}

.nars-meta b {
  color: var(--ink);
  font-weight: 500;
  font-size: 11.5px;
}

.goal-row {
  display: flex;
  align-items: center;
  gap: 5px;
  color: var(--faint);
}

.goal-chip {
  padding: 2px 7px;
  border-radius: 999px;
  border: 1px solid var(--line);
  background: rgba(255, 255, 255, 0.02);
  color: var(--muted);
  font-size: 11px;
  line-height: 1.5;
}

.goal-chip:hover {
  border-color: var(--line-strong);
  color: var(--ink);
}

.goal-chip.active {
  background: rgba(240, 180, 41, 0.16);
  border-color: rgba(240, 180, 41, 0.55);
  color: var(--amber);
}

.goal-note {
  font-size: 10.5px;
  color: rgba(240, 180, 41, 0.72);
  margin-bottom: 2px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.guidance {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 10.5px;
  color: var(--faint);
}

.g-bar {
  flex: 1 1 auto;
  height: 5px;
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.07);
  overflow: hidden;
}

.g-bar i {
  display: block;
  height: 100%;
  border-radius: 999px;
  background: linear-gradient(90deg, rgba(240, 180, 41, 0.45), #f0b429);
}

.guidance b {
  color: var(--amber);
  font-size: 10.5px;
}

.nars-meta .line {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 8px;
}

.nars-meta .vision {
  min-width: 0;
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
}

.sorted,
.sentences,
.cycles {
  display: flex;
  flex-direction: column;
  gap: 5px;
  min-width: 0;
  min-height: 0;
}

.list {
  display: flex;
  flex-direction: column;
  gap: 4px;
  min-height: 0;
  overflow-y: auto;
  padding-right: 4px;
}

.sorted-head {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  font-size: 10.5px;
  letter-spacing: 0.08em;
  color: var(--faint);
  text-transform: uppercase;
}

.sorted-note {
  letter-spacing: 0;
  text-transform: none;
  font-size: 10.5px;
  color: rgba(94, 240, 200, 0.55);
}

.row {
  display: grid;
  grid-template-columns: 16px minmax(0, 2.2fr) minmax(28px, 0.55fr) 34px 22px;
  align-items: center;
  gap: 7px;
  font-size: 12px;
  border-radius: 5px;
}

.c {
  font-size: 9.5px;
  color: var(--faint);
  text-align: right;
}

.c.high {
  color: var(--amber);
}

.sentence-row {
  display: grid;
  grid-template-columns: 16px minmax(0, 1fr) 80px 22px;
  align-items: center;
  gap: 8px;
  font-size: 11px;
}

.cycle-row {
  display: grid;
  grid-template-columns: 54px minmax(0, 1fr);
  align-items: start;
  gap: 6px;
  padding: 3px 0;
  border-bottom: 1px solid rgba(255, 255, 255, 0.045);
  font-size: 10px;
}

.cycle-kind {
  color: var(--faint);
  font-size: 9px;
  text-transform: uppercase;
}

.cycle-kind:first-letter {
  color: var(--cyan);
}

.cycle-body {
  display: flex;
  flex-direction: column;
  gap: 1px;
  min-width: 0;
  color: var(--muted);
}

.cycle-body b {
  overflow: hidden;
  color: var(--ink);
  font-size: 10px;
  font-weight: 500;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.cycle-body i {
  color: var(--amber);
  font-size: 9px;
  font-style: normal;
}

.cycle-body span {
  overflow: hidden;
  color: var(--cyan);
  font-size: 9.5px;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.rank,
.s-rank {
  color: var(--faint);
  font-size: 10.5px;
  text-align: right;
}

.term,
.s-text {
  color: var(--ink);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.s-truth {
  color: var(--faint);
  font-size: 10.5px;
  text-align: right;
}

.row.top .term,
.row.top .count,
.sentence-row.top .s-text,
.sentence-row.top .count {
  color: var(--cyan);
}

/* 概念种类：操作概念偏紫、心理操作偏琥珀、顺序对偏青 */
.row .term.operation {
  color: #b7a8ff;
}

.row .term.mental {
  color: var(--amber);
}

.row .term.sequence {
  color: #7fe3d0;
}

.bar {
  height: 6px;
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.06);
  overflow: hidden;
}

.bar i {
  display: block;
  height: 100%;
  border-radius: 999px;
  background: linear-gradient(90deg, rgba(94, 240, 200, 0.45), #5ef0c8);
}

.count {
  text-align: right;
  color: var(--muted);
  font-size: 11.5px;
}

.empty {
  font-size: 11.5px;
  color: var(--faint);
  padding: 8px 0;
}
</style>
