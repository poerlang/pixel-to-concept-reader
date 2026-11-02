# 视觉经验：问句脉冲 → 粗点 → Shift → 二阶差

> 目标：让系统不背局部像素块，也不一次处理整幅画；
> 只用 NAL 问句向四邻接逐步散播，满足/不满足沿链回报，形成局部粗点，再用 Shift 的相对位置差和二阶差表达直/弯。

## 1. 图形只是数据

`tools/visual-fixtures.ts` 负责画 16×16 图：

- 纯黑/纯白背景；
- 不同半径的圆点；
- 不同粗细的圆、粗中空圆；
- 横/竖/斜线，不同粗细；
- 角、S、半圆、折线；
- 由两个基础图形组合的复杂图（只用于检验，不参与训练）。

这些名字只用于报告，**不进入 NAL 词项**。

## 2. 问句脉冲 → 粗点

`src/visual/ask.ts`：

1. 从当前兴趣种子发出问句：

   ```text
   ? 这里是不是目标色
   ```

2. 问句沿四邻接一次散播一格，不预先扫描整幅画；
3. 目标强度决定能量衰减：满足点的能量衰减慢，不满足点衰减快；
4. 满足点和不满足点都记录路径，最终沿原链回报给发问者；
5. 与发问者直连的不满足点（depth ≤ 1）不算锚点；
6. 从询问点到不满足点的路径中间如果没有经过满足点，这个不满足点也不算合法锚点；
7. 用满足点的局部协方差求笔画切向，取它的法向作为横截面方向；
8. 沿法向两侧各取最近的合法不满足点，作为两侧边界；
9. 两侧边界点直接作为直径端点；询问点只作夹持验证，不参与偏心圆心的计算；
10. 两侧边界中点就是圆心，半径是两侧距离的一半；
11. 圆内的满足点聚成一个粗点，记录 `mass`、框定点和回报链；
12. 下一次发问从当前粗点周围的未覆盖满足点里选，优先距离近、并且延续上一步方向的点；
13. 只有当前邻域没有候选时，才回退到未访问区域的有界扫描，不再按行主序横向扫完整幅。

一次 `askShift()` 只允许有界的问句步数；4K 画面也只处理局部窗口，不会一次遍历整个画布。
纯黑/纯白没有满足点，最终是一个没有方向的中性粗点，报告标为 neutral。

## 3. Shift：位置差与二阶差

### 3.1 episode 分段

- 粗点顺序来自问句兴趣顺序：从当前粗点周围出发，近处优先，并延续上一步方向；
- 最终连线再做一次空间邻近 + 方向连续性排序，不按行主序连线；
- 距离突变或方向关系断裂时，当前 episode 结束；
- 跳跃本身不写入 `shift_accel`；
- 剩余粗点从新 episode 开始；
- 不额外造“组”对象；每个 episode 的观察直接进入同一个 Buffer，
  Buffer 里被激活的概念就是零件。

## 3.2 相对量

粗点序列不再保存绝对 dx/dy 小数，而是保存相对类别：

```text
shift_vec_<dir>_<len>
shift_accel_<dir>_<len>
shift_closure_<0|1|2>
shift_point_<0|1|2>
shift_span_<ratio>
shift_area_<ratio>
```

其中：

```text
dir      8 个相对方位
len      相对本 episode 中位步长的长度档
closure  首尾距离 / 路径长度：闭合 / 半开 / 开放
span     粗点包围盒 / 感受野边长
area     粗点质量总和 / 感受野面积
```

`shift_accel` 仍由相邻 Shift 矢量差来：

```text
d_i      = p_{i+1} - p_i
accel_i  = d_{i+1} - d_i
```

但没有独立转向词项，也没有绝对坐标。

## 4. 训练与 AND 语义

`src/visual/learn.ts`：

- 每个简单图形用 `ex_i` 作为实例名；
- 观察是 `ex_i → shift_vec_* / shift_accel_* / shift_closure_* / shift_span_* / shift_area_*`；
- 方向/长度/二阶差/闭合构成 AND 条件；
  - 全部满足 → 正常激活（FULL）；
  - 只满足一部分 → 极低激活（PARTIAL），保留但不按完整候选处理；
  - 完全不满足 → 不进入 Buffer；
- `span` / `area` 与**子表征覆盖数**一起构成 FULL 的激活权重，不放进 AND 条件：
  采样一偏，面积/跨度档就会变，若作为硬条件会让整类失效；
- 激活目标：
  ```text
  FULL:
    target = min(0.98, 0.3 + 0.5 × area + 0.02 × featureCount)

  PARTIAL:
    target = 0.02 + 0.03 × coverage

  priority = 0.65 × old + 0.35 × target
  ```
- 同一图形反复看会复用同一个 `ex_i`；
- 概念名只在旁路 `memory/visual.map.json`，用于报告，不进 NAL；
- `memory/visual.bin` 是二进制记忆，启动先加载。

这对应格式塔的“整体不等于部分之和”：半圆和粗圆即使共享部分弧段，
只要粗圆的闭合/长度子项没有全部满足，就不会被当成粗圆。

面积/跨度权重让大的完整图形比局部线片段有更高激活度；
子表征覆盖数让 S/半圆这种完整曲线比单根线片段更高，
避免“2号角被判成1号竖线”和“S 被判成斜线”。

## 5. 判断直/弯

`VisualExperience.judge(grid)`：

- 跑一次**有界**问句脉冲 + Shift；
- 统计每个 episode 内相邻相对矢量的差（加速度）；
- `maxAbsAccel < 0.6` 判为 straight，否则 curved。

不使用转向词项、top-k、候选列表、像素块匹配或类别标签。

## 6. 当前结果

当前二进制约 399 KB，概念/信念约 2384。

| 图形 | maxAccel | accel profile | 判断 |
|---|---:|---|---|
| 1号横线 | 0.500 | zero:3 small:1 | straight |
| 1号竖线 | 0.500 | zero:3 small:1 | straight |
| 1号细圆 | 1.000 | small:1 large:1 | curved |
| 1号角 | 0.500 | zero:1 small:3 | straight |
| 1号S | 2.550 | small:1 large:2 | curved |
| 1号半圆 | 1.421 | large:1 | curved |
| 4号粗线 | 0.000 | zero:4 | straight |
| 3号粗圆 | 1.118 | large:1 | curved |

激活排序例子（`2号角`）：

```text
2号角    0.430
2号横线  0.389
2号竖线  0.389
1号角    0.366
```

S / 半圆：

```text
1号S      0.386 > 2号斜线 0.353
1号半圆   0.364 > 线类约 0.33
```

`4号粗圆` / `1号折线`：

```text
4号粗圆  0.393  (next: 线类约 0.035)
1号折线  0.384  (next: 线类约 0.035)
```

已知限制：

- 问句脉冲的种子/兴趣优先级仍是通用资源规则，不是完整欲望模型；
- 4K 下仍需按预算分多次 `run()`，但单次不会遍历整幅画；
- 相对分档仍然依赖采样；分档边界附近可能把不同步长混在一起；
- AND 只保证条件都满足，不排除“特征很少的概念”被偶然满足；
- 复合图仍可能只沿其中一条长线走，漏掉另一部分；
- 加速度阈值是资源/测量参数，不是形状先验。

## 7. 命令

```bash
npm run typecheck
npm run visual
npm run report        # 加载经验，生成所有图像的切换报告
npm run report:standalone # 校验自包含并复制到 test_report_v2.html
npm run report:v3 # 合并三个只读页面 → test_report_v3.html
npm run trace:player # 逐帧展示一次 Shift 的差值与计算 → trace_player.html
npm run coarse:player # 粗点演算动画 → coarse_player.html
```

`tools/report.ts` 只读 `memory/visual.bin`，为所有图像分别做 Buffer 激活，
导出可点击切换的 `test_report.html`；每张图包含激活概念、Buffer 排序和显著 `shift_vec` / `shift_accel` 子表征。
报告里的英文标签（`SHIFT VEC`、`SHIFT ACCEL`、`SHIFT CLOSURE`、`AREA`、`SPAN`、`FULL`、`PARTIAL` 等）
支持鼠标悬停或点击弹出解释。

`buffer timeline` 中第 4 个循环略宽；悬停任意一行时，图像上会用红色格子标出该行概念的证据落点
（由 `tools/report-evidence.ts` 把词项映射回 Shift 目标点，只读，不参与推理）。

文件：

- `src/visual/ask.ts`：问句脉冲、四邻接散播、回报链、4 锚点圆、粗点；
- `src/visual/shift.ts`：Shift 相对矢量、二阶差、相对观察；
- `src/visual/learn.ts`：NAL 经验、二进制、直/弯判断；
- `src/visual/types.ts`：通用图形类型；
- `tools/report.ts`：观察报告生成器；
- `tools/report-evidence.ts`：只读的词项 → Shift 落点证据映射；
- `test_report.html`：生成的报告；
- `test_report_v2.html`：校验后的独立导出；
- `test_report_v3.html`：报告 + 粗点演算 + 逐帧的单文件合并版；
- `trace_player.html`：逐帧 Shift 播放器；
- `coarse_player.html`：粗点演算动画（ask / wave / anchors / coarse）；
- `tools/visual-fixtures.ts`：图形数据；
- `tools/visual.ts`：训练 + 直/弯检验入口。

## 8. 下一步

1. 把蔓延阶段接回 NAL 问句传播；
2. 在复图上分段 Shift，不漏掉另一部分；
3. 用更高阶位置差表达曲率变化；
4. 保持：不回到局部像素块，不引入 top-k、转向词项 或形状专用检测器。
