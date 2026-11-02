# Pixel to Concept Reader v3 · 像素场景工作台

> v3 快照：把 2026-11 的 `pdftest8` 工作台核心代码、MNIST 素材、独立 HTML 打包脚本一起放在这个目录。
> 根目录仍是 v2；本目录不修改 v2 的 `src/`、报告或未提交工作。

## 直接打开

[`pixel-scene-workbench-v3.html`](pixel-scene-workbench-v3.html)

- 约 11.4 MB，单文件；
- JS、CSS、MNIST 9761 张数据全部内嵌；
- 不依赖 `public/`、网络、字体或图片，`file://` 双击即可打开。

## 这一版的内核

- `src/nars/sensor.ts`：原始读数 → 观察词项；默认黑白传感器。
- `src/nars/operations.ts`：`OperationSpec` / `OperationRegistry` / `OperationPlan`。
  - `access: 'read' | 'write'` 区分只读观察与可写操作；
  - `execute()` 自己决定是否移动、产生什么观察、如何记录；
  - 默认计划仍是 `shift`：`shiftX → shiftY`，事件仍是 `[shift dx dy]`。
- `src/nars/nars.ts`：`step()` 按计划执行，不再硬编码 shift / 黑 / 白；
  `registerOperation()` 接新算子，`setOperationPlan()` 换整个计划。
- `src/nars/concept.ts`：操作概念的空间采样（叶子深度、每叶上限、信念容量）可配置。
- `src/data/mnist.ts`：优先读取打包器注入的 MNIST；开发服务器仍走 `public/mnist`。

默认行为没有变：未设置新计划时，仍然执行 `shiftX → shiftY`，目标、Drive 熟练度、2D bag、cycle 日志和 2D/3D 轨迹都保留。

## 命令

需要 Node.js 22+。

```bash
npm ci
npm run dev              # 开发服务器
npm run typecheck
npm run test:operations  # 只读/可写/默认计划冒烟测试
npm run build            # 普通 Vite 构建
npm run pack:html        # 重新生成 dist/pdftest8-standalone.html
```

`pack:html` 会：

1. 用 Vite + `vite-plugin-singlefile` 内联 JS/CSS；
2. 把 `public/mnist/mnist.json` 和 `mnist.bin` 以 base64 注入 HTML；
3. 检查没有外部 `<script src>` / `<link href>`；
4. 输出 `dist/pdftest8-standalone.html`。

本目录里的 `pixel-scene-workbench-v3.html` 就是这次打包结果的一份拷贝。

## 目录

```text
v3/
  src/                         工作台与 NARS 内核
  public/mnist/                9761 张 28×28 MNIST
  tools/pack-html.ts           独立 HTML 打包脚本
  tools/check-operations.ts    操作层冒烟测试
  pixel-scene-workbench-v3.html
```

## 边界

- 这里放的是当前工作台的**核心代码和独立构建**，不是根目录 v2 项目的替代；
- 没有引入形状/语义专用检测器；
- 真正接彩色世界时，需要新的 `Sensor` 和喂图通道；操作注册表、计划、执行层不需要重写。
