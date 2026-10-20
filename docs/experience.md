# 通用经验：Buffer + NAL

> 2026-10-20。这个目录描述**当前**实现：没有感知专用代码，没有形状检测器。
> 最高约定见 [`../agents.md`](../agents.md)。

## 1. 结构

```text
世界/图像
  → 普通属性观察（entity → property）
  → EventBuffer：容量有限，按优先级留下事件
  → Engine：比较 / 相似 / 交集 / 修订
  → Memory：概念、信念、优先级
  → 3D 视觉：节点是观察/概念，边是引擎真实派生的关系
```

### `src/experience/event.ts`

- `Event = { term, truth, time, priority }`
- `EventBuffer` 只做三件事：放入、按优先级淘汰、提供当前窗口。
- 它不知道 near/aligned/loop/圆。

### `src/experience/world.ts`

- 一个极简 3D 世界：实体、颜色、位置、运动、大小。
- 产生的是普通属性观察：
  ```text
  thing_0 → color_red
  thing_0 → x_n
  thing_0 → moving
  ```
- 没有形状、边界、近邻、圆、凸。

### `src/experience/grow.ts`

- `Experience` 持有同一份 `Memory` 和 `Engine`。
- 每个场景：`Shift` 选焦点 → 观察进 Buffer → Buffer 中的事件喂给 Engine → 跑工作周期 → 问几个 NAL 问题。
- Engine 只用 `→`、`↔`、`∩`、`revision` 等通用规则。
- 概念不是手写的；是观察/相似/复合反复出现后留在记忆里的词项。

### `src/experience/shift.ts`

- `Shift` 是一次换焦点/跳跃；只比较普通属性。
- `cost = 改变属性比例 + 距离代价`，所以系统倾向“少改变、相似、近”的目标（习惯/节能）。
- 它不是记忆概念，是操作选择策略。

### `src/experience/spread.ts`

- 蔓延求同：从当前观察出发，用 `?p`、`?e`、`↔ ?e` 这类普通 NAL 问句，
  向记忆问有限几个问题。
- 只问、不枚举全组合；答案已有就用，没有就留空。
- 问句本身进入记忆任务，不做专用关系推理。

### `src/experience/store.ts`

- `memory/experience.bin`：NAL 记忆的二进制快照。
- 启动先 `loadMemory`，没有就从空记忆开始。
- `memoryScore` 只看经验量：概念/相似/复合/信念/置信，不看分类正确率。
- `saveMemory` 只在分数更高时覆盖旧快照。

### `src/experience/economy.ts`

- 概念付租金：`RENT × 句法复杂度`。
- 收入：`证据 × (复用 + 预测 + 压缩)`。
- 低收益概念衰减；低于阈值或超出 `MAX_CONCEPTS` 时删除。
- 每隔几轮给最低优先级概念一次探索提升，避免完全饿死。
- 没有 `NEAR_WEIGHT`/`CIRCLE_BONUS`；租金只看复杂度，收入只看使用/答案/∩ 复用。

## 2. 阶段性目标

| 阶段 | 目标 | 机制 |
|---|---|---|
| 1 | 观察 → 属性概念 | 普通观察 + Buffer + revision |
| 2 | Shift 找相似焦点 | 少改变/近的 Shift |
| 3 | 蔓延求同 | 有限 NAL 问句 |
| 4 | 概念经济 | 租金/收入/衰减/探索 |
| 5 | 扩展世界 | 增加同类实体/新颜色 |
| 6 | 保存较好记忆 | `memoryScore` + 二进制快照 |

`tools/grow.ts` 按阶段跑，结束后只保留分数更高的 `memory/experience.bin`。
下次启动先加载它，不从头开始。

## 3. 经验怎么“长”

1. 同一个实体的多个属性反复出现 → NAL 比较出相似/共同属性；
2. 不同实体共享属性 → 相似；
3. 共同主项 + 不同属性 → 交集复合（`Engine.compose`）；
4. 重复观察 → `revision` 提高置信度；
5. 低收益/长期不用的概念 → 衰减/遗忘（AIKR）。

没有“先找圆，再判断圆”的步骤；  
如果环境中反复出现圆形规律，`round` 会作为**经验概念名**出现；如果没有，它不会出现。

## 4. 资源参数

这些是资源价格，不是语义权重：

| 参数 | 当前值 | 作用 |
|---|---:|---|
| Buffer 容量 | 24 | 同屏事件数 |
| 复合预算 | 8 | 每轮最多引入多少 `∩` |
| 工作周期 | 450/场景 | 每轮推理步数 |
| 世界轮数 | 12（3D 演示） | 经验长度 |
| Shift 候选 | 当前实体集 | 选“少改变 + 近”的下一个焦点 |
| 问句上限 | 3/场景 | 蔓延求同的预算 |
| 3D 派生上限 | 160 | 可视化保留多少真实派生 |
| 记忆快照 | `memory/experience.bin` | 启动时加载 |
| 复杂度租金 | `0.08 × 句法复杂度` | 每轮收租 |
| 衰减 | `0.002`/轮 | 低收益概念变弱 |
| 概念上限 | 600 | 超出后淘汰最低优先级 |
| 探索 | 每 7 轮提升最低 3 个 | 避免完全饿死 |

`BUFFER_CAPACITY`、`COMPOSE_LIMIT` 是资源预算；  
`NEAR_WEIGHT`、`CIRCLE_BONUS` 这类语义权重**不设**。

## 5. 3D 演示

```bash
npm run typecheck
npm run grow           # 阶段成长 + 写入 memory/experience.bin
npm run brain3d        # 加载快照，生成 public/brain3d/data.js
npm run brain3d:serve  # 生成并启动 3D 预览
npm run brain3d:pack   # 生成单文件 HTML
```

`tools/brain3d.ts` 生成 `public/brain3d/data.js`：

- 5 个实体在 3D 世界里移动；
- 每轮由 `Shift` 选焦点；只显示焦点对真正进入经验的事件；
- 蔓延问句作为 `?` 节点显示；
- NAL 的真实 trace 被采集，作为 3D 图里的派生节点；
- 图按步骤增长，展示“观察 → 相似 → 复合”的经验形成过程。

前端仍用 `public/brain3d` 的 Three.js 渲染；统计标签是
`OBJECTS / LINKS / STEPS / CONCEPTS / SIM / ∩`。

## 6. 当前状态

- `src/perception` 已删除。
- `tools` 只剩通用经验/3D 基础设施：
  `grow.ts`、`brain3d.ts`、`brain3d-standalone.ts`、`serve-brain3d.ts`。
- 旧 `baby/curriculum/digest/debug/error/paper/standalone` 已删除。
- 当前快照 `memory/experience.bin` 约 96 概念 / 21 相似 / 8 复合；
  `brain3d` 加载它后会继续看到约 99 概念。
- 事故读数、旧迁移账本不再作为目标。

## 7. 下一步

1. 调经济参数（租金/衰减/探索/上限），观察概念是否稳定；
2. 增加更多世界变化/新属性，避免记忆过早饱和；
3. 加一个通用预测/问句任务，检验经验是否能答新问题；
4. 不在核心路径恢复任何形状/关系专用函数。
