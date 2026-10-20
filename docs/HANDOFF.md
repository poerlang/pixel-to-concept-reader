# 交接文档（2026-10-20 · 通用经验版）

> 先读 [`agents.md`](../agents.md)，再读 [`experience.md`](experience.md)。
> 当前代码没有 `src/perception`，没有形状/关系专用检测器。

## 1. 现在做到哪

- `src/nars/`：通用 NAL 核心。
- `src/experience/event.ts`：有限 EventBuffer。
- `src/experience/world.ts`：通用 3D 世界（颜色/位置/运动/大小）。
- `src/experience/grow.ts`：Buffer → Engine → Memory 的经验循环。
- `tools/brain3d.ts`：通用世界 → 真实 trace → 3D 数据。
- `tools/brain3d-standalone.ts` / `serve-brain3d.ts`：3D 打包/服务。

已删除：`src/perception/`、旧 MNIST/形状工具、旧迁移/感知文档。

## 2. 跑什么

```bash
npm run typecheck
npm run grow          # 阶段成长 + memory/experience.bin
npm run visual        # 简单图形经验 + memory/visual.bin
npm run brain3d       # 加载快照，生成 3D 数据
npm run brain3d:serve
npm run brain3d:pack
```

当前 `grow` 是阶段式的：5 个实体起步，阶段中增加同类实体；
每次启动先加载 `memory/experience.bin`，只在新分数更高时覆盖。
`Shift` 选“少改变 + 近”的焦点；`spread` 每场景最多问 3 个 NAL 问句。

视觉经验另走 `npm run visual`：加载 `memory/visual.bin`，先蔓延求同形成边界粗点，再 Shift；
观察使用相对方向/长度/闭合档，并记录相对面积/跨度；不写转向词项，不做像素块匹配、top-k、稀有度或分数归一化。
当前 Shift 经验约 2897 概念 / 451 KB；粗线由粗点序列表达，已不产生假偏转；
场点来自局部差异；纯黑/纯白没有差异，整幅场塌缩成一个粗点、没有方向，报告标为 neutral；90% 白+10% 黑只在交界处产生场点。
方向/长度/二阶差/闭合采用 AND；面积/跨度与子表征覆盖数作为激活权重（不是 AND），
避免采样偏差把整类硬过滤。2号角现在排在 1号竖线前面，1号S/1号半圆也排在单线片段前面；
半圆+斜线同时有半圆和斜线，但仍有少量线类被偶然满足。

## 3. 下一步

1. 调经济参数（租金/衰减/探索/上限），观察概念是否稳定；
2. 增加更多世界变化/新属性，避免记忆过早饱和；
3. 加一个通用预测/问句任务，检验经验是否能答新问题；
4. 不在核心路径恢复任何 `near/aligned/circle/convex/hull` 函数。

## 4. 纪律

- 不写语义专用谓词/检测器/形状分支；
- 参数只设资源，不设语义权重；
- 概念名可以学，`isCircle()` 不可以写；
- 删代码/文档，不注释掉；
- 先读 `agents.md`，再改。
