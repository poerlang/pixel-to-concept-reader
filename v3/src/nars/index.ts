/**
 * nars 出口。
 *
 * 类层级按 NARS-2025 第 6 章 + NAL-3：
 *   Term → Atom / Compound
 *          Compound → Statement / OperationTerm / SequenceTerm（扫描顺序对）
 *                   / SetExt / SetInt / IntersectionExt / IntersectionInt
 *                   / DifferenceExt / DifferenceInt
 *   Sentence → Judgment / Goal / Question
 *   Concept（term + 三张句子表 + 两条链）
 *   OperationConcept → MentalOperationConcept（NAL-9）
 *   Memory（概念袋）
 *
 * 占位：信念层（tell / beliefList / confidenceOf / size / clear）。
 */

export { Bag, type BagItem } from './bag.ts'
export { Board, BOARD_SIDE } from './board.ts'
export { Attention } from './attention.ts'
export {
  Term,
  Atom,
  Compound,
  Statement,
  OperationTerm,
  SequenceTerm,
  SetExt,
  SetInt,
  IntersectionExt,
  IntersectionInt,
  DifferenceExt,
  DifferenceInt,
  isAtom,
  isCompound,
  isOperationTerm,
  isSet,
  termKind,
  termDepth,
  componentsOf,
  type TermKind,
} from './term.ts'
export {
  Sentence,
  Judgment,
  Goal,
  Question,
  sentenceKey,
  truthOf,
} from './sentence.ts'
export { TruthValue, EvidentialBase, BudgetValue } from './value.ts'
export {
  Concept,
  OperationConcept,
  CompoundOperationConcept,
  MentalOperationConcept,
  Task,
  TaskLink,
  TermLink,
  type ConceptKind,
  type OperationSampling,
} from './concept.ts'
export {
  Memory,
  type MemoryView,
  type ConceptView,
  type SentenceView,
  type SentenceInstance,
  type SpatialMemoryEntry,
} from './memory.ts'
export { SpatialBag, type SpatialEntry } from './spatial.ts'
export { Vocabulary } from './vocabulary.ts'
export { BinaryColorSensor, binaryColorSensor, termFromLabel } from './sensor.ts'
export {
  createDefaultOperationRegistry,
  defaultOperationRegistry,
  OperationRegistry,
  availableOperations,
  executeOperation,
  isExecutable,
  operationAxis,
  type OperationAccess,
  type OperationContext,
  type OperationOptions,
  type OperationOutcome,
  type OperationPlan,
  type OperationSpec,
  type OperationTarget,
} from './operations.ts'
export {
  tell,
  ask,
  inferOnce,
  cycleOnce,
  runCycles,
  cycleEntries,
  scanTrail,
  operationTrace,
  shiftTrace,
  step,
  clear,
  size,
  subscribe,
  beliefList,
  confidenceOf,
  formatTerm,
  setBoardImage,
  resetBuffer,
  clearMemory,
  setGoal,
  readableTerms,
  registerOperation,
  setOperationPlan,
  operationSpecs,
  operationPlan,
  attentionParams,
  setAttentionParams,
  goalInfo,
  driveInfo,
  conceptEntries,
  sentenceEntries,
  boardSnapshot,
  memorySnapshot,
  memoryConceptCount,
  spatialNeighbors,
  mentalOperation,
  consider,
  MENTAL_OPERATORS,
  type Belief,
  type StepRecord,
  type ConceptEntry,
  type SentenceEntry,
  type GoalInfo,
  type DriveInfo,
  type InferenceRecord,
  type BoardSnapshot,
  type AttentionSettings,
} from './nars.ts'
export {
  runCycle,
  reverseQuestions,
  questionSolved,
  type CycleResult,
} from './cycle.ts'
export {
  InferenceEngine,
  derivePair,
  inferClosure,
  type Derivation,
  type RuleName,
} from './inference.ts'
export {
  ARITHMETIC_OPERATORS,
  arithmeticAggregate,
  arithmeticOperation,
  evaluateArithmetic,
  isArithmeticOperation,
  numberOf,
  numberTerm,
  type ArithmeticOperator,
} from './arithmetic.ts'
