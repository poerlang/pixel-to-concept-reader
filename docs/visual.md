# 视觉经验：蔓延粗点 → Shift → 二阶差

> 目标：让系统不背局部像素块，而是先用蔓延求同形成粗点，
> 再用 Shift 的相对位置差和二阶差表达直/弯。

## 1. 图形只是数据

`tools/visual-fixtures.ts` 负责画 16×16 图：

- 纯黑/纯白背景；
- 不同半径的圆点；
- 不同粗细的圆、粗中空圆；
- 横/竖/斜线，不同粗细；
- 角、S、半圆、折线；
- 由两个基础图形组合的复杂图（只用于检验，不参与训练）。

这些名字只用于报告，**不进入 NAL 词项**。

## 2. 蔓延求同 → 粗点

`src/visual/shift.ts`：

1. 在局部半径内把活动像素聚成一个**粗点质心**；
2. 粗点有活动量 `mass`，但不保存局部像素块；
3. Shift 只在粗点之间跳；
4. 粗线的 3 像素厚度先被压成粗点序列，不会逐行换行；
5. 场点来自局部差异：只有相邻值不同的地方才会有边界场点。
   纯黑/纯白没有局部差异，整幅场塌缩成**一个粗点**：它没有方向，但不是空。
   90% 白 + 10% 黑也只有交界处产生场点，不会把整个白面当成形状。
   报告把这种无方向状态标为 neutral。

## 3. Shift：位置差与二阶差

### 3.1 episode 分段

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
- 方向/长度/二阶差/闭合构成 AND 条件；只满足一部分不激活；
- `span` / `area` 与**子表征覆盖数**一起构成激活权重，不放进 AND 条件：
  采样一偏，面积/跨度档就会变，若作为硬条件会让整类失效；
- 激活目标：
  ```text
  target = min(0.95, 0.4 + 2.5 × area + 0.02 × featureCount)
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

- 跑一次蔓延 + Shift；
- 统计每个 episode 内相邻相对矢量的差（加速度）；
- `maxAbsAccel < 0.6` 判为 straight，否则 curved。

不使用转向词项、top-k、候选列表、像素块匹配或类别标签。

## 6. 当前结果

当前二进制约 451 KB，概念/信念约 2897。

| 图形 | maxAccel | accel profile | 判断 |
|---|---:|---|---|
| 1号横线 | 0.000 | zero:4 | straight |
| 1号竖线 | 0.000 | zero:4 | straight |
| 1号细圆 | 2.007 | zero:1 small:4 large:7 | curved |
| 1号角 | 2.593 | zero:4 small:2 large:1 | curved |
| 1号S | 2.550 | zero:1 large:3 | curved |
| 1号半圆 | 1.572 | small:1 large:1 | curved |
| 3号粗线 | 0.500 | zero:4 small:1 | straight |
| 3号粗圆 | 8.003 | small:3 large:25 | curved |

激活排序例子（`2号角`）：

```text
2号角    0.766  area 0.152  features 8
1号角    0.558  area 0.074  features 5
1号竖线  0.470  area 0.047  features 3
1号斜线  0.462  area 0.043  features 3
```

S / 半圆的修正：

```text
1号S      0.519 > 1号斜线 0.462
1号半圆   0.544 > 1号折线 0.495 > 线类 0.470
```

面积/跨度 + 子表征覆盖让完整曲线排到前面，而不是被局部线片段压住。

已知限制：

- 相对分档仍然依赖采样；分档边界附近可能把不同步长混在一起；
- AND 只保证条件都满足，不排除“特征很少的概念”被偶然满足；
- 复合图仍可能只沿其中一条长线走，漏掉另一部分；
- 加速度阈值是资源/测量参数，不是形状先验；
- 蔓延阶段目前是通用局部粗点聚合，还不是完整的 NAL 问句传播。

## 7. 命令

```bash
npm run typecheck
npm run visual
npm run report        # 加载经验，生成所有图像的切换报告
npm run report:standalone # 校验自包含并复制到 report/index.html
```

`tools/report.ts` 只读 `memory/visual.bin`，为所有图像分别做 Buffer 激活，
导出可点击切换的 `test_report.html`；每张图包含激活概念、Buffer 排序和显著 `shift_vec` / `shift_accel` 子表征。

文件：

- `src/visual/shift.ts`：蔓延粗点、Shift、相对矢量、二阶差；
- `src/visual/learn.ts`：NAL 经验、二进制、直/弯判断；
- `src/visual/types.ts`：通用图形类型；
- `tools/report.ts`：观察报告生成器；
- `test_report.html`：生成的报告；
- `tools/visual-fixtures.ts`：图形数据；
- `tools/visual.ts`：训练 + 直/弯检验入口。

## 8. 下一步

1. 把蔓延阶段接回 NAL 问句传播；
2. 在复图上分段 Shift，不漏掉另一部分；
3. 用更高阶位置差表达曲率变化；
4. 保持：不回到局部像素块，不引入 top-k、转向词项 或形状专用检测器。
