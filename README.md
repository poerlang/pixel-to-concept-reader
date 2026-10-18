# 操作差与相对布局

### 一个基于 NAL 的手写数字识别实验

**莫克陶**

这个仓库收录一篇面向非专业读者的论文，包括中文版、英文版、PDF，以及论文中的三张图。

论文讨论一个具体问题：计算机能否把“为什么把这张图认成 9”写成一组可检查的关系，并用这些关系完成识别。

## 先读哪一篇

| 你想做什么 | 建议从这读 |
|---|---|
| 快速了解结论 | [中文 PDF](paper/pixel-to-concept.zh.pdf) |
| 在网页上读中文 | [中文 Markdown](paper/pixel-to-concept.zh.md) |
| 读英文 | [English PDF](paper/pixel-to-concept.en.pdf) · [English Markdown](paper/pixel-to-concept.en.md) |
| 只看图 | [图 1](figures/overview-zh.png) · [图 2](figures/classic-figures-vertical.png) · [图 3](figures/layout-invariance-vertical.png) |

## 论文做了什么

- 输入是 16×16 的手写数字图像；
- 系统先把亮点组织成一些可能是圆形的小块；
- 再记录小块之间的走法、转弯、重复、闭合和相对位置；
- 这些关系被写成 NAL 词项，和记忆中的数字比较；
- 识别阶段不使用 softmax、kNN、决策树或模板匹配。

在 200 张测试样本上，系统取得 **81.0%** 的正确率。论文也报告了数字 8 与 9 的混淆，以及当前的主要瓶颈。

## 这篇论文的边界

- 它是一个独立的工程实验，不主张新的 NAL 视觉理论；
- 81.0% 不是 MNIST 的最好结果，也不证明通用视觉；
- 结构词表由人工设计；
- 它不声称复制人脑，也不把“词项”等同于人类概念；
- 8 与 9 等样本仍会失败。

## 图

![图 1：只给答案，还是把关系说出来](figures/overview-zh.png)

图 1 用两条路径说明论文的出发点：一条只给答案，另一条把关系逐步说出来。

其余两张图：

- [图 2：经典图形作为结构词项的参照](figures/classic-figures-vertical.png)
- [图 3：相对布局在平移后保持不变](figures/layout-invariance-vertical.png)

## 文件结构

```text
paper/
  pixel-to-concept.zh.md      中文论文
  pixel-to-concept.zh.pdf     中文 PDF
  pixel-to-concept.en.md      English paper
  pixel-to-concept.en.pdf     English PDF
figures/
  overview-zh.png             中文导读图
  overview-en.png             English overview
  classic-figures-vertical.png
  layout-invariance-vertical.png
```

所有图都提供 SVG 源文件，方便打印或二次排版。

## 引用

如果你在写作中引用这篇论文，可以写：

> 莫克陶. 操作差与相对布局：一个基于 NAL 的结构词项识别实验. 2026.

## English

This repository contains a reader-friendly paper on handwritten digit recognition with Non-Axiomatic Logic (NAL).

The system groups bright pixels into rough circular patches, records steps, turns, repetition, closure, and relative positions, and compares these relations with remembered digits. Recognition uses NAL comparison, revision, and questioning, with no standard classifier.

The prototype reaches 81.0% on 200 test images. The paper also reports confusions between 8 and 9 and the current limits of the approach.

Start with the [English PDF](paper/pixel-to-concept.en.pdf) or the [English Markdown](paper/pixel-to-concept.en.md).

## 版本

- v1.0.0：第一次公开的读者版（GitHub Release）。
