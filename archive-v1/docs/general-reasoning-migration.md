# 通用推理迁移：专用特性清单与删除路线

> 2026-10-19 用户新指示。本文取代此前以正确率为晋升门槛的做法。
> 逐项清单是本文 §2；`agents.md` 只保留规则、索引与当前阶段。
> 行号取自提交 `227078f`，删除后会漂移；**函数名/词项名才是稳定锚点**。

## 0. 三条新纪律

1. **严禁再追求正确率。** 不再以 MNIST 分数决定保留/回退；不再做“提高 0.5 个点”的实验。
   分数只在 `docs/progress-assessment.md` 里作事故记录，不作目标、不作晋升条件、不写进代码注释。
2. **先盘点，再动手。** `src/perception/` 与 `tools/baby.ts` 里每一条“只有 MNIST 才需要”的
   判断/阈值/词项/开关，都必须在本文件有一行；没有登记的专用逻辑不许新增。
3. **逐步删除，让通用推理承载。** 每次只迁一类；迁移完成的判据是**专用代码被删掉**，
   而不是分数变好。删不掉的，说明通用机制还没长出来，就继续做机制，而不是把专用代码留下。

### 0.3 验收判据（替代正确率）

一次改动算“完成”，要同时满足：

1. **删除判据**：本文件里对应的专用项被删掉（或缩成一条参数），`git diff` 里能看到净删除。
2. **派生判据**：被删掉的能力由 NAL 的**词项、比较、交集、修订、预算、注意**之一产生；
   在 `tools/baby.ts trace` / `tools/digest.ts` / 单元探针里能看到它**作为推理结果**出现，
   而不是在感知层被手写。
3. **参数判据**：只剩通道/注意参数，且写进 §6 参数账本；代码里不再出现“为某一类调的数字”。
4. **命名判据**：`src/perception` 不出现 `digit`、具体类别名、`one_*`/`eight_*` 这类样本先验；
   结构判断的名字不进入 `src/nars`。
5. **回归判据（只防事故）**：`npm run typecheck` 通过；`train`/`test`/`trace` 不崩；
   结构词项 digest 变化有解释。**不看正确率高低。**

---

## 1. 分类口径

| 代号 | 含义 | 处理 |
|---|---|---|
| **T** | 通道/换能（像素→候选几何），语义上中立 | 可留，但必须只剩参数；能合并就合并 |
| **P** | 参数/量化（阈值、桶、扇区、reach） | 可留，但集中到参数账本，不能藏语义 |
| **S** | 专用结构语义（手写判据/权重/词表/参照系） | 迁到通用机制，然后删 |
| **D** | 死代码、诊断、实验开关、过时变体 | 直接删（连带过时工具/文档） |
| **X** | 样本先验/作弊（为某类加的分、专用通道） | 立即删，不做替代 |
| **G** | 已经是通用的好机制 | 保留并复用，作为迁移的落点 |
| **R** | 评估/报告装置 | 保留，但降级为“事故仪表”，不作目标 |

判断口诀：**“如果换一个数据集（不是数字），这段代码还成立吗？”**
不成立的就是 S/X；成立的才可能是 T/P/G。

---

## 2. 全量清单（100 项）

### 2.1 `src/perception/discs.ts`（候选生成）

| ID | 位置 | 专用特性 | 类 | 为什么专用 | 通用替代 | 阶段 |
|---|---|---|---|---|---|---|
| A1 | `growDiscs` 种子扫描 | 行扫描取首个活跃格作种子 | T | 扫描顺序=隐式注意 | 种子顺序是通道参数；候选进 `Bag` 由优先级决定 | 3 |
| A2 | `covered` 集合 | 一个活跃格只能归一个圆（赢者通吃） | S | 预先决定“一格一物”，等于替推理做了划分 | 候选允许重叠；由 `ObservationBuffer` 容量/优先级选，重复由修订合并 | 3 |
| A3 | `ratio ≤ TOLERANCE` | 只接受“实心”圆 | S | 空心圈被排除，才需要 `boundaryDiscs`/`fineRings` 补丁 | 区域带 `fill` 属性；实心/空心都是候选，`fill` 由 NAL 用 | 3 |
| A4 | `MIN_RADIUS/STEP/TOLERANCE/MAX_RADIUS` | 半径生长参数 | P | 本身是通道参数 | 进参数账本 | 3 |
| A5 | `boundaryDiscs` | 边界小盘专用通道（`fineRings`） | X | 为了补“空心圈”单开一条通道 | 由 A3 的多填充候选统一产生；删除 | 0 |
| A6 | `Disc` 结构 | 只有圆心/半径/格数/填充 | S | 没有极性（图/底）、没有包含关系 | 区域增加 `polarity`（figure/ground）与 `encloses` 关系 | 3 |

### 2.2 `src/perception/sense.ts`（原子观察）

| ID | 位置 | 专用特性 | 类 | 为什么专用 | 通用替代 | 阶段 |
|---|---|---|---|---|---|---|
| B1 | `chainsOf` 打分 | `距离 + 方向角 + 步长差` 手调权重 | S | 通用推理不该有“链的代价函数” | 候选进容量 1 的 `Bag`，优先级来自 `near`/`dir` 观察的真值 | 1 |
| B2 | `REACH_FACTOR=1.06` | 连边阈值 | P | 相对尺度参数 | 参数账本；与闭合阈值共用一个 reach | 1 |
| B3 | `VISIT_CAP=2` | 一个 loop 最多被扫两次 | S | 硬上限；`#8040` 的闭合正需要“再访” | **耐久度衰减**：用过的元素回袋，优先级×decay，仍可再选（复访） | 1 |
| B4 | `inChain` | 同一条链不能回到走过的 loop | S | 直接禁止自交/闭合，才需要借用闭合补丁 | 允许回到起点=闭合；回到中间点=自交假设，由预算取舍 | 1 |
| B5 | `startOrder=degree` | 起点按邻居数排序 | D | 负结果开关 | 删；起点顺序是通道参数 | 0 |
| B6 | `backgroundOf` | 物体框 | T | 相对背景，语义中立 | 保留，作为参照系之一 | 2 |
| B7 | `meanCells/meanRadius` | 相对感受野尺度 | P | 参数 | 参数账本 | 2 |
| B8 | `StepObs` | 只有几何，没有“转向”语义 | G | 符合 agents §2.5 | 保留 | — |

### 2.3 `src/perception/structure.ts`（结构推导，最大来源）

| ID | 位置 | 专用特性 | 类 | 为什么专用 | 通用替代 | 阶段 |
|---|---|---|---|---|---|---|
| C1 | `terms: Map<string, number>` | 扁平字符串词项袋 + 计数 | T | 句法编码，本身可留 | 改成“观察=句子”，计数由修订/习惯承载 | 6 |
| C2 | `StructureMode.layout` | 6 种参照系模式（box/background/receptive/field/both/multi） | D | 手写分支爆炸 | G3 一次输出三种参照系，由观察集/预算竞争 | 2 |
| C3 | `lzone_*/lzsize_*/lzfill_*` | 物体框 4×4 网格 | S | 4×4 是手选量化 | 参照系关系（方向/距离/大小比），格数只是量化参数 | 2 |
| C4 | `lrel/ldist/lratio/loverlap` | 两两 loop 关系，`distance > 12` 截断 | S | 截断是手选；且与链/环各有一套邻接 | G2 统一邻近关系图，reach 用相对半径 | 2 |
| C5 | `loops_n/chains_n/shifts_n` | 计数直方图 | P | 量化 | G9 基数观察；桶参数进账本 | 6 |
| C6 | `smoothed` 高斯 σ=r | 按 loop 半径平滑轨迹 | S | 手写尺度平滑 | G4 尺度=感受野；平滑是“同一个物体在不同尺度看” | 4 |
| C7 | `shiftDiffAngle` + `rawCross` | 两套转角（平滑角 / 原始累计） | S | 双实现、双语义 | G5 只保留比较证据；角只作通道读数 | 4 |
| C8 | `sectorOf`/`SECTOR_COUNT=8` | 8 扇区量化 + 半格偏移 | P | 量化 | 账本；不再用“扇区差”当第二套累计 | 4 |
| C9 | `shiftDiffBucket(0.35)`/`stepBucket(0.75,1.33)` | 差的方向/步长桶 | P | 量化 | 账本（统一 cuts 表） | 4 |
| C10 | `large = area/meanCells ≥ 1` | 大/小 shift diff | P | 相对面积量化 | 账本 | 4 |
| C11 | 恒常 channel：`smooth*0.6+size*0.4 > 0.55` | 手调加权判据 | S | “恒常”被写成一个分数 | G5 `com` 比较方向/步长 + 修订；无权重 | 4 |
| C12 | `constancy="compare"` | 比较 + 重复证据 | G | 已经是通用版 | **提升为唯一路径**（阶段 4） | 4 |
| C13 | `accum` 四分之一圈/span 桶 | 累计转角量化 | P | 量化 | 账本；累积由 shift diff 证据求和 | 4 |
| C14 | `center_blank` | 链质心不被 loop 覆盖 | T | 几何谓词 | G4 改成“被图围住的底”区域关系 | 3 |
| C15 | `eff_/step_rel_` | 效率/相对步长 | P | 量化 | 账本 | 4 |
| C16 | `closure: gap ≤ (r1+r2)*0.85` | 首尾闭合阈值 | P | 相对阈值 | 账本；闭合由“回到起点”产生（G1） | 1 |
| C17 | `bigrams` 六变体 + `trigrams` | all/repeat/smooth/chain3/link/link2/turns | D | 变体爆炸；`turns` 还违反 agents 禁 turn | G7/G9 只保留 `n` 一个参数，序列来自同一次 walk | 5 |
| C18 | `chainCompounds` | 手拼“方向对 × 闭合/恒常” | S | 手工决定复合什么 | G7 `Engine.compose` 交集引入 + 注意预算 | 5 |
| C19 | `chainPairs` | 手拼链首尾方向对 | D | 负结果 | 删 | 5 |
| C20 | `chainRings` | 手拼整圈 × 闭合 | D | 负结果 | 删 | 5 |
| C21 | `linkCompounds` | 手拼 link 二元组 × 闭合 | D | 负结果 | 删 | 5 |
| C22 | `compare` 的 `cmp_dir/cmp_step/cmp_pairs` | 比较比率桶 | D | 诊断词项，未转正 | 比较证据由 G5 直接产生，不再单独成词 | 4 |
| C23 | `borrowLoop` | 开放链两端靠近同一第三 loop → 借用闭合 | X | 为 `#8040` 写的专用规则 | **G1 复访**：链直接走进第三 loop 并回到起点；`closure` 自然产生 | 1 |
| C24 | `reverseClosure` | 两条反向链拼成圈 | X | 同上，专用补丁 | G1 复访/自交；不再单独识别“反向对” | 1 |
| C25 | `link` 二元组（跨链） | 端点相接的链块拼接，`linkFactor` | S | 手写链拼接 | G1 一次 walk 走完；跨链是同一遍历 | 1 |
| C26 | `fineRings` | 边界盘 + 枚举环 + 面积/支持度 | X | 为空心圈单开的检测 | G4 多填充候选 + 图/底关系；删 `boundaryLoops` | 0 |
| C27 | `strokeTerms` | 竖/横比 + `vertical_no_loop`/`stroke_no_loop` | X | **数字 1 的形状先验**写进感知层 | 删，不做替代 | 0 |
| C28 | `partBlob` | 大块/空心环零件 | D | 负结果 | 删（由 G4 `fill` 属性替代） | 6 |
| C29 | `graph` | 并查集度/连通分量/环秩 | D | 图论指标当词项 | G9 基数；环=闭合的 walk | 6 |
| C30 | `graphPath` | 枚举简单环/面积/stem | D | 专用图算法 | 删 | 0 |
| C31 | `parts/partRelation` | 零件词表 + 复合 | D | 并行分类法 | G8 段/残段关系 | 6 |
| C32 | `dedupChains` | 端点 1.2 内去重 | D | 手写去重 | G6 同一观察由修订合并 | 1 |
| C33 | `alternatives` | 四个硬编码观察子集 | D | 死诊断 | 删 | 0 |
| C34 | `termLayer` | 前缀 → 层号 | D | 报告用专用词表分类 | 用 `Term.depth`（句法深度），已是报告口径 | 0 |
| C35 | `StructureMode` 25 开关 | 实验开关板 | D | 每个开关=一条专用分支 | 参数账本 + 单一实现 | 7 |
| C36 | `STRUCTURE_LAYERS` | 未使用的常量 | D | 死代码 | 删 | 0 |
| C37 | `directionMembership/Similarity` | 用 `com` 比较方向隶属度 | G | 通用比较的落点 | 保留，扩成 G5 | — |

### 2.4 `src/perception/rings.ts`、`parts.ts`、`blocks.ts`、`partition-report.ts`、`shift-compare.ts`、`ring-terms.ts`、`figures.ts`

| ID | 文件 | 专用特性 | 类 | 为什么专用 | 通用替代 | 阶段 |
|---|---|---|---|---|---|---|
| D1 | rings.ts `findCycles` | DFS 枚举简单环 | D | 环从图算法来，不是推理 | G1 walk 闭合 | 6 |
| D2 | rings.ts `weakEdgeCount` | 弱边阈值 1.06 | P | 参数 | 账本 | 6 |
| D3 | rings.ts `blankCenter` | 中心空白几何 | T | 几何谓词 | G4 图/底 | 3 |
| D4 | rings.ts `ringEvidence` | 只留“最优环” | D | 赢者通吃，报告用 | 删 | 6 |
| E1 | parts.ts `chainStats` | structure 的重复实现 | D | 重复 | 删 | 6 |
| E2 | parts.ts kind 判据 | `1.2π`/`π/3`/`1.5 step` | D | 手写零件分类 | G8 段=链；闭合/累计已是词项 | 6 |
| E3 | parts.ts `part_loop_big/small` | 按步数分大小 | D | 手写 | G9 基数/相对大小 | 6 |
| E4 | parts.ts `part_tail_*`/`part_line_*` | 方向命名 | D | 并行词表 | G8 残段方向关系 | 6 |
| E5 | parts.ts `mainChain` | 取 gap 最大者为主链 | D | 手写选择 | 注意预算选 | 6 |
| E6 | parts.ts `tail_of_loop` | 主链中点相对 loop 质心方向 | S | 为 6/9 写的方位关系 | G2 段-区域方向关系（通用关系） | 6 |
| E7 | parts.ts `part_blob/part_ring` | `maxCells≥14` | D | 手写阈值 | G4 `fill` 属性 | 6 |
| E8 | parts.ts 零件 ∩ 复合 | 手工复合 | D | 与 G7 重复 | `Engine.compose` | 5 |
| F1 | blocks.ts 划分 | top2，score=闭合块+0.1×块数 | D | 手写评分 | 注意预算/划分竞争 | 6 |
| F2 | blocks.ts `blk_*` | 块内一套词表 + 桶 | D | 并行词表 | 观察集分区（已有 `ObservationBuffer.byPartition`） | 6 |
| F3 | blocks.ts `sectorOf/closedOf` | 重复实现 | D | 重复 | 删 | 6 |
| G1 | partition-report.ts | 链级划分 top3 | D | 诊断 | 删 | 6 |
| G2 | partition-report.ts `maxClosed` | 闭合块计数 | D | 诊断 | 删 | 6 |
| H1 | figures.ts | 7 张手绘经典图 | T | 固定世界数据 | 移到 `tools/fixtures.ts`，不作为感知模块 | 7 |
| I1 | shift-compare.ts | 8 方位 + 均值步长二分 | D | 与 C12 重复 | 删（G5 唯一） | 4 |
| J1 | ring-terms.ts | `ring_*` 诊断词项 | D | 未接线 | 删 | 0 |

### 2.5 `tools/baby.ts`（读出/实验开关）

| ID | 位置 | 专用特性 | 类 | 为什么专用 | 通用替代 | 阶段 |
|---|---|---|---|---|---|---|
| K1 | L38–76 `STRUCTURE_MODE` | 25 个环境变量开关 | D | 每次实验=一条分支 | 参数账本；单一默认实现 | 7 |
| K2 | L80–82 `BABY_NO_LAYOUT` | 布局消融 | D | 诊断 | 删 | 2 |
| K3 | L102–109 `loadBudget` | 类间出现率方差当预算 | S | 用标签算特征显著性 | 预算=经验频次/耐久度（无标签） | 7 |
| K4 | L111–129 `curriculumMatch` | 匹配经典图 | D | 诊断 | 删（curriculum 工具独立） | 0 |
| K5 | L131–139 `digitOf` | 从复合词项字符串解析类别 | T | 读出辅助 | 保留（可改成变量绑定） | 7 |
| K6 | L141–149 `rankedOf` | NAL 问句 + 期望排序 | G | 通用读出 | 保留 | — |
| K7 | L151–167 `mergeRanked` | choice/revision 合并 | G | 通用合并 | 保留并简化（去策略开关） | 7 |
| K8 | L192–213 观察真值 | 有/无=0.99/0.01、c=0.9、priority=0.6 | S | 魔法数 | G6 重复=修订；参数账本 | 7 |
| K9 | L194 重复置信度 | `0.6+0.4(1−0.5^n)` | S | 手写曲线 | G6 修订/耐久度 | 7 |
| K10 | L185–207 bigram 覆盖率/链接置信度/缺失证据 | 三个手写置信度 | S | 为 bigram 调参 | G6/G7；删 | 5 |
| K11 | L196–198 预算置信度 | `BUDGET_CONF/BOOST` | S | 调参 | 删 | 7 |
| K12 | L217 `engine.run(60000)` | 固定周期数 | P | 注意预算 | 账本 `ATTENTION_CYCLES` | 7 |
| K13 | L220–234 划分块观察集 | 每块独立 frame/问句 | D | 负结果 | 删；保留 `byPartition` 机制 | 6 |
| K14 | L236–248 比较观察集 | `cmp_*` 独立问句 | D | 负结果 | 删 | 5 |
| K15 | L251–268 **1 先验** | 竖直占比 → `digit_1` +0.05 | X | 样本作弊 | 立即删，不做替代 | 0 |
| K16 | L269–273 **0→8 先验** | 借用闭合 → `digit_8` +0.02 | X | 样本作弊 | 立即删；结构由 G1 产生 | 0 |
| K17 | L294–350 `classifyDual` | 含/不含 bigram 双观察集 | D | 负结果 | 删 | 0 |
| K18 | L352–383 训练词表 | 按 digit 收集 presence | S | 词表按标签组织 | G10 未标签经验；标签只作答案 | 8 |
| K19 | L356–360 `BABY_AUGMENT` | ±1 平移增强 | S | 手写数据增强 | G10 动作经验（自移位） | 8 |
| K20 | L384–400/402–414 **类条件剪枝** | `COMPOUND_MIN/BIGRAM_MIN/CURRICULUM_CULL` | X | 用标签选特征=隐藏分类器 | 立即改为无监督预算；删标签剪枝 | 0 |
| K21 | L415–422 记忆写入 | `digit_d→[term]` f=类频率、c=0.99 | S | 置信度硬编码 | c 由样本数/修订得出（`n/(n+k)`） | 8 |
| K22 | L437–603 `test()` | 200 张测试/报告 | R | 评估装置 | 保留，降级为事故仪表 | — |
| K23 | L605–729 shift/trace/tower | 诊断 | D | 部分过时 | 保留 trace；删 shift 探针里的准确率叙事 | 8 |
| K24 | L274–292 分数表 | 期望排序 | G | 通用 | 保留 | — |

### 2.6 跨文件

| ID | 位置 | 专用特性 | 类 | 为什么专用 | 通用替代 | 阶段 |
|---|---|---|---|---|---|---|
| L1 | perception 各处 | ~40 个散落魔数（0.35/0.55/0.85/0.6/0.4/12/14/1.2…） | P | 不可审计 | §6 参数账本，按“通道/注意/证据/量化”分组 | 全程 |
| L2 | baby.ts + docs | ~30 个 `BABY_*` 环境变量 | D | 开关板 | 账本 + 单一默认 | 7 |
| L3 | docs/README | 以 83.5% 为主叙事的段落 | D | 与目标冲突 | 改为“结构是否可派生”的叙事 | 8 |
| L4 | `BABY_BIGRAM=turns` | 转向二元组 | D | 违反 agents 禁 turn | 删 | 0 |
| L5 | `blk_steps_*`、`step_*` 命名 | turn 派生词残留 | D | 违反命名约定 | 改 `count`/`rel` 命名，或随 F2 删除 | 6 |

**统计**：100 项（T 7、P 13、S 21、D 44、X 8、G 6、R 1）。D/X 合计 **52 项可以直接删**；
S 的 17 项由 G1–G10 吸收；T/P 收敛为参数账本。目标是 `src/perception` 从 ~60 KB 降到 **≤15 KB**，
`tools/baby.ts` 从 ~35 KB 降到 **≤12 KB**。

---

## 3. 通用机制（参考 OpenNARS / 格式塔 / 发展心理学）

> 原则：**能由“选择、比较、复合、修订、预算、注意”表达的，不写专用规则。**
> 每条机制都必须是“换数据集也成立”的。

### G1 复访（revisit / 习惯化—去习惯化）

- **OpenNARS**：袋的耐久度、懒惰遗忘（`Bag.putBack`）、注意是有限资源；被处理过的任务不是消失，
  而是优先级下降。
- **格式塔**：好连续（good continuation）+ 闭合（closure）；回到起点就是闭合，不需要“借”一个 loop。
- **发展心理学**：习惯化—去习惯化（habituation/dishabituation）；婴儿对“刚看过但情境变了”的
  对象会再次注视。复访不是 bug，是注意的基本行为。
- **现状**：`VISIT_CAP=2` + `inChain` 禁止回访 + `borrowLoop`/`reverseClosure` 两个补丁。
- **做法**：walk 的候选进 `Bag`；用过的元素 `putBack`，优先级 × `DECAY`；`REVISIT` 只决定
  最多回访几次（默认 2），不是硬性“每条链只能扫两次”。走出终点后若候选里还有“来过的 loop”，
  它会被再次选中 → 链回到起点 → `closure` 自然成立。
- **参数**：`REACH=1.06`、`REVISIT=2`、`DECAY=0.5`、`MIN_PRIORITY=0.02`。
- **删掉**：B3、B4、C16 的专用判定、C23、C24、C25、C32。
- **验收**：#8040 的链首尾同点（或 `closure` 出现），且 `closure_borrowed_loop` 已不存在。

### G2 邻近关系图（proximity graph）

- **格式塔**：邻近律（proximity）是所有分组的第一定律；方向/距离/大小比都是同一关系的不同侧面。
- **OpenNARS**：关系是词项（`a → [near:b]` 之类），不是数组；关系的真值可比较、可复合。
- **现状**：链、布局、link、graph、findCycles 各建一套邻接，阈值还不同（1.06/1.2/12）。
- **做法**：一个 `relationsOf(loops)` 输出 `near/dir/dist_rel/size_rel`，所有消费方（walk、布局、
  基数）都读它；`REACH` 是唯一阈值。
- **删掉**：C4 的 `distance>12`、C25、C29、D1、E6（改为通用关系）。

### G3 参照系（reference frames）

- **发展心理学**：自我中心 → 客体中心 → 环境中心的空间编码不是三套算法，而是同一关系在不同
  参照系里的读数；儿童先并存，再按任务切换。
- **格式塔**：图形—背景（figure-ground）与大小恒常（size constancy）都是“相对参照系”的结果。
- **现状**：6 个 `layout` 模式分支。
- **做法**：每个 loop 同时输出三组关系：`object`（物体框）、`background`（背景中心/尺度）、
  `neighborhood`（邻域感受野质心/尺度），每组是独立 `partition`；`ObservationBuffer` 分别问句，
  `mergeRanked` 用修订合并。**不是三选一，是三种观察集竞争。**
- **删掉**：C2、C3、C4 的模式分支、K2。

### G4 图/底与多填充尺度（figure-ground / scale-space）

- **格式塔**：图与底互为条件；空心圈的“空”是**被图围住的底**，不是洞。
- **发展心理学**：客体永久性（object permanence）——被遮挡/中空的对象仍是对象。
- **现状**：`growDiscs` 只长实心；空心靠 `boundaryDiscs`+`fineRings` 专用通道。
- **做法**：区域候选带 `fill`（活跃格/覆盖格）；低填充区域是图，其内部连通背景是“底”区域；
  `center_blank` 改为“该底区域被此图围住”的关系。尺度用 `SCALES`（多个半径档）而不是一条专用通道。
- **删掉**：A3 的硬排除、A5、C26、D1–D4、J1。
- **验收**：空心圈在**同一条**候选通道里出现；`boundaryLoops` 从 `FrameObs` 消失。

### G5 比较即证据（comparison as evidence）

- **OpenNARS**：比较（`com`）由两个继承前提共享第三词项产生相似；比较结果是真值，不是分数。
- **格式塔**：恒常性（constancy）来自“同一性质在不同操作下保持”。
- **现状**：恒常用 `0.6*smooth+0.4*size>0.55`；Shift 差用 `atan2` 阈值；比较模式反而是可选项。
- **做法**：相邻 Shift 的 `dir_*`/`step_*` 性质用 `com` 比较；`const_low/high`、`shift_diff` 直接取
  比较真值；`shift_diff_accum` 是这些真值的累计（修订）。角度只作通道读数，不再参与语义阈值。
- **删掉**：C7、C9、C10、C11、C22、I1；C12 升为唯一路径。

### G6 习惯与修订（habituation / revision）

- **OpenNARS**：同一陈述的新证据用修订合并，置信度随证据量增长；长期不用的信念被遗忘。
- **发展心理学**：重复使反应变快、变省（习惯化）；新异刺激才重新分配注意。
- **现状**：`f=0.99/0.01`、`c=0.9`、重复曲线、bigram 覆盖率、预算加成——四套手写置信度。
- **做法**：观察进 `ObservationBuffer` 时同词项同分区**修订**；置信度由证据数决定；未出现是
  “这一帧检查过且没有”的观察（有限的封闭世界），不是全局负证据。
- **删掉**：K8、K9、K10、K11、C1 的计数字段（计数由修订/耐久度表达）。

### G7 交集引入（intersection introduction under attention）

- **OpenNARS**：NAL-3 交集引入 `M→T1, M→T2 ⇒ M→(T1∩T2)`；`∩` 可继续参与推理。
- **格式塔**：分组（grouping）就是“把共现的性质合成一个整体”； Prägnanz 让最活跃的整体胜出。
- **现状**：`chainCompounds/chainPairs/chainRings/linkCompounds` 四处手拼；`parts.ts` 也手拼。
- **做法**：`Engine.compose=true`，只在同一 `partition` 内、只对优先级前 `COMPOSE_TOP` 条观察做
  交集引入；`∩` 词项作为普通观察继续进记忆。
- **删掉**：C18–C21、C31 的复合、E8。
- **参数**：`COMPOSE_TOP`（默认 8）。

### G8 段与残段（segments and residue）

- **格式塔**：好连续把一条链读成一个段；闭合段是“圈”，未闭合段是“残段”；残段相对闭合段的方位
  是普通关系，不是新词表。
- **现状**：`parts.ts` 的 `part_loop/part_line/part_curve/part_tail_*` 并行分类法。
- **做法**：段就是 walk 的结果；段的属性用已有 `closure/accum/len/dir`；残段与闭合段之间输出
  G2 的 `dir/dist` 关系。
- **删掉**：整个 `parts.ts`（E1–E8），`parts/partRelation/partBlob` 开关。

### G9 基数（cardinality）

- **OpenNARS**：外延/内涵的大小是词项语义的一部分；基数可以作为观察。
- **现状**：`loops_n/chains_n/shifts_n/blk_steps_*/graph_deg_*` 各写各的。
- **做法**：一个 `countOf(relations, kind)` 输出 `count_*`；度=某节点的 `near` 关系数；环=闭合 walk，
  不是环秩。
- **删掉**：C5 的重复、C29、F2。

### G10 动作经验与无监督词表（motor experience / unsupervised vocabulary）

- **发展心理学**：婴儿通过自主动作（注视、抓握、爬）制造经验；不是别人给“平移增强”。
- **OpenNARS**：经验是系统自己接收/产生的判断；没有“训练集特征选择”这回事。
- **现状**：`BABY_AUGMENT`（±1 平移）、`BIGRAM_MIN/COMPOUND_MIN/CURRICULUM_CULL`（用标签剪词表）。
- **做法**：经验=自移位产生的新帧；词表保留所有被注意到的词项，由 `ObservationBuffer` 容量选择；
  标签只用于答案问句，不用于决定“哪些词项存在”。
- **删掉**：K18（按 digit 组织词表）、K19、K20。
- **验收**：训练词表可以**不看 digit** 算出来（换标签不影响词表）。

### G11 零先验（no per-class priors）

- **AIKR**：先验只能来自经验，不能来自“我知道这是 1”。
- **现状**：`BABY_ONE_PRIOR`、`BABY_EIGHT_DELTA`、`strokeTerms`（1 的形状先验）。
- **做法**：全删。若某类系统性缺失，回到 G1/G4 补**通道能力**，不补类别分。
- **验收**：`grep -n "digit_" src/perception` 为空；baby 里没有按 digit 加分的分支。

### G12 参数账本（parameter ledger）

- **现状**：~40 个魔数散落 + ~30 个环境变量。
- **做法**：见 §6；通道参数在 `src/perception/params.ts`，注意/证据参数在 `src/nars/params.ts`
  （只用通用名）；所有默认值一处可查。
- **验收**：grep 不到裸的 `0.85`/`0.55`/`0.35`/`12` 语义阈值。

---

## 4. 逐项方案（重点）

### 4.1 借用闭合 → 复访（用户举例，最先做）

**现在**

```ts
// sense.ts：一条链走过就不再回来
if (inChain.has(i) || !canVisit(i)) continue;
...
// structure.ts：开放链两端靠近同一个第三 loop → 记一个专用词
if (headGap <= ... && tailGap <= ...) { borrowedLoop++; }
add("closure_borrowed_loop", 1);
```

**改成**

```ts
// 候选进袋；用过的元素回袋，只降优先级，不禁止
used.set(best, (used.get(best) ?? 0) + 1);
if (used.get(best)! < REVISIT) {
  bag.putBack({ ...candidate, priority: candidate.priority * DECAY });
}
// 走到起点 = 闭合，不再需要“借”
```

- 链会自然经过第三个 loop 并回到起点；`closure` 是“首尾同点”，不是“借到桥”。
- `#8040` 的两条反向链会合成一条闭合链（或一条带自交的链），由 `closure` 直接表达。
- 删：`borrowLoop`、`reverseClosure`、`closure_borrowed_loop`、`closures_borrowed_loop_*`、
  `double_borrowed_loop`、`BABY_EIGHT_DELTA`。
- 参数：`REVISIT`、`DECAY`。

### 4.2 空心圈 → 图/底（A3/A5/C26）

**现在**：实心圆生长 + 边界小盘专用通道 + 枚举环。

**改成**：

```ts
type Region = { cells: number; fill: number; polarity: "figure" | "ground"; encloses: number[] };
```

- 生长时允许低填充（`fill >= FILL_MIN`），低填充即“图是环”；
- 环内部的连通背景是 `ground` 区域，`encloses` 指向它；
- `圈∩空` 由“图区域 + 它围住的底区域”经 `∩` 引入，不再用链质心距离。

**删**：`boundaryDiscs`、`fineRings`、`rings.findCycles`、`ring-terms.ts`、`partition-report.ts`。

### 4.3 布局 → 三种参照系（C2/C3）

**现在**：6 个模式，每个模式一段代码。

**改成**：一个函数输出三组观察，`partition` 分别是 `object/background/neighborhood`：

```ts
for (const frame of ["object", "background", "neighborhood"] as const) {
  const { cx, cy, scale } = frameOf(frame, loop, loops, background);
  add(`rel_dir_${frame}_${sectorOf(loop.cx - cx, loop.cy - cy)}`);
  add(`rel_dist_${frame}_${bucket(dist / scale, DIST_CUTS)}`);
  add(`rel_size_${frame}_${bucket(loop.cells / meanCells, SIZE_CUTS)}`);
}
```

三组是三个观察集；`mergeRanked` 用修订合并。**不选模式，让证据选。**

### 4.4 恒常 / Shift 差 → 比较（C7–C12）

**现在**：`smooth*0.6 + size*0.4 > 0.55`。

**改成**：

```ts
const directionMatch = directionsMatch(a, b, before, after);   // com
const stepMatch = applyRule(com, stepA, stepB);                // com
const band = stepMatch ? (directionMatch ? "low" : "high") : null;
```

- 真值直接取比较结果；不再有 `0.55`。
- `shift_diff` 的“方向/步长差”= 比较结果的反面证据；累计=修订。
- `BABY_CONST`/`BABY_SHIFTDIFF` 删除，compare 是唯一路径。

### 4.5 二元组 / 复合 → walk 序列 + 交集引入（C17–C21）

- 二元组 = 同一次 walk 里相邻两步的方向对，`NGRAM_MAX` 一个参数；不再有 `link/smooth/repeat/turns`。
- 跨链拼接不需要 `linkFactor`：walk 本来就走完整张邻近图。
- 复合不再手拼：`Engine.compose` 在同一观察集内做 `∩` 引入，`COMPOSE_TOP` 限流。
- 删：`bigrams` 六变体、`trigrams` 开关、`chainCompounds/chainPairs/chainRings/linkCompounds`。

### 4.6 零件 → 段/残段（parts.ts）

- 段=walk 结果；`part_loop/part_line` 用 `closure/accum` 已有词项表达。
- “尾相对圈”就是 G2 的方向关系：`rel_dir_<sector>` 作用于两个段。
- 删整个文件；6/9 若仍需要区分，靠关系词项 + NAL，不靠零件分类法。

### 4.7 样本先验（K15/K16/C27/K20）

- 立即删；不做“更温和的替代”。
- 若删除后某类系统性错误，记录在 `docs/progress-assessment.md`，作为**通道能力**问题处理
  （G1/G4），不回到类别分。

### 4.8 训练与词表（K18–K21）

- 词表：所有帧的观察并集（不看标签）；预算=频次/耐久度（不看标签）。
- 记忆：`digit_d → [term]` 的真值由**逐样本证据的 `revision`** 得到（每个样本一次
  `{f:出现?1:0, c:0.9}`），不再硬编码 `0.99`，也不再用 `n/(n+k)` 公式；
  `f` 是证据修订后的频率（与类内出现率一致）。
- 增强：改成“自移位经验”（同一帧的多个相对位置），但**不参与词表选择**。

---

## 5. 删除路线（阶段 0–8）

每阶段结束：`npm run typecheck` 通过；`node tools/baby.ts train && node tools/baby.ts test`
能跑完（分数只记录，不回退、不比较）；`git commit` 一条，提交信息写“删了什么/迁移到什么”。

| 阶段 | 主题 | 删除 | 新增/改写 | 退出判据 |
|---|---|---|---|---|
| **0** | 先验与死代码 | C27、C33、C34、C36、A5、C26、C30、J1、K4、K15、K16、K17、K20（标签剪枝）、L4 | 用 `Term.depth` 替代 `termLayer`；训练词表改无监督 | 无 `ONE/EIGHT`；`grep digit_ src/perception` 空；typecheck |
| **1** | 复访 | B3、B4、C23、C24、C25、C32、K16 残留 | G1：`Bag.putBack` + `REVISIT/DECAY` | #8040 出现闭合 walk；无 `borrowed` 词 |
| **2** | 参照系 | C2、C3、C4 分支、K2 | G3 三参照系 + `byPartition` | 无 `BABY_LAYOUT`；三组观察都在 |
| **3** | 图/底 | A3 硬排除、A5、C26、D1–D4、J1 | G4 区域 `fill/polarity/encloses`；删 `boundaryLoops` | 空心圈走同一通道 |
| **4** | 比较 | C7、C9、C10、C11、C22、I1 | G5 比较唯一路径 | 无 `0.55` 权重；`const_*` 来自 `com` |
| **5** | 序列/复合 | C17–C21、K10、K14 | G7 `Engine.compose` + `NGRAM_MAX` | 手拼复合为 0；`∩` 由引擎产生 |
| **6** | 零件/图/块 | C28–C31、E1–E8、F1–F3、G1–G2、D1–D4 | G8/G9；删 `parts.ts/rings.ts/blocks.ts/partition-report.ts/ring-terms.ts` | 文件删除；词表只剩关系/段/基数 |
| **7** | 开关板 | K1、K2、K8–K13、K18–K19、H1 | G6/G10/G12；参数账本；figures 移到 fixtures | `grep BABY_` 只剩 `GRID/TRAIN_PER/TEST_*` |
| **8** | 文档与报告 | L2、L3、L5、K23 的分数叙事 | README/HANDOFF 改写；报告只作仪表 | 文档不再以正确率为主语 |

> 阶段可交错，但**一个阶段没删干净不进入下一个主题**；宁可慢，不可把专用代码留下当“保险”。

---

## 6. 参数账本（唯一来源）

> 只列语义相关的；通道参数允许调，但必须在表里。默认值可改，改时只改这里。

| 组 | 参数 | 含义 | 默认 |
|---|---|---|---|
| 通道 | `ACTIVE` | 活跃格强度阈值 | 0.3 |
| 通道 | `FILL_MIN` | 区域最低填充（图可以是环） | 0.15 |
| 通道 | `SCALES` | 多尺度半径档 | [1, 2, 4, 8] |
| 通道 | `MAX_IMPURITY` | 生长允许的杂质 | 0.1 |
| walk | `REACH` | 可达 = (r1+r2)×REACH | 1.06 |
| walk | `REVISIT` | 一个元素最多被选几次（复访） | 2 |
| walk | `REVISIT_PENALTY` | 每次复访的优先级惩罚（耐久度） | 0.35 |
| walk | `BRIDGE_REACH` | 无正常候选时的一次性放宽 reach | 1.25 |
| walk | `BRIDGE_STEPS` | 每条链最多几次桥接 | 1 |
| walk | `MERGE_REACH` | 两条链端点合并的 reach 系数 | 1.12 |
| walk | `MERGE_TURN` | 合并处允许的最大转角（好连续） | 0.55π |
| 闭合 | `CLOSURE` | 子轮廓首尾距离 / (r1+r2) 上限 | 1.15 |
| 闭合 | `MIN_CONTOUR_SPAN` | 子轮廓周长 / (r1+r2) 下限 | 2.5 |
| 闭合 | `MIN_CONTOUR_AREA` | 子轮廓面积 / (r1+r2)² 下限 | 1.2 |
| walk | `MIN_PRIORITY` | 低于此不再回袋 | 0.02 |
| 量化 | `SECTORS` | 方向扇区数 | 8 |
| 量化 | `DIST_CUTS` | 相对距离桶 | [0.5, 1, 1.5, 2.5] |
| 量化 | `SIZE_CUTS` | 相对大小桶 | [0.75, 1.33] |
| 量化 | `STEP_CUTS` | 相对步长桶 | [0.75, 1.33] |
| 量化 | `TURN_CUTS` | 累计转角（四分之一圈） | π/2 |
| 注意 | `OBS_CAPACITY` | 观察缓冲容量 | 全量→预算 |
| 注意 | `COMPOSE_LIMIT` | 推断时引擎每帧最多引入多少条复合 | 12 |
| 注意 | `TRAIN_COMPOSE_LIMIT` | 训练时每个观察集最多引入多少条复合 | 6 |
| 注意 | `TRAIN_CYCLES` | 训练侧每个观察集的推理周期 | 1500 |
| 注意 | `CYCLES_PER_FRAME` / `CYCLES_FALLBACK` | 每个观察集 / 回退单集的推理周期上限 | 20000 / 60000 |
| 证据 | `PRESENT_F` | 观察“出现”的频率读数 | 0.99 |
| 证据 | `ABSENT_F` | 观察“未出现”的频率读数 | 0.01 |
| 证据 | `OBSERVATION_C` | 单次观察的置信度 | 0.9 |
| 证据 | `OBS_PRIORITY` | 单次观察进缓冲的优先级 | 0.6 |
| 序列 | `NGRAM_MAX` | 最大 n | 2 |
| 合并 | `MERGE` | 观察集合并策略 | revision |

---

## 7. 当前进度（每轮更新）

| 阶段 | 状态 | 已完成 | 下一步 |
|---|---|---|---|
| 0 | **完成** | 清单/规则/验收；删 1/8 先验、`strokeTerms`、`alternatives`、`termLayer`、`dual`、`curriculumMatch`、`ring-terms`、`boundaryDiscs`、`fineRings`、`graphPath`、类条件词表剪枝、`turns` | —（后续阶段清理其残留文档） |
| 1 | **完成（首版）** | 复访 + 边禁折返 + 桥接；端点合并 + 闭合子轮廓；删 `VISIT_CAP/inChain`、`borrowLoop`、`reverseClosure`、link 二元组、`chainPairs/chainRings/linkCompounds`、`trigrams` | 折线/S 的小闭合子段残余 |
| 1b | **完成** | 两两关系改用 8 扇区；删 `distance > 12` 截断与 `left/right/above/below` 四方向；读出魔法数进命名常量 | 与链共用同一套方向量化 |
| 2 | **完成** | 6 种 layout 模式 → 三参照系（object/background/neighborhood）+ 每集词表 `memory/frames.json`；删 `BABY_LAYOUT`、`BABY_NO_LAYOUT`、`layout` 字段 | 观察集数量/容量交给预算 |
| 3 | **完成（首版）** | 图/底区域：`groundsOf` 从物体框边界进不去的空白连通块；`ground_candidate/size_*`；`center_blank` 改为“链中心附近的底区域”；删 `boundaryDiscs/fineRings/rings` 的洞通道 | 底区域与图区域的包含关系可继续细化 |
| 4 | **完成** | 恒常/Shift 差只走 `com` 比较；删 channel 权重 `0.6/0.4/0.55`、`shiftDiffBucket(0.35)`、`cmp_*`、`shift-compare.ts`、`BABY_CONST/SHIFTDIFF/CMP/ACCUM/DIRTHRESH`、sector 累计 | `accum` 的量化只作通道读数 |
| 5 | **完成（首版）** | 删 `chainCompounds` 手拼；`nars/compose.ts` 新增 `composeAll`（每观察集只取前 `COMPOSE_TOP` 条两两引入），`baby` 用它生成 ∩ 观察；`COMPOSE_TOP` 默认 2 | 真正的 `Engine.compose` 端到端训练留待后续 |
| 6 | **完成（首版）** | 删 `parts.ts`、`blocks.ts`、`rings.ts`、`partition-report.ts`；删 parts/partBlob/partRelation/blocks/graph 模式；`figures.ts` 移到 `tools/figures.ts`；`composeProperties` 并入 `src/nars/compose.ts` | 环碎片化 → 走法端点优先（见 §7.5） |
| 7 | **完成** | 删 `STRUCTURE_MODE` 开关板；`StructureMode` 只剩 `directionThreshold`；删 `chainOrder/degree`、`dedupChains`、`bigrams`/`chainCompounds` 开关、类间方差预算、平移增强、`blk_/cmp_` 过滤；环境变量改 `PD6_*` | 仅保留训练/评估/探针配置 |
| 8 | **部分** | README/structure/perception/directive/boundaries/HANDOFF 已重写；旧 `mechanism-audit` 等删除；类原型真值改为逐样本证据 revision | 论文/报告叙事；G6 的“逐事件入记忆”仍压缩为原型 |

### 7.1 第 0 阶段删除记录（提交信息同步）

- `src/perception/structure.ts`：`STRUCTURE_LAYERS`、`StructureAlternative`、`alternatives`、
  `termLayer`、`strokeTerms` 整块、`fineRings` 整块、`graphPath` 整块、`receptive/field/both/multi`
  之外未动（阶段 2）；
- `src/perception/discs.ts`：`boundaryDiscs`；
- `src/perception/sense.ts`：`fineRings` 选项、`boundaryLoops`；
- `src/perception/ring-terms.ts`：整文件删除；
- `tools/ring-probe.ts`、`tools/multi-observation.ts`：整文件删除（对应的专用特性已删）；
- `tools/baby.ts`：`BABY_ONE_PRIOR`/`BABY_ONE_DELTA`、`BABY_EIGHT_DELTA`、`classifyDual`/`BABY_DUAL`、
  `curriculumMatch`/`loadCurriculum`、`ringEvidence`/`compareShifts`/`chainPartitions`/`classicFigures`
  的默认路径引用、`BABY_COMPOUND_MIN`/`BABY_BIGRAM_MIN`/`BABY_CURRICULUM_CULL`（改为**无监督**频次预算
  `MIN_TERM_RATE`）、`BABY_BIGRAM_CONF`/`LINK_CONF`/`BIGRAM_ABSENT`/`REPEAT`/`BUDGET_CONF`/`BUDGET_BOOST`；
- `src/view/report.ts`：删 `hypotheses/shiftComparison/partitions/curriculumMatch/alternatives`
  字段与渲染；`LAYER_NAMES` 改为词项句法复杂度。

读数（只作事故记录，不作目标）：删先验后测试 82.0%（164/200）；这正是被删掉的两条先验原先
“借”来的分。此后不再以分数判断任何改动。

### 7.2 第 1 阶段：借用闭合 → 复访（用户举例）

- `sense.chainsOf`：去掉 `VISIT_CAP` 与 `inChain`；用过的 loop 仍可再选，只是优先级按
  `REVISIT_PENALTY` 下降；同一条无向边不能来回走（避免“原地折返”冒充闭合）；正常 reach
  无候选时允许一次 `BRIDGE_REACH` 的桥接步。
- `structure.ts`：删 `borrowLoop`/`reverseClosure`（及其词项 `closure_borrowed_loop*`、
  `double_borrowed_loop`、`closure_reverse_pair`）；`closure` 只由“链首尾回到同一处”产生。
- 结果：`#8040` 的 8 步链 `gap=0.00`，`closure` 出现，且**没有用到桥接**——单靠“允许复访”
  就闭合了。这正是用户说的“扫描的推理元素即使最近被推理过，仍然能进行二次推理”。
- 同批删除：`link`/`link2` 跨链拼接、`chainPairs`、`chainRings`、`linkCompounds`、`trigrams`、
  `bigram` 的 `repeat/smooth/chain3/turns` 变体；二元组只剩一条路径。
- 参数：`REVISIT=2`、`REVISIT_PENALTY=0.35`、`BRIDGE_REACH=1.25`、`BRIDGE_STEPS=1`
  （已进 §6 账本，待补行）。

### 7.3 第 2 阶段：布局模式 → 参照系观察集

- `structure.ts`：删 `StructureMode.layout` 与 6 个分支；一个循环同时产出
  `object`（物体框 4×4 相对位置/大小/填充）、`background`（背景中心方向/距离/大小）、
  `neighborhood`（邻域质心方向/距离/大小 + 基数 + 到边界距离）三组观察。
- `Structure.partitions`：`object / background / neighborhood / structure` 四个观察集；
  `structure` 是其余结构词项（loop/Shift/闭包/bigram…）。
- `tools/baby.ts`：训练时按观察集收集词表（不看标签）写 `memory/frames.json`；测试时对每个集
  分别问 `frame#集 ↔ digit_d`，再用**修订**合并（`mergeRanked` 的通用版回来了，但不是策略开关，
  只有 revision 一条路）。`trace` 会打印每个集的答案。
- 删：`BABY_LAYOUT`/`BABY_NO_LAYOUT`、`isLayoutTerm`/`layoutAllowed`、`lzone2`/`lnear_close`。
- 验收：`structure.partitions` 在 50 张 digest 里稳定；`trace` 能看到 4 个集的答案与合并答案；
  `grep -n "layout" src/perception tools/baby.ts` 只剩注释/参照系词。

### 7.4 第 4 阶段：恒常 / Shift 差 → 只走比较

- `structure.ts`：`const_*` 不再由 `0.6*smooth + 0.4*size > 0.55` 产生；`const_low` = 相邻 Shift 的
  方向比较“同向” + 步长比较“同步长”，`const_high` = 异向但同步长。Shift 差的 `s/l/r` 由
  `directionsMatch`（`com`）决定，`l/r` 只用扇区顺序区分。
- 删：`shiftDiffBucket`、`mode.compare/constancy/shiftDiff/accum`、`cmp_dir/cmp_step/cmp_pairs`、
  `tools/shift-compare.ts`、`tools/derivation-diff.ts`、`tools/threshold-scan.ts`、
  `src/perception/shift-compare.ts`、`BABY_CONST/SHIFTDIFF/CMP/ACCUM/DIRTHRESH`。
- 保留：`shift_diff_accum_*` 的角度累计（通道量化，P）；`directionThreshold` 仍是可审计参数。
- 验收：`grep -n "0.55\|shiftDiffBucket\|cmp_" src/perception` 为空；`trace` 里 `const_*` 出现，
  且没有第二套 angle 路径。

### 7.4.1 第 1 阶段补：端点合并 + 闭合子轮廓

- `sense.mergeChains`：两条链的端点足够近（`MERGE_REACH=1.12`）、方向连续（`MERGE_TURN=0.55π`）
  时合并；共享同一个 loop 的端点也允许（去掉重复节点）。这是格式塔“好连续 + 闭合”的通用补全，
  不再靠“每条链各自贪心、走不动就结束”。
- `structure.closedSegments`：闭合不再要求整条链首尾相接；链里任一段（≥4 个 loop）首尾回到同一处
  就是闭合子轮廓，允许“圈 + 尾巴”。为避免把拐角处的几个 loop 当轮廓，还要求
  `周长/(r1+r2) ≥ 2.5`（相对尺度，不是形状规则）。
- 经典图探针：单圈+尾、6（圈+尾）现在都有 `closure` 与 `圈∩空`；纯圆/双圈保持。
- 已知残余：折线/S 仍可能因密集 loop 出现小闭合子段；`#1208`（1）也有。下一步用“闭合区域是否
  围住底区域”或“好连续真值”细化，而不是加形状规则。

### 7.4.2 第 1b 阶段：两两关系与读出常量

- `lrel_left/right/above/below` → `lrel_<0..7>`，与链的 `sectorOf` 共用同一套 8 扇区；
  删除 `distance > 12` 的绝对截断，距离改用相对半径 `distance/((r1+r2)/2)` 的桶。
- `tools/baby.ts` 的读出魔法数命名：`PRESENT_F`/`ABSENT_F`/`OBSERVATION_C`/`OBS_PRIORITY`/
  `CYCLES_PER_FRAME`/`CYCLES_FALLBACK`；原型 `f` 的下限用 `ABSENT_F`。
- 验收：`grep -n '"right"\|"left"\|"above"\|"below"' src/perception` 为空；
  `grep -n "0\.99\|0\.01\|20000\|60000" tools/baby.ts` 只剩常量定义。

### 7.4.3 第 1c 阶段：走法适配度 = 合取真值（B1）

- `sense.chainsOf` 不再用 `distance*1e-3 + acos(cos)/π + |Δlen|/max` 的手调加权和；
  候选优先级 = **near ∧ 好连续 ∧ 步长相似** 的合取真值：`f = f_near · f_dir · f_step`
  （与 NAL 强合取同式），再减 `visits × REVISIT_PENALTY`（注意衰减）。
- `near = 1 − distance/reach`；`f_dir = (cos+1)/2`；`f_step = 1 − |d−l|/max(d,l)`；
  没有 heading 时（第一步）只取 near。
- 合并时禁止两条链共享超过一个 loop：否则拼接会走回头路（本轮发现并修掉的一个退化）。
- `closure` 的 reach 从 `0.85` 调到 `1.15`：采样稀时首尾差一格仍算回到原地；这是通道级小缺口，
  与 bridge 的 1.25 同量级，不是形状规则。
- 经典图：纯圆/双圈/单圈+尾/6 保持 `closure + 圈∩空`；折线/S 仍有小闭合子段（C16 残余）。
- 验收：`grep -n "score\|1e-3" src/perception/sense.ts` 为空；`acos` 只用于合并处的转角判断；
  `train/test/trace` 正常。

### 7.11 剩余专用项审计（第 3 轮）

- **D 44 + X 8 = 52 项已全部删除**。
- **S 21 项：16 项已迁，5 项经审计重分类为 T/P（不再是 MNIST 专用）**：
  B1、C2、C4、C7、C11、C14、C18、C23、C24、C25、K3、K8–K11、K18–K21 已迁；
  A2、A3、C1、C6、C16 重分类（理由见下表）。
- **结论：`src/perception/` 与 `tools/baby.ts` 里已没有“只有 MNIST 才成立”的专用语义**；
  剩下的是通用通道/编码参数与两个通用架构缺口。

| ID | 内容 | 重分类 | 理由 |
|---|---|---|---|
| A2 | `growDiscs` 的 `covered` 赢者通吃 | T（通道分割） | 换任何图像都成立；是候选生成的正则，不知道类别。实验：`OVERLAP_CAP=2` 让候选翻倍（18→35）且“角”出现伪闭合；无注意选择时不应放开。见 §7.14 |
| A3 | 只长实心（`TOLERANCE=0.1`） | P（通道参数） | 只影响候选形状；空心由 `groundsOf` 的底区域承担，不需要专用洞通道 |
| C1 | 扁平字符串词项袋 | T（编码） | 是词项编码形式，不是类别判断；改成“观察=句子”属引擎改造 |
| C6 | 高斯平滑 σ=r | P（尺度参数） | 用感受野尺度平滑轨迹，是通道尺度选择，不是语义规则 |
| C16 | `closure` 二值阈值 | P（结构量化） | 阈值/子段判定是结构量化；折线/S/1 的小闭合子段是已知残余，待好连续真值 |

- **残余的通用工作**（不是 MNIST 专用）：
  1. C16：闭合残余，用“好连续真值/包围底区域”细化；
  2. G7：已完成首版——推断与训练都由 `Engine.compose` 引入 `∩`；
  3. G6：逐样本事件入记忆（当前用逐样本证据 revision 压缩成类原型，不存每个 `frame_i`）。

- 完成度口径：**D/X 100% 删除；S 21/21 关闭（16 迁移 + 5 重分类）；MNIST 专用语义 0 项。**
  剩余是通用结构质量（C16）与 G6 的“逐事件入记忆”，不以分数衡量。

### 7.15 G7：交集引入进入 Engine（推断 + 训练）

- `EngineOptions` 增加 `composeLimit`；`Engine.step` 在**事件缓冲**上做交集引入：
  当前任务与其它待处理观察共享主项时，`composeIntersection` 产生 `frame → ∩(...)`，
  作为临时信念 + 任务继续参与推理，最多 `COMPOSE_LIMIT` 条/帧。
- 复合结论不再由 `baby` 预计算后当观察喂入：`ask` 只喂基础观察（过滤 `∩(` 词项），
  引擎自己引入复合；`memory.forget(frame)` 在问完后清掉临时概念。
- **训练侧也走引擎**：`composedByEngine` 对每个观察集建一个一次性 `Memory`，喂入基础观察，
  `Engine.compose` 引入复合；收集 `engine.composedTerms`（复合谓词 key）计入类原型。
  `composeAll` 已删除。
- 参数：`COMPOSE_LIMIT=12`（推断）、`TRAIN_COMPOSE_LIMIT=6` + `TRAIN_CYCLES=1500`（训练）。
- 验证：`Engine` 在 `learn=false` 下对三个同主项观察可引入 4 条复合（探针）；
  `train/test` 正常；训练后词表 579 种 / 5790 概念 / 519 KB（比枚举版 409/4090/345 KB 大，
  因为引擎实际产生的复合按经验预算保留）。
- 仍待做：G6 逐样本事件入记忆，让 `∩` 原型也能从逐样本证据修订，而不是一次性类频。

### 7.16 C16：闭合子轮廓的面积下限

- 探针显示闭合子段的 **多边形面积 / (r1+r2)²** 能把真假轮廓分开：
  纯圆 16.9、双圈 3.5–6.9、单圈+尾/6 7.8、#8040 1.55–3.15、#9000 2.46；
  折线 0.70–0.97、S 0.26–0.52、#1208 0.09–0.73、#6039 0.00–0.23。
- `closedSegments` 增加 `MIN_CONTOUR_AREA=1.2`（相对面积，不是形状规则），保留
  `MIN_CONTOUR_SPAN=2.5` 的相对周长下限。
- 结果：折线/S/1 不再有 `closure`；纯圆/双圈/单圈+尾/6/#8040 保持；#9000 保持 `closure`。
  `#6039`（6）的链是往返折返、没有围出面积，因此不再误报 `closure`——这是正确的负结果，
  不是通道丢失概念。
- 剩余：G6 完全体（逐帧信念入记忆）；论文/报告叙事。

### 7.14 A2 重叠候选实验（负结果，已回退）

- 假设：`growDiscs` 的 `covered` 赢者通吃是专用分区，改成 `OVERLAP_CAP=2`（一格最多参与 2 个候选）
  可以允许交叉/桥接处重叠。
- 结果：候选数翻倍（纯圆 18→35、角 9→17、S 12→16）；经典图“角”出现 `closure`（伪闭合），
  结构语义变差。
- 结论：没有注意选择机制时，赢者通吃是**通道级正则**，不是 MNIST 专用语义；重分类为 T。
  若未来做重叠候选，必须同时有“按优先级/预算选候选”的机制，而不是简单放开覆盖。
- 代码已回退，未进入默认路径。

### 7.13 第 3b 阶段：图-底包含关系（A6）

- `structure.ts` 新增 `pointInPolygon` / `enclosesGround`：闭合子轮廓的 loop 顶点构成多边形，
  底区域的质心落在多边形内才算“围住”。
- `center_blank` 不再用“轮廓质心与底区域圆心距离 ≤ 半径”的近似，而是真正的包含关系；
  这是图-底关系，不是洞检测。
- 经典图结果不变：纯圆/双圈/单圈+尾/6 有 `center_blank`；折线/角/S 没有。
- `#9000` 有底区域但当前链的闭合子轮廓没有围住它（上层圈），说明走法仍有提升空间；
  记录为结构限制，不按分数修。

### 7.12 第 5b 阶段：删除 `Structure.compounds` 与手选“圈∩空”

- `structure.ts` 不再手拼 `∩(accum, center_blank, const)`；`center_blank` 在“闭合子轮廓中心
  有底区域”时作为**普通观察**加入 `structure` 观察集。
- 删除 `Structure.compounds` / `CompoundUse`；删除 `nars/compose.ts` 的 `composeProperties` /
  `flattenIntersection`（不再需要手折复合）；`composeAll` 保留为推理侧有预算的交集引入。
- 更新所有读取 `structure.compounds` 的探针（baby/digest/debug-sample/classic/translation-layers）；
  删除 `compose-diff.ts`、`compose-sample.ts`。
- 经典图验证：`center_blank` 只出现在纯圆/双圈/单圈+尾/6，折线/角/S 没有；这正是图-底关系，
  不再依赖手选复合。
- 记忆从 425 种/4250 概念降到 **409 种/4090 概念**（二进制 371→345 KB），说明删掉的是
  手拼词项，不是能力。

### 7.5 第 6 阶段：零件 / 块 / 环 / 图 → 删除

- 删文件：`src/perception/parts.ts`、`blocks.ts`、`rings.ts`、`partition-report.ts`；
- 删模式：`StructureMode.parts/partRelation/partBlob/blocks/graph`；
- 删探针：`tools/part-curriculum.ts`、`partition-observation.ts`、`partition-evidence.ts`、
  `multi-observation-2.ts`、`rings.ts`、`hypotheses.ts`；
- `figures.ts` 移到 `tools/figures.ts`（测试世界数据，不是感知机制）；
- `flattenIntersection`/`composeProperties` 移到 `src/nars/compose.ts`，删 `src/perception/compose.ts`。
- `src/perception` 从 10 个文件降到 **3 个**（`discs/sense/structure`），体积约 30 KB。
- 已知限制（不是分数问题）：环会被拆成多条链，单圈+尾不一定由一条链走完。
  下一步不是加专用规则，而是把走法改成“按开链端点优先级全局延伸/合并”。

### 7.6 第 8 阶段（部分）：文档与叙事

- 重写：`README.md`、`docs/structure.md`、`docs/perception-as-reasoning.md`、
  `docs/directive.md`、`docs/boundaries.md`、`docs/progress-assessment.md`、`docs/HANDOFF.md`；
- 删除：`docs/mechanism-audit.md`、`completion-assessment.md`、`next-architecture.md`、
  `part-composition.md`、`layout-receptive-field.md`、`terms.md`、`error-analysis.md`、旧报告图；
- 全项目不再以 83.5%/82.0% 为叙事主语；分数只在事故记录里出现。

### 7.7 第 7 阶段：开关板 → 单一实现

- `StructureMode` 从 10 个开关收敛到 **1 个参数**（`directionThreshold`）；
  `sense.chainsOf` 删 `startOrder=degree` 与 `SenseOptions`；`structureOf(grid)` 无模式。
- 删 `dedupChains`（重复链交给观察修订/预算，而不是手写端点去重）、`bigrams` 开关（二元组总是算）、
  `chainCompounds` 开关（链级 ∩ 总是算，阶段 5 再交给引擎）。
- 删类间方差预算 `memory/budget.json`（标签只用于类原型，不再用于优先级）；
  删平移增强 `BABY_AUGMENT`（动作经验暂不做）；删 `blk_/cmp_` 过滤（对应词项已不存在）。
- 环境变量从 30 个降到 5 个：`PD6_TRAIN_PER`、`PD6_TEST_OFFSET`、`PD6_TEST_PER`、
  `PD6_MIN_TERM_RATE`、`PD6_SHIFT_PAIRS`/`PD6_SHIFT_DUMP`（后两个只给平移探针）。
- 验收：`grep -rn "BABY_" src tools` 为空；`StructureMode` 只有一个字段；训练/测试/`trace` 正常。

### 7.8 第 3 阶段：图/底区域

- `sense.ts` 新增 `groundsOf`：在物体框内从边界做 4 邻域洪泛，进不去的空白连通块就是**底区域**；
  与图候选同一条通道，只是 `polarity:"ground"`。不是洞检测，也不再有 `boundaryDiscs`/`fineRings`。
- `structure.ts` 输出 `ground_candidate` / `ground_size_*`；`圈∩空` 的 `center_blank` 改为
  “链中心附近有一个底区域”，不再用“链质心到各 loop 半径”的质心判据。
- 经典图探针：纯圆/双圈/单圈+尾/6 出现底区域；折线/角/S 没有。`#8040`、`#9000` 出现底区域；
  `#1208`、`#6039` 没有（与结构直觉一致）。
- 已知限制：双圈/单圈+尾的链不一定走满整圈，`圈∩空` 仍可能不出现；这是 §7.5 的走法问题，
  不是底区域的问题。
- 验收：`grep -rn "boundaryDiscs\|fineRings" src` 为空；`ring_*` 词项为空；`ground_*` 在环状图出现。

### 7.9 第 5 阶段：手拼链级复合 → 有预算的交集引入

- 删 `structure.ts` 的 `chainCompounds` 块（“bigram × closure/const”手选组合）与 `chainBigrams`。
- `src/nars/compose.ts` 新增 `composeAll(keys, topK)`：只看顺序/优先级，对前 `topK` 个观察两两
  调用 `composeIntersection`，返回 `∩` 词项；不含具体词项名、不看类别。
- `tools/baby.ts` 的 `observationsOf` 对每个观察集调用 `composeAll`（`COMPOSE_TOP`，默认 **2**），
  把 `∩` 观察并入该集与词表；训练/测试共用同一函数。
- 为什么默认 2：`COMPOSE_TOP=6` 时词表 1684 种 / 16840 概念 / 1.7 MB 二进制、测试 32 s，
  是无预算组合爆炸；`2` 时 423 种 / 4230 概念 / 7.2 s，仍保留“交集可引入”的通用能力。
  这是**经验预算**，不是按类别剪枝。
- 已知限制：真正的 `Engine.compose`（在引擎工作周期里按注意力引入、并让类原型从经验中长出
  `∩` 词项）还没做；当前是推理侧的有预算观察生成。下一步在阶段 8 里接。

### 7.10 第 8 阶段：类原型真值来自逐样本 evidence revision（G6 首版）

- `tools/baby.ts` 新增 `prototypeTruth(hits, total)`：每个训练样本是一次
  `{f: 出现?1:0, c: OBSERVATION_C}` 证据，按 NAL `revision` 逐条累积；`f/c` 由证据算出。
- 删除 `c=0.99` 与 `PRIOR_EVIDENCE` / `n/(n+k)` 公式；记忆仍是一条 `digit_d → [term]`，
  但它代表“这类样本的证据合计”，不是硬编码置信度。
- 仍未做：把每个 `frame_i → [term]` 作为独立信念存进记忆（会带来 800×词表级存储）；
  当前是“逐样本证据 → revision → 一条原型”的压缩。
- 验收：`grep -n "PRIOR_EVIDENCE\|prototypeConfidence" tools/baby.ts` 为空；
  `prototypeTruth` 是唯一写入原型真值的地方。

---

## 8. 与旧文档的冲突处理

- `agents.md` §5“主读数是正确率” → 改为本文 §0.3。
- `docs/boundaries.md` §5“晋升规则 ≥83.5%” → 改为“派生判据 + 删除判据”。
- `docs/directive.md` §4.1 的实验表 → 保留为历史记录，但不再作为“保留/回退”的依据；
  新增一段指向本文。
- `README.md`/`docs/HANDOFF.md` 的 83.5% 主叙事 → 阶段 8 改写；在此之前只加一行“已废止”。

**一句话**：专用特性不是“先留着保分”，而是**待还的技术债**；还清的唯一标志是代码被删、
能力由通用推理派生。
