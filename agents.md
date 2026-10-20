# agents.md：真通用规则（v2）

> 这份文件是 pixel-to-concept-reader v2 的最高工作约定。
> 以后判断一段代码/文档是否合格，只看这里，不看“像不像某个形状”。

## 1. 一句话

**不写“找圆/找凸/找边界/找近邻”的代码；只写有限 Buffer + NAL。
关系、分组、圆、凸都是经验中反复出现的模式，不是感知层的函数。**

## 2. 禁止

1. **禁止语义专用谓词/检测器**：
   不写 `near()`、`aligned()`、`continues()`、`between()`、`inside()`、
   `circle()`、`convex()`、`closure()`、`findHough()`、`convexHull()` 这类名字或分支。
   它们可以出现在**记忆的词项/概念名**里，但不能出现在感知代码里。
2. **禁止形状/类别先验**：不按 `digit_*`、`loop`、`ring`、`line`、`angle` 决定候选、
   阈值、词项存在或权重；不做样本先验、类条件剪枝。
3. **禁止手写关系组合**：不手拼 `∩(a,b)`、不写“两个条件都满足就是圆/凸”。
   复合由 `Engine.compose` 在 Buffer 上按预算引入。
4. **禁止用分数决定保留/回退**：MNIST/任何读数只作事故记录；
   不写“再提 0.5 个点”的实验。
5. **禁止开关板**：不新增 `BABY_*`/`PD6_*` 语义分支；资源参数只有一条默认路径。
6. **禁止保留专用代码/注释/文档**：
   删掉，不是注释掉；不留“历史兼容”分支在核心路径。

## 3. 允许的原始结构

### 3.1 通道

通道只允许**通用测量**：

- 像素/亮度/对比度；
- 位置、时间、尺度；
- 颜色、运动、大小等**属性值**；
- 有限感受野/采样窗口。

通道不解释“这是什么形状”。
它输出的是 `entity → property` 这样的普通观察，不是 `entity is circle`。

### 3.2 Buffer

Buffer 是唯一的时空结构：

- 固定容量；
- 每个事件有 term、truth、time、priority；
- 满了淘汰最低优先级；
- 它只提供三种事实：
  1. **共现**：哪些事件同时在同一窗口；
  2. **顺序**：谁在谁之前/之后；
  3. **成员**：`x → G` 之类的普通继承。

Buffer 不知道“近/连续/之间/里面”；这些词如果出现，只能是学习到的概念名。

### 3.3 NAL

只允许通用推理：

- `→` 继承；
- `↔` 相似/比较；
- `∩` 交集复合（由 `Engine.compose` 按预算引入）；
- `revision` 修订；
- 问句/选择/期望；
- 时间/操作关系（如果实现到 NAL-7/8）。

不额外写“关系推理器”。

### 3.4 原语与派生物

只允许少量原语：

- 观察；
- 有限 Buffer；
- NAL 的 `→ / ↔ / ∩ / revision / 问句`；
- Shift（换焦点、记录位置差）；
- 蔓延求同（把局部活动形成粗点）。

**凡是能由已有经验/操作复合出来的东西，必须派生，不能新增原语或专用词项。**

例子：

```text
二阶差不是原语
二阶差 = 两个相邻 Shift 的差
```

因此：

- 不写转角专用函数；
- 不写转角专用词项；
- 用 `shift_vec`、`shift_accel` 这类派生观察表达；
- 如果将来确实需要新操作/新词项，先证明它不能由现有操作/词项复合出来，
  再按资源预算引入，不能凭形状语义直接加。

## 4. 概念怎么长出来

1. 世界/图像 → 普通属性观察；
2. 观察进有限 Buffer；
3. Buffer 中的共现/顺序/成员事实被 NAL 比较、复合、修订；
4. 反复出现、被复用、能预测/压缩的模式获得更高优先级；
5. 低收益模式被遗忘；
6. 概念名（`red`、`moving`、`round`、`convex`）只是记忆中的词项，
   不是感知代码里的分支。

**圆/凸不是原语。**
它们是“闭合 + 平滑 + 顺序稳定”或“中间观察仍属于同一 group”这类经验反复出现后的压缩名。

## 5. AIKR 参数（只设资源，不设语义）

| 参数 | 作用 |
|---|---|
| `BUFFER_CAPACITY` | 同时进入经验的事件数 |
| `COMPOSE_LIMIT` | 每周期最多引入多少复合 |
| `EVIDENCE_THRESHOLD` | 至少多少证据才值得保留 |
| `COMPLEXITY_RENT` | 越复杂的词项每周期租金越高 |
| `DURABILITY` / `FORGET` | 低收益概念衰减/遗忘 |
| `MAX_VOCAB` | 词表/概念预算上限 |
| `EXPLORATION` | 给低优先级项的小概率机会，避免饿死 |

**不设** `NEAR_WEIGHT`、`CIRCLE_BONUS`、`CONVEX_BONUS`。
如果 `near`/`convex` 有用，它们自己会在预算竞争里赢；没用就不该被强化。

通用生存式：

```text
cost(T)   = 复杂度(T)
income(T) = 证据(T) × (复用 + 预测 + 压缩)
keep(T)   = income(T) > λ × cost(T)
```

`λ` 是预算价格，不是语义权重。

## 6. 当前代码结构

```text
src/nars/           通用 NAL：词项、真值、句子、袋、规则、引擎、记忆、交集、实例
src/experience/     通用经验：EventBuffer、World、Experience、Shift、Spread、Economy、二进制快照
src/visual/         蔓延粗点 → Shift 相对矢量/二阶差 → 曲率
tools/grow.ts       阶段成长 + 选较好记忆写入 memory/experience.bin
tools/visual.ts     视觉经验训练 + 直/弯判断
tools/report.ts     所有图像激活报告，导出可切换 test_report.html
tools/report-standalone.ts 校验并复制为 report/index.html
tools/brain3d.ts    加载快照 → 经验 → 3D 数据
tools/brain3d-standalone.ts / serve-brain3d.ts   3D 演示基础设施
public/brain3d/     3D 前端（Three.js）
```

已删除：

- `src/perception/` 全部形状/关系/布局代码；
- `src/nars/curriculum.ts`（旧词表课程工具）；
- `tools/baby.ts`、`curriculum.ts`、`figures.ts`、`digest.ts`、`debug-sample.ts`、
  `error-analysis.ts`、`paper.ts`、`standalone.ts`；
- 依赖这些代码的专用文档。

## 7. 3D 经验演示

```bash
npm run typecheck
npm run grow          # 阶段成长 + memory/experience.bin
npm run brain3d       # 加载快照，生成 public/brain3d/data.js
npm run brain3d:serve # 打开 3D 页面
npm run brain3d:pack  # 生成单文件 HTML
```

演示内容：

- 5 个实体在 3D 世界里移动；
- 每帧产生普通属性观察（颜色、位置、运动、大小）；
- `Shift` 选“少改变 + 近”的焦点；`?` 问句做有限的蔓延求同；
- 有限 Buffer 选择同时进入经验的事件；
- NAL 用共同主项比较/复合/修订，长出相似/复合概念；
- 启动先加载 `memory/experience.bin`；3D 图按时间显示观察/Shift/问句/派生。

没有圆检测、凸包、近邻函数、Hough、距离变换。

## 8. 验收

一次改动算完成，必须同时满足：

1. 没有新增语义专用谓词/检测器/形状分支；
2. 新能力由 Buffer + NAL 的通用机制产生；
3. 参数只进资源账本（容量/预算/租金/衰减），不进语义；
4. 命名通用，不含 digit/loop/ring/convex/hull/near；
5. `npm run typecheck` 通过；
6. `npm run grow` 能跑，3D 数据能生成；
7. `npm run visual` 能加载/训练简单图形，用 Shift 的相对矢量/二阶差给出直/弯判断；
8. 没有把可由现有操作/经验复合出来的东西写成新原语；
   二阶差只能由相邻 Shift 的差派生，不能成为独立词项；
9. `npm run report` 能加载经验并生成 `test_report.html`；`npm run report:standalone` 能生成独立 `report/index.html`。

## 9. 工作纪律

1. 先读本文件，再改代码；
2. 先问“删掉了哪个专用项、由哪个 Buffer/NAL 机制替代”，再写最小实现；
3. 不把“候选生成器”当免责声明：候选的划分若写死在通道里，仍是专用；
4. 不把“概念名”当“推理机制”：`round` 可以存在，但不能有 `isRound()`；
5. 每步更新本文件或 `docs/experience.md` 的资源账本。
