// 记忆的二进制存取与通用质量分。
//
// 质量分不看得分/标签，只看记忆的“经验量”：
// 概念数、相似经验、∩ 复合、信念数。分数只用于决定是否覆盖旧快照。

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { decodeMemory, encodeMemory, binaryInfo, type BinaryInfo } from "../nars/binary.ts";
import type { Memory } from "../nars/memory.ts";
import type { Sentence } from "../nars/sentence.ts";
import { expectation } from "../nars/truth.ts";

const hasIntersection = (sentence: Sentence): boolean => {
  const walk = (term: Sentence["term"]): boolean =>
    term.copula === "∩" || (term.comps ?? []).some((part) => walk(part));
  return walk(sentence.term);
};

export function memoryScore(memory: Memory): number {
  const beliefs = memory.beliefs();
  const concepts = new Set(beliefs.map((sentence) => sentence.term.key)).size;
  const similar = beliefs.filter((sentence) => sentence.term.copula === "↔").length;
  const compounds = beliefs.filter(hasIntersection).length;
  const confidence = beliefs.reduce((sum, sentence) => sum + expectation(sentence.truth), 0)
    / Math.max(1, beliefs.length);
  return concepts + 2 * similar + 3 * compounds + 0.5 * beliefs.length + confidence;
}

export function loadMemory(path: string): Memory | null {
  if (!existsSync(path)) return null;
  try {
    const bytes = readFileSync(path);
    return decodeMemory(new Uint8Array(bytes));
  } catch (error) {
    console.warn(`跳过损坏的记忆快照 ${path}: ${String(error)}`);
    return null;
  }
}

export function saveMemory(memory: Memory, path: string): BinaryInfo {
  mkdirSync(dirname(path), { recursive: true });
  const bytes = encodeMemory(memory);
  writeFileSync(path, bytes);
  return binaryInfo(bytes);
}
