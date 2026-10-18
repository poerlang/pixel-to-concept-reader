// 记忆的二进制快照：给训练结果留一个不依赖 JSON 的落盘格式（v1）
//
// 布局（小端）：
//   "NARS6BIN" | version u16 | flags u16 | terms u32 | concepts u32 | beliefs u32
//   term*:  key str | flags u8（bit0 atom, bit1 variable） | [copula str | comps u16 × u32]
//   concept*: term u32 | priority f32 | beliefCount u16
//             belief*: f f32 | c f32 | priority f32 | baseCount u16 × u32
//   checksum u32（FNV-1a，覆盖此前全部字节）

import { Memory } from "./memory.ts";
import { judgment } from "./sentence.ts";
import { atom, compound, variable, type Term } from "./term.ts";

const MAGIC = "NARS6BIN";
const VERSION = 1;

type RawTerm = { a: number; v: number; c?: string; s?: string[] };
type RawConcept = { t: string; p: number; b: Array<[number, number, number, number[]]> };
type RawMemory = { terms: Array<[string, RawTerm]>; concepts: RawConcept[] };

export type BinaryInfo = { version: number; terms: number; concepts: number; beliefs: number; bytes: number };

const fnv = (bytes: Uint8Array, end = bytes.length): number => {
  let hash = 2166136261;
  for (let i = 0; i < end; i++) {
    hash ^= bytes[i]!;
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
};

class Writer {
  private readonly bytes: number[] = [];
  private readonly scratch = new DataView(new ArrayBuffer(4));

  u8(value: number): void {
    this.bytes.push(value & 0xff);
  }
  u16(value: number): void {
    this.bytes.push(value & 0xff, (value >>> 8) & 0xff);
  }
  u32(value: number): void {
    this.u16(value & 0xffff);
    this.u16((value >>> 16) & 0xffff);
  }
  f32(value: number): void {
    this.scratch.setFloat32(0, value, true);
    for (let i = 0; i < 4; i++) this.bytes.push(this.scratch.getUint8(i));
  }
  str(value: string): void {
    const encoded = new TextEncoder().encode(value);
    this.u16(encoded.length);
    for (const byte of encoded) this.bytes.push(byte);
  }
  finish(): Uint8Array {
    const body = Uint8Array.from(this.bytes);
    const out = new Uint8Array(body.length + 4);
    out.set(body, 0);
    new DataView(out.buffer).setUint32(body.length, fnv(body), true);
    return out;
  }
}

class Reader {
  private readonly bytes: Uint8Array;
  private readonly view: DataView;
  private offset = 0;

  constructor(bytes: Uint8Array) {
    this.bytes = bytes;
    this.view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  }
  u8(): number {
    return this.view.getUint8(this.offset++);
  }
  u16(): number {
    const value = this.view.getUint16(this.offset, true);
    this.offset += 2;
    return value;
  }
  u32(): number {
    const value = this.view.getUint32(this.offset, true);
    this.offset += 4;
    return value;
  }
  f32(): number {
    const value = this.view.getFloat32(this.offset, true);
    this.offset += 4;
    return value;
  }
  str(): string {
    const length = this.u16();
    const slice = this.bytes.subarray(this.offset, this.offset + length);
    this.offset += length;
    return new TextDecoder().decode(slice);
  }
  get position(): number {
    return this.offset;
  }
}

/** 词项按"成分在前"排序，解码时可以顺序重建。 */
function orderedTerms(raw: RawMemory): Array<[string, RawTerm]> {
  const table = new Map(raw.terms);
  const order: Array<[string, RawTerm]> = [];
  const seen = new Set<string>();
  const visit = (key: string): void => {
    if (seen.has(key)) return;
    const term = table.get(key);
    if (!term) throw new Error(`二进制快照缺词项 ${key}`);
    for (const comp of term.s ?? []) visit(comp);
    seen.add(key);
    order.push([key, term]);
  };
  for (const [key] of raw.terms) visit(key);
  return order;
}

export function encodeMemory(memory: Memory): Uint8Array {
  const raw = memory.toJSON() as RawMemory;
  const terms = orderedTerms(raw);
  const index = new Map(terms.map(([key], position) => [key, position]));
  const beliefs = raw.concepts.reduce((sum, concept) => sum + concept.b.length, 0);

  const writer = new Writer();
  for (const char of MAGIC) writer.u8(char.charCodeAt(0));
  writer.u16(VERSION);
  writer.u16(0);
  writer.u32(terms.length);
  writer.u32(raw.concepts.length);
  writer.u32(beliefs);

  for (const [key, term] of terms) {
    writer.str(key);
    writer.u8((term.a ? 1 : 0) | (term.v ? 2 : 0));
    if (!term.a) {
      writer.str(term.c ?? "");
      const comps = term.s ?? [];
      writer.u16(comps.length);
      for (const comp of comps) {
        const position = index.get(comp);
        if (position === undefined) throw new Error(`二进制快照缺成分 ${comp}`);
        writer.u32(position);
      }
    }
  }

  for (const concept of raw.concepts) {
    const position = index.get(concept.t);
    if (position === undefined) throw new Error(`二进制快照缺概念词项 ${concept.t}`);
    writer.u32(position);
    writer.f32(concept.p);
    writer.u16(concept.b.length);
    for (const [f, c, priority, base] of concept.b) {
      writer.f32(f);
      writer.f32(c);
      writer.f32(priority);
      writer.u16(base.length);
      for (const id of base) writer.u32(id);
    }
  }
  return writer.finish();
}

export function binaryInfo(bytes: Uint8Array): BinaryInfo {
  if (bytes.length < 28) throw new Error("二进制快照太短");
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const magic = new TextDecoder().decode(bytes.subarray(0, 8));
  if (magic !== MAGIC) throw new Error(`不是 pdftest6 的记忆快照：${magic}`);
  const version = view.getUint16(8, true);
  if (version !== VERSION) throw new Error(`不支持的快照版本 ${version}`);
  return {
    version,
    terms: view.getUint32(12, true),
    concepts: view.getUint32(16, true),
    beliefs: view.getUint32(20, true),
    bytes: bytes.length,
  };
}

export function decodeMemory(bytes: Uint8Array): Memory {
  if (bytes.length < 28) throw new Error("二进制快照太短");
  const magic = new TextDecoder().decode(bytes.subarray(0, 8));
  if (magic !== MAGIC) throw new Error(`不是 pdftest6 的记忆快照：${magic}`);
  const checksum = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(bytes.length - 4, true);
  if (fnv(bytes, bytes.length - 4) !== checksum) throw new Error("二进制快照校验和不对");

  const reader = new Reader(bytes.subarray(8, bytes.length - 4));
  const version = reader.u16();
  if (version !== VERSION) throw new Error(`不支持的快照版本 ${version}`);
  reader.u16();
  const termCount = reader.u32();
  const conceptCount = reader.u32();
  const beliefCount = reader.u32();

  const terms: Term[] = [];
  for (let i = 0; i < termCount; i++) {
    const key = reader.str();
    const flags = reader.u8();
    if (flags & 1) terms.push(flags & 2 ? variable(key) : atom(key));
    else {
      const copula = reader.str();
      const count = reader.u16();
      const comps: Term[] = [];
      for (let j = 0; j < count; j++) {
        const position = reader.u32();
        const comp = terms[position];
        if (!comp) throw new Error(`二进制快照成分越界 ${position}`);
        comps.push(comp);
      }
      terms.push(compound(copula, comps, copula === "↔"));
    }
  }

  const memory = new Memory();
  let loadedBeliefs = 0;
  for (let i = 0; i < conceptCount; i++) {
    const position = reader.u32();
    const term = terms[position];
    if (!term) throw new Error(`二进制快照概念越界 ${position}`);
    const concept = memory.concept(term)!;
    concept.priority = reader.f32();
    const count = reader.u16();
    for (let j = 0; j < count; j++) {
      const f = reader.f32();
      const c = reader.f32();
      const priority = reader.f32();
      const baseCount = reader.u16();
      const base: number[] = [];
      for (let k = 0; k < baseCount; k++) base.push(reader.u32());
      concept.beliefs.put(judgment(term, { f, c }, base, priority));
      loadedBeliefs++;
    }
  }
  if (loadedBeliefs !== beliefCount) throw new Error(`二进制快照信念数不符：${loadedBeliefs} ≠ ${beliefCount}`);
  if (reader.position !== bytes.length - 12) throw new Error("二进制快照有未读字节");
  return memory;
}
