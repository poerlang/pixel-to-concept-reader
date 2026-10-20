# Pixel to Concept Reader v2

> 通用经验 + NAL + Shift；不写“找圆/找凸/找边界/找近邻”的专用代码。
> 最高约定：[agents.md](agents.md)。实现说明：[docs/experience.md](docs/experience.md)。

## 1. 一句话

**Buffer 只提供共现、顺序、成员；NAL 用 `→`、`↔`、`∩`、`revision` 把反复出现的模式变成概念。**
没有形状检测器，没有 `near()`/`aligned()`/`convexHull()`。

## 2. 直接浏览

- 独立测试报告：[report/index.html](report/index.html)
- 根目录单文件：[test_report.html](test_report.html)
- 3D 经验演示：[public/brain3d/brain3d.standalone.html](public/brain3d/brain3d.standalone.html)

报告与单文件 HTML 都不依赖外部脚本、样式或图片；可以直接双击打开。

## 3. 结构

```text
世界/图像
  → src/experience/world.ts       普通属性观察（entity → property）
  → src/visual/shift.ts           蔓延粗点 + Shift：相对位置差/二阶差
  → src/experience/event.ts       有限 EventBuffer（容量 + 优先级）
  → src/nars/engine.ts            比较 / 相似 / 交集 / 修订
  → src/nars/memory.ts            概念与信念
  → tools/report.ts               所有图像激活报告
  → tools/brain3d.ts              真实 trace → 3D 数据
  → public/brain3d/               Three.js 3D 可视化
```

- `src/nars`：通用 NAL 核心，不含 digit/loop/网格/具体类别名。
- `src/experience`：通用经验循环；只有事件、世界、Buffer、NAL。
- `src/visual`：蔓延求同 → 边界粗点 → Shift 相对矢量 → 曲率经验。
- `tools/report.ts`：加载 `memory/visual.bin`，观察图像，生成可切换报告。
- `public/brain3d`：现有 3D 前端，复用 Three.js 渲染。
- `archive-v1/`：旧版论文/音频/图/代码，仅作历史，不是当前实现。

## 4. 命令

需要 Node.js 22+（直接用 `node tools/*.ts` 运行 TS）。

```bash
npm install
npm run typecheck
npm run grow           # 阶段成长，写入 memory/experience.bin
npm run visual         # 蔓延粗点 + Shift 轨迹 + 直/弯判断
npm run report         # 所有图像 + 点击切换 → test_report.html
npm run report:standalone # 校验自包含并复制为 report/index.html
npm run brain3d        # 加载快照，生成 public/brain3d/data.js
npm run brain3d:serve  # 生成并启动 3D 预览
npm run brain3d:pack   # 生成单文件 brain3d.standalone.html
```

## 5. 演示内容

- 5 个实体在 3D 世界中移动；
- 每帧产生颜色/位置/运动/大小等普通观察；
- `Shift` 选“少改变 + 近”的焦点；`?` 问句做有限的蔓延求同；
- 概念经济：复杂度租金 + 复用/预测/压缩收入；低收益概念会被删除；
- EventBuffer 只保留有限事件；
- NAL 通过共同主项比较出相似、通过交集预算产生复合；
- 记忆先存二进制，启动时加载；3D 图按步骤增长，显示引擎**真实**派生的经验，不是预置形状。

## 6. 真通用规则（摘要）

1. 禁止语义专用谓词/检测器/形状分支；
2. 禁止形状/类别先验、样本先验、类条件剪枝；
3. 禁止手写关系组合；复合交给 `Engine.compose`；
4. 概念名可以来自经验，但不能有 `isCircle()`/`isConvex()`；
5. AIKR 参数只设资源：Buffer 容量、复合预算、复杂度租金、耐久度、遗忘、探索；
6. 不设 `NEAR_WEIGHT`/`CIRCLE_BONUS`/`CONVEX_BONUS`；
7. 分数只作事故记录，不作保留/回退依据；
8. 可由 Shift / 二阶差 / NAL 复合出来的东西，不新增原语。

完整规则见 [agents.md](agents.md)。

## 7. 已删除

- `src/perception/` 全部形状/关系/布局代码；
- 旧专用工具 `baby/curriculum/figures/digest/debug-sample/error-analysis/paper/standalone`；
- 依赖它们的专用文档。

## 8. 文档

- [agents.md](agents.md)：最高约定。
- [docs/experience.md](docs/experience.md)：Buffer + NAL + 3D 演示。
- [docs/visual.md](docs/visual.md)：Shift 相对量、AND 与激活报告。
- [docs/reading-notes.md](docs/reading-notes.md)：理论笔记。
- [docs/HANDOFF.md](docs/HANDOFF.md)：当前状态与下一步。
