export interface ProvenanceRecord {
  source: string;
  observedAt: string;
  evidence: string[];
  actor?: string | null;
}

export type DeepReadonly<T> = T extends (...args: never[]) => unknown
  ? T
  : T extends readonly (infer U)[]
    ? ReadonlyArray<DeepReadonly<U>>
    : T extends object
      ? { readonly [K in keyof T]: DeepReadonly<T[K]> }
      : T;

export type HippocampusBoundaryDirection = "input" | "output";

export interface HippocampusSecretRedactionPolicyInput {
  policyId?: string;
  redactionPlaceholder?: string;
  detectorIds?: string[];
  excludedFieldNames?: string[];
}

export interface HippocampusSecretRedactionPolicy {
  policyId: string;
  version: "1.0.0";
  directions: HippocampusBoundaryDirection[];
  redactionPlaceholder: string;
  detectorIds: string[];
  excludedFieldNames: string[];
  secretFieldNamePattern: string;
}

export interface HippocampusBoundarySecretFinding {
  detectorId: string;
  direction: HippocampusBoundaryDirection;
  path: string;
  fingerprint: string;
  matchCount: 1;
  originalLength: number;
  replacementLength: number;
  action: "redacted" | "blocked";
}

export interface HippocampusBoundarySanitizationOptions {
  direction?: HippocampusBoundaryDirection;
  policy?:
    | HippocampusSecretRedactionPolicyInput
    | HippocampusSecretRedactionPolicy
    | null;
}

export interface HippocampusBoundarySanitizationResult<T = unknown> {
  policyId: string;
  policyVersion: "1.0.0";
  direction: HippocampusBoundaryDirection;
  sanitizedAt: string;
  detected: boolean;
  hasUnredactableSecrets: boolean;
  findingCount: number;
  redactedPathCount: number;
  unredactableFindingCount: number;
  redactedPaths: string[];
  unredactablePaths: string[];
  findings: ReadonlyArray<HippocampusBoundarySecretFinding>;
  sanitizedPayload: DeepReadonly<T>;
}

export interface MemoryItemIdentitySchema {
  version: "1.0.0";
  stableIdField: "memoryId";
  mutable: false;
  regeneration: "forbidden";
  reassignment: "forbidden";
  description: string;
  rules: ReadonlyArray<string>;
}

export type ConsolidationPipelineAbortReason = "canonical-id-mutation";

export type ConsolidationPipelineAbortStage =
  | "planning"
  | "deduplication"
  | "rewrite"
  | "serialization"
  | "merge"
  | "persistence";

export interface ConsolidationPipelineAbort {
  version: "1.0.0";
  invariantId: "agent-scoped-canonical-id-preservation";
  reason: ConsolidationPipelineAbortReason;
  stage: ConsolidationPipelineAbortStage;
  safe: true;
  safeAction: "abort-offline-pipeline-before-write";
  identityScope: "agent-scoped";
  canonicalField: "agentId" | "memoryId" | "nodeId";
  attemptedField: string;
  sourceMemoryId: string | null;
  agentId: string | null;
  expectedValue: string;
  actualValue: string;
  message: string;
}

export class ConsolidationPipelineAbortError extends Error {
  readonly name: "ConsolidationPipelineAbortError";
  readonly code: ConsolidationPipelineAbortReason;
  readonly abort: Readonly<ConsolidationPipelineAbort>;
  constructor(abort: ConsolidationPipelineAbort);
}

export type MemoryGraphReconstructionDeferredReason = "idle-budget-exceeded";

export type GraphStateReconstructionGeneration = "young" | "old";

export type GraphStateDeltaStatus =
  | "unchanged"
  | "added"
  | "removed"
  | "modified";

export type GraphStateReconstructionMemoryKind =
  | "working_memory"
  | "short_term_memory"
  | "long_term_memory"
  | "archived_memory";

export interface GraphStateReconstructionMemoryDescriptor {
  memoryId: string;
  memoryKind: GraphStateReconstructionMemoryKind;
  fingerprint: string;
}

export interface GraphStateReconstructionMetadata {
  schemaId: "agent_brain_graph_state_reconstruction_metadata";
  schemaVersion: "1.0.0";
  generation: GraphStateReconstructionGeneration;
  memories: ReadonlyArray<Readonly<GraphStateReconstructionMemoryDescriptor>>;
}

export interface GraphStateDeltaSummary {
  persistedMemoryCount: number;
  currentMemoryCount: number;
  totalComparedCount: number;
  unchangedCount: number;
  addedCount: number;
  removedCount: number;
  modifiedCount: number;
  changedCount: number;
}

export interface GraphStateDeltaMemoryClassification {
  referenceKey: string;
  memoryId: string;
  memoryKind: GraphStateReconstructionMemoryKind;
  status: GraphStateDeltaStatus;
  previousFingerprint: string | null;
  currentFingerprint: string | null;
}

export interface GraphStateDelta {
  generation: GraphStateReconstructionGeneration;
  summary: Readonly<GraphStateDeltaSummary>;
  memories: ReadonlyArray<Readonly<GraphStateDeltaMemoryClassification>>;
}

export interface MemoryGraphReconstructionTargetMemorySet {
  agentId: string;
  replacementScopes: ReadonlyArray<string>;
  workingMemoryCount: number;
  shortTermMemoryCount: number;
  importanceIndexCount: number;
  longTermMemoryCount: number;
  archivedMemoryCount: number;
  memoryEvidenceCount: number;
  consolidationJournalCount: number;
  edgeCount: number;
  totalYoungMemoryCount: number;
  totalDurableMemoryCount: number;
  totalMemoryCount: number;
  totalRecordCount: number;
}

export interface MemoryGraphReconstructionPhaseMeasurement {
  phase:
    | "resolve-target-memory-set"
    | "materialize-graph"
    | "validate-young-generation"
    | "validate-old-generation"
    | "freeze-graph";
  elapsedMs: number;
  totalElapsedMs: number;
  idleBudgetMs: number | null;
  budgetRemainingMs: number | null;
  exceededIdleBudget: boolean;
}

export interface MemoryGraphReconstructionMetrics {
  idleTriggerWindowMs: number | null;
  reconstructionDurationMs: number;
}

export interface MemoryGraphReconstructionProfile {
  status: "completed" | "deferred";
  agentId: string;
  reconstructionBudget: IdleWindowReconstructionBudget | null;
  targetMemorySet: Readonly<MemoryGraphReconstructionTargetMemorySet> | null;
  graphStateDelta: Readonly<GraphStateDelta> | null;
  phaseMeasurements: ReadonlyArray<
    Readonly<MemoryGraphReconstructionPhaseMeasurement>
  >;
  metrics: Readonly<MemoryGraphReconstructionMetrics>;
  elapsedMs: number;
  withinIdleBudget: boolean | null;
  deferredPhase: MemoryGraphReconstructionPhaseMeasurement["phase"] | null;
}

export interface MemoryGraphReconstructionDeferred {
  status: "deferred";
  reason: MemoryGraphReconstructionDeferredReason;
  phase: MemoryGraphReconstructionPhaseMeasurement["phase"];
  idleBudgetMs: number | null;
  elapsedMs: number;
  overBudgetMs: number;
  targetMemorySet: Readonly<MemoryGraphReconstructionTargetMemorySet> | null;
  metrics: Readonly<MemoryGraphReconstructionMetrics>;
  profile: Readonly<MemoryGraphReconstructionProfile>;
  message: string;
}

export class MemoryGraphReconstructionDeferredError extends Error {
  readonly name: "MemoryGraphReconstructionDeferredError";
  readonly code: MemoryGraphReconstructionDeferredReason;
  readonly deferred: Readonly<MemoryGraphReconstructionDeferred>;
  constructor(deferred: MemoryGraphReconstructionDeferred);
}

export interface MemoryItemRecordInput extends Record<string, unknown> {
  memoryId: string;
}

export interface MemoryItemRecord extends Record<string, unknown> {
  readonly memoryId: string;
}

export interface LearnedTraitMemory {
  label: string;
  confidence: number;
  provenance: Record<string, unknown>;
  protectedFromIdentityPromotion: true;
}

export type LongTermMemoryCategory =
  | "semantic"
  | "episodic"
  | "procedural"
  | "learned_trait"
  | "observation";

export type MemoryEvidenceKind =
  | "conversation_excerpt"
  | "tool_output"
  | "document_excerpt"
  | "runtime_trace"
  | "human_feedback";

export type ConsolidationOperation =
  | "promote"
  | "reinforce"
  | "supersede"
  | "preserve";

export type OldGenerationConsolidationStateStatus =
  | "runtime_seeded"
  | "promoted"
  | "reinforced"
  | "preserved"
  | "superseded";

export type ArchivedMemorySourceGeneration =
  | "young_generation"
  | "old_generation";

export type ArchivedMemorySourceMemoryKind =
  | "working_memory"
  | "short_term_memory"
  | "long_term_memory";

export interface OldGenerationTemporalContextInput {
  firstObservedAt?: string | null;
  lastObservedAt?: string | null;
  stabilizedAt?: string | null;
  consolidatedAt?: string | null;
  lastAccessedAt?: string | null;
  supersededAt?: string | null;
}

export interface OldGenerationTemporalContext {
  firstObservedAt: string | null;
  lastObservedAt: string | null;
  stabilizedAt: string | null;
  consolidatedAt: string | null;
  lastAccessedAt: string | null;
  supersededAt: string | null;
}

export interface OldGenerationSalienceInput {
  score?: number | null;
  signals?: Record<string, number>;
  lastEvaluatedAt?: string | null;
  sourceEntryId?: string | null;
}

export interface OldGenerationSalience {
  score: number | null;
  signals: Record<string, number>;
  signalCount: number;
  lastEvaluatedAt: string | null;
  sourceEntryId: string | null;
}

export interface OldGenerationConsolidationStateInput {
  status?: OldGenerationConsolidationStateStatus;
  lastOperation?: ConsolidationOperation | null;
  journalRecordId?: string | null;
  policyVersion?: string | null;
  sourceMemoryIds?: string[];
  preservedIdentityFields?: string[];
  protectedFromIdentityPromotion?: boolean | null;
}

export interface OldGenerationConsolidationState {
  status: OldGenerationConsolidationStateStatus;
  lastOperation: ConsolidationOperation | null;
  journalRecordId: string | null;
  policyVersion: string | null;
  sourceMemoryIds: string[];
  preservedIdentityFields: string[];
  protectedFromIdentityPromotion: boolean | null;
}

export interface LongTermMemoryInput {
  nodeId?: string;
  agentId: string;
  memoryId: string;
  category: LongTermMemoryCategory;
  content: string;
  summary?: string | null;
  confidence: number;
  provenance: Record<string, unknown>;
  stabilizedAt: string;
  temporalContext?: OldGenerationTemporalContextInput | null;
  salience?: OldGenerationSalienceInput | null;
  consolidationState?: OldGenerationConsolidationStateInput | null;
  learnedTrait?: {
    label: string;
    confidence: number;
    provenance: Record<string, unknown>;
  } | null;
}

export interface LongTermMemory extends Omit<LongTermMemoryInput, "learnedTrait"> {
  nodeId: string;
  summary: string;
  temporalContext: OldGenerationTemporalContext;
  salience: OldGenerationSalience;
  consolidationState: OldGenerationConsolidationState;
  learnedTrait: LearnedTraitMemory | null;
}

export interface LongTermMemoryPersistenceContent {
  memoryId: string;
  category: LongTermMemoryCategory;
  content: string;
  summary: string;
}

export interface LongTermMemoryPersistenceMetadata {
  nodeId: string;
  agentId: string;
  confidence: number;
  provenance: Record<string, unknown>;
  stabilizedAt: string;
  temporalContext: OldGenerationTemporalContext;
  salience: OldGenerationSalience;
  consolidationState: OldGenerationConsolidationState;
  learnedTrait: LearnedTraitMemory | null;
}

export interface SerializedLongTermMemoryEntry {
  schemaId: "agent_brain_long_term_memory_entry";
  schemaVersion: "1.0.0";
  nodeKind: "long_term_memory";
  content: LongTermMemoryPersistenceContent;
  metadata: LongTermMemoryPersistenceMetadata;
}

export interface LongTermMemoryLogicalIdentityInput {
  nodeId?: string | null;
  agentId: string;
  memoryId: string;
  category: LongTermMemoryCategory;
  content: string;
  summary?: string | null;
  sourceMemoryIds?: string[] | null;
  lineageMemoryIds?: string[] | null;
  learnedTraitLabel?: string | null;
  learnedTrait?: {
    label?: string | null;
  } | null;
  consolidationState?: {
    sourceMemoryIds?: string[] | null;
  } | null;
}

export interface LongTermMemoryLogicalIdentity {
  version: "1.0.0";
  stableMemoryId: string;
  nodeId: string | null;
  agentId: string;
  category: LongTermMemoryCategory;
  content: string;
  summary: string;
  lineageMemoryIds: string[];
  learnedTraitLabel: string | null;
  key: string;
}

export interface LongTermMemoryLogicalIdentityMatchResult {
  status:
    | "matched"
    | "unmatched"
    | "ambiguous"
    | "conflicting-stable-memory-id";
  strategy: "stable-memory-id" | "logical-identity";
  logicalIdentity: LongTermMemoryLogicalIdentity;
  matchCount: number;
  matchedMemoryId: string | null;
  matchedNodeId: string | null;
  matchedLogicalIdentity: LongTermMemoryLogicalIdentity | null;
  conflictingMemoryIds: string[];
}

export type LongTermMemoryLogicalIdentityRecordInput =
  | LongTermMemoryLogicalIdentityInput
  | SerializedLongTermMemoryEntry
  | LongTermMemoryInput
  | LongTermMemory;

export type LongTermMemoryPersistenceWritableEntryInput =
  | SerializedLongTermMemoryEntry
  | LongTermMemoryInput
  | LongTermMemory
  | PromotionSelectionLongTermMemorySerializationInput
  | PromotionSelectionLongTermMemoryRewriteInput;

export interface LongTermMemoryPersistenceKeyOptions {
  keyPrefix?: string | null;
}

export interface LongTermMemoryPersistenceStoredIdentity {
  agentId: string;
  memoryId: string;
  nodeId: string;
  logicalIdentityKey: string;
}

export type LongTermMemoryPersistenceStorageWriteIntegrityMode =
  | "create"
  | "replace"
  | "rollback";

export interface LongTermMemoryPersistenceStorageWriteIntegrity {
  mode: LongTermMemoryPersistenceStorageWriteIntegrityMode;
  expectedExistingValue: string | null;
  expectedExistingIdentity: LongTermMemoryPersistenceStoredIdentity | null;
  nextIdentity: LongTermMemoryPersistenceStoredIdentity;
}

export type LongTermMemoryPersistenceStorageRecordValue =
  | SerializedLongTermMemoryEntry
  | string
  | null
  | undefined;

export interface LongTermMemoryPersistenceStorageRecordDescriptor {
  key: string;
  keyPrefix: string;
  recordName: string;
  agentId: string;
  memoryId: string;
  nodeId: string;
}

export interface LongTermMemoryPersistenceStorageReadRequest
  extends LongTermMemoryPersistenceStorageRecordDescriptor {}

export interface LongTermMemoryPersistenceStorageReadResult
  extends LongTermMemoryPersistenceStorageRecordDescriptor {
  found: boolean;
  value: LongTermMemoryPersistenceStorageRecordValue;
}

export interface LongTermMemoryPersistenceStorageWriteRequest
  extends LongTermMemoryPersistenceStorageRecord {
  overwrite: boolean;
  integrity?: LongTermMemoryPersistenceStorageWriteIntegrity;
}

export interface LongTermMemoryPersistenceStorageRecord
  extends LongTermMemoryPersistenceStorageRecordDescriptor {
  contentType: "application/json";
  value: string;
  entry: SerializedLongTermMemoryEntry;
}

export interface LongTermMemoryPersistenceStorageWriteResult
  extends LongTermMemoryPersistenceStorageWriteRequest {
  written: boolean;
}

export interface LongTermMemoryPersistenceStorageDeleteIntegrity {
  expectedExistingValue: string | null;
  expectedExistingIdentity: LongTermMemoryPersistenceStoredIdentity | null;
}

export interface LongTermMemoryPersistenceStorageDeleteRequest
  extends LongTermMemoryPersistenceStorageRecordDescriptor {
  integrity?: LongTermMemoryPersistenceStorageDeleteIntegrity | null;
}

export interface LongTermMemoryPersistenceStorageDeleteResult
  extends LongTermMemoryPersistenceStorageDeleteRequest {
  deleted: boolean;
}

export interface LongTermMemoryPersistenceStorageListRequest {
  keyPrefix: string;
  agentId: string;
}

export interface LongTermMemoryPersistenceStorageListEntry {
  key: string;
  value: LongTermMemoryPersistenceStorageRecordValue;
}

export interface LongTermMemoryPersistenceStorageAdapter {
  read(
    request: LongTermMemoryPersistenceStorageReadRequest,
  ):
    | Readonly<LongTermMemoryPersistenceStorageReadResult>
    | Promise<Readonly<LongTermMemoryPersistenceStorageReadResult>>;
  write(
    request: LongTermMemoryPersistenceStorageWriteRequest,
  ):
    | Readonly<LongTermMemoryPersistenceStorageWriteResult>
    | Promise<Readonly<LongTermMemoryPersistenceStorageWriteResult>>;
  delete?(
    request: LongTermMemoryPersistenceStorageDeleteRequest,
  ):
    | Readonly<LongTermMemoryPersistenceStorageDeleteResult>
    | Promise<Readonly<LongTermMemoryPersistenceStorageDeleteResult>>;
  list?(
    request: LongTermMemoryPersistenceStorageListRequest,
  ):
    | ReadonlyArray<LongTermMemoryPersistenceStorageListEntry>
    | Promise<ReadonlyArray<LongTermMemoryPersistenceStorageListEntry>>;
}

export type LongTermMemoryPersistenceReadableEntryInput =
  | SerializedLongTermMemoryEntry
  | LongTermMemoryPersistenceStorageRecord
  | LongTermMemoryPersistenceStorageListEntry
  | LongTermMemoryPersistenceStorageReadResult
  | LongTermMemoryPersistenceStorageRecordValue;

export type LongTermMemoryGraphInput =
  | LongTermMemoryInput
  | LongTermMemory
  | SerializedLongTermMemoryEntry
  | LongTermMemoryPersistenceStorageRecord
  | LongTermMemoryPersistenceStorageListEntry
  | LongTermMemoryPersistenceStorageReadResult;

export interface ConsolidationCheckpointCursorInput {
  streamId: string;
  cursorToken?: string | null;
  sequence?: number | null;
  eventId?: string | null;
  watermark?: string | Date | null;
}

export interface ConsolidationCheckpointCursor {
  streamId: string;
  cursorToken: string | null;
  sequence: number | null;
  eventId: string | null;
  watermark: string | null;
}

export interface ConsolidationCheckpointInput {
  agentId: string;
  syncSource: string;
  cursor: ConsolidationCheckpointCursorInput;
  consolidatedAt: string | Date;
  runtimePhase?: string | null;
  provenance?: Record<string, unknown> | null;
}

export interface ConsolidationCheckpoint {
  agentId: string;
  syncSource: string;
  cursor: Readonly<ConsolidationCheckpointCursor>;
  consolidatedAt: string;
  runtimePhase: string | null;
  provenance: Readonly<Record<string, unknown>>;
}

export interface SerializedConsolidationCheckpointEntry {
  schemaId: "agent_brain_consolidation_checkpoint";
  schemaVersion: "1.0.0";
  recordType: "consolidation_checkpoint";
  checkpoint: Readonly<ConsolidationCheckpoint>;
}

export type ConsolidationCheckpointWritableEntryInput =
  | ConsolidationCheckpointInput
  | ConsolidationCheckpoint
  | SerializedConsolidationCheckpointEntry;

export interface ConsolidationCheckpointKeyOptions {
  keyPrefix?: string | null;
}

export interface ConsolidationCheckpointLookup {
  agentId: string;
  syncSource: string;
  streamId: string;
}

export type ConsolidationCheckpointKeyInput =
  | ConsolidationCheckpointLookup
  | ConsolidationCheckpointInput
  | ConsolidationCheckpoint
  | SerializedConsolidationCheckpointEntry;

export interface ConsolidationCheckpointStoredIdentity {
  agentId: string;
  syncSource: string;
  streamId: string;
}

export type ConsolidationCheckpointStorageWriteIntegrityMode =
  | "create"
  | "replace"
  | "rollback";

export interface ConsolidationCheckpointStorageWriteIntegrity {
  mode: ConsolidationCheckpointStorageWriteIntegrityMode;
  expectedExistingValue: string | null;
  expectedExistingIdentity: ConsolidationCheckpointStoredIdentity | null;
  nextIdentity: ConsolidationCheckpointStoredIdentity;
}

export type ConsolidationCheckpointStorageRecordValue =
  | SerializedConsolidationCheckpointEntry
  | string
  | null
  | undefined;

export interface ConsolidationCheckpointStorageRecordDescriptor {
  key: string;
  keyPrefix: string;
  recordName: string;
  agentId: string;
  syncSource: string;
  streamId: string;
}

export interface ConsolidationCheckpointStorageReadRequest
  extends ConsolidationCheckpointStorageRecordDescriptor {}

export interface ConsolidationCheckpointStorageReadResult
  extends ConsolidationCheckpointStorageRecordDescriptor {
  found: boolean;
  value: ConsolidationCheckpointStorageRecordValue;
}

export interface ConsolidationCheckpointStorageRecord
  extends ConsolidationCheckpointStorageRecordDescriptor {
  contentType: "application/json";
  value: string;
  entry: SerializedConsolidationCheckpointEntry;
}

export interface ConsolidationCheckpointStorageWriteRequest
  extends ConsolidationCheckpointStorageRecord {
  overwrite: boolean;
  integrity?: ConsolidationCheckpointStorageWriteIntegrity | null;
}

export interface ConsolidationCheckpointStorageWriteResult
  extends ConsolidationCheckpointStorageWriteRequest {
  written: boolean;
}

export interface ConsolidationCheckpointStorageAdapter {
  read(
    request: ConsolidationCheckpointStorageReadRequest,
  ):
    | Readonly<ConsolidationCheckpointStorageReadResult>
    | Promise<Readonly<ConsolidationCheckpointStorageReadResult>>;
  write(
    request: ConsolidationCheckpointStorageWriteRequest,
  ):
    | Readonly<ConsolidationCheckpointStorageWriteResult>
    | Promise<Readonly<ConsolidationCheckpointStorageWriteResult>>;
}

export type ConsolidationCheckpointReadableEntryInput =
  | SerializedConsolidationCheckpointEntry
  | ConsolidationCheckpointStorageRecord
  | ConsolidationCheckpointStorageReadResult
  | ConsolidationCheckpointStorageRecordValue;

export interface ConsolidationCheckpointCompletionInput {
  status: string;
  results?: ReadonlyArray<unknown>;
  failedCount?: number;
  blockedCount?: number;
  [key: string]: unknown;
}

export interface PersistConsolidationCheckpointInput
  extends ConsolidationCheckpointKeyOptions {
  storage?: ConsolidationCheckpointStorageAdapter;
  storageAdapter?: ConsolidationCheckpointStorageAdapter;
  entry: ConsolidationCheckpointWritableEntryInput;
  completion?: string | ConsolidationCheckpointCompletionInput | null;
}

export interface PersistConsolidationCheckpointResult {
  agentId: string;
  syncSource: string;
  streamId: string;
  keyPrefix: string;
  key: string;
  recordName: string;
  completionStatus: string | null;
  completionDeferredField: string | null;
  completionDeferredReason: string | null;
  entry: SerializedConsolidationCheckpointEntry;
  serializedEntry: string;
  status: "created" | "overwritten" | "unchanged" | "deferred";
  applied: boolean;
  overwritten: boolean;
  checkpointAdvanced: boolean;
}

export interface PersistCompletedConsolidationCheckpointInput
  extends PersistConsolidationCheckpointInput {
  completion: string | ConsolidationCheckpointCompletionInput;
}

export interface ReadConsolidationCheckpointInput
  extends ConsolidationCheckpointKeyOptions,
    ConsolidationCheckpointLookup {
  storage?: ConsolidationCheckpointStorageAdapter;
  storageAdapter?: ConsolidationCheckpointStorageAdapter;
}

export interface ReadConsolidationCheckpointResult {
  key: string;
  keyPrefix: string;
  recordName: string;
  agentId: string;
  syncSource: string;
  streamId: string;
  found: boolean;
  entry: SerializedConsolidationCheckpointEntry | null;
  serializedEntry: string | null;
  checkpoint: Readonly<ConsolidationCheckpoint> | null;
}

export interface ConsolidationRpcChangeWindow {
  startExclusive: Readonly<ConsolidationCheckpointCursor> | null;
  endInclusive: Readonly<ConsolidationCheckpointCursor>;
}

export interface ResolveConsolidationRpcChangeWindowInput
  extends ReadConsolidationCheckpointInput {
  latestCursor: ConsolidationCheckpointCursorInput;
}

export interface ResolveConsolidationRpcChangeWindowResult {
  key: string;
  keyPrefix: string;
  recordName: string;
  agentId: string;
  syncSource: string;
  streamId: string;
  checkpointFound: boolean;
  checkpoint: Readonly<ConsolidationCheckpoint> | null;
  derivation: "resume-from-checkpoint" | "bootstrap-from-stream-origin";
  window: Readonly<ConsolidationRpcChangeWindow>;
}

export interface PersistLongTermMemoryEntryInput
  extends LongTermMemoryPersistenceKeyOptions {
  storage?: LongTermMemoryPersistenceStorageAdapter;
  storageAdapter?: LongTermMemoryPersistenceStorageAdapter;
  entry: LongTermMemoryPersistenceWritableEntryInput;
  overwrite?: boolean;
  runtimePhase?: string | ArchivalTransitionRuntimePhaseInput;
  inactivitySuggestion?: ArchivalTransitionIdleWindowSuggestionInput | null;
  teamIdle?: boolean;
}

export interface PersistLongTermMemoryEntryResult {
  agentId: string;
  memoryId: string;
  nodeId: string;
  keyPrefix: string;
  key: string;
  recordName: string;
  authorization: ArchivalTransitionAuthorization;
  entry: SerializedLongTermMemoryEntry | null;
  serializedEntry: string | null;
  status: "blocked" | "created" | "overwritten" | "unchanged";
  applied: boolean;
  overwritten: boolean;
}

export interface DeleteLongTermMemoryEntryInput
  extends LongTermMemoryPersistenceKeyOptions {
  storage?: LongTermMemoryPersistenceStorageAdapter;
  storageAdapter?: LongTermMemoryPersistenceStorageAdapter;
  entry: LongTermMemoryPersistenceWritableEntryInput;
  runtimePhase?: string | ArchivalTransitionRuntimePhaseInput;
  inactivitySuggestion?: ArchivalTransitionIdleWindowSuggestionInput | null;
  teamIdle?: boolean;
}

export interface DeleteLongTermMemoryEntryResult {
  agentId: string;
  memoryId: string;
  nodeId: string;
  keyPrefix: string;
  key: string;
  recordName: string;
  authorization: ArchivalTransitionAuthorization;
  entry: SerializedLongTermMemoryEntry | null;
  serializedEntry: string | null;
  status: "blocked" | "deleted" | "absent";
  applied: boolean;
  deleted: boolean;
}

export interface PersistPromotionSelectionToLongTermMemoryInput
  extends LongTermMemoryPersistenceKeyOptions {
  storageAdapter: LongTermMemoryPersistenceStorageAdapter;
  storage?: LongTermMemoryPersistenceStorageAdapter;
  selection: Readonly<ConsolidationPromotionPlanSelection>;
  memory?:
    | PromotionSelectionLongTermMemorySerializationInput["memory"]
    | null;
  rewrittenEntry?:
    | PromotionSelectionLongTermMemoryRewriteInput["rewrittenEntry"]
    | null;
  runtimePhase?: string | ArchivalTransitionRuntimePhaseInput;
  inactivitySuggestion?: ArchivalTransitionIdleWindowSuggestionInput | null;
  teamIdle?: boolean;
}

export interface PersistPromotionSelectionToLongTermMemoryResult {
  agentId: string;
  selection: Readonly<ConsolidationPromotionPlanSelection>;
  persisted: Readonly<PersistLongTermMemoryEntryResult>;
  promotedMemory: Readonly<LongTermMemory> | null;
  nextGraph: Readonly<AgentBrainMemoryGraph>;
}

export interface MemoryEvidenceInput {
  nodeId?: string;
  evidenceId: string;
  agentId: string;
  kind: MemoryEvidenceKind;
  source: string;
  observedAt: string;
  detail: string;
  reference?: string | null;
  provenance: Record<string, unknown>;
  temporalContext?: OldGenerationTemporalContextInput | null;
  salience?: OldGenerationSalienceInput | null;
  consolidationState?: OldGenerationConsolidationStateInput | null;
}

export interface MemoryEvidence extends MemoryEvidenceInput {
  nodeId: string;
  reference: string | null;
  temporalContext: OldGenerationTemporalContext;
  salience: OldGenerationSalience | null;
  consolidationState: OldGenerationConsolidationState;
}

export interface ConsolidationRecordInput {
  nodeId?: string;
  recordId: string;
  agentId: string;
  operation: ConsolidationOperation;
  runtimePhase: string;
  consolidatedAt: string;
  sourceMemoryIds: string[];
  policyVersion: string;
  preservedIdentityFields?: string[];
  provenance: Record<string, unknown>;
  temporalContext?: OldGenerationTemporalContextInput | null;
  salience?: OldGenerationSalienceInput | null;
  consolidationState?: OldGenerationConsolidationStateInput | null;
}

export interface ConsolidationRecord extends ConsolidationRecordInput {
  nodeId: string;
  preservedIdentityFields: string[];
  temporalContext: OldGenerationTemporalContext;
  salience: OldGenerationSalience | null;
  consolidationState: OldGenerationConsolidationState;
}

export interface ArchivedMemoryInput {
  nodeId?: string;
  archiveId: string;
  agentId: string;
  originalGeneration: ArchivedMemorySourceGeneration;
  originalMemoryKind: ArchivedMemorySourceMemoryKind;
  originalMemoryId: string;
  originalNodeId?: string | null;
  originalProvenance?: Record<string, unknown> | null;
  archivalReason: string;
  archivedAt: string;
  lastRestoredAt?: string | null;
  snapshot: Record<string, unknown>;
  provenance: Record<string, unknown>;
  temporalContext?: OldGenerationTemporalContextInput | null;
  consolidationState?: OldGenerationConsolidationStateInput | null;
}

export interface ArchivedMemory extends ArchivedMemoryInput {
  nodeId: string;
  originalNodeId: string | null;
  originalProvenance: Record<string, unknown> | null;
  lastRestoredAt: string | null;
  temporalContext: OldGenerationTemporalContext;
  consolidationState: OldGenerationConsolidationState;
}

export type YoungGenerationMemoryKind = "working_memory" | "short_term_memory";

export interface YoungGenerationMaskedOriginalContentInput {
  value?: string | null;
  sourceField?: string | null;
  capturedAt?: string | null;
}

export interface YoungGenerationMaskedOriginalContent {
  value: string | null;
  sourceField: string | null;
  capturedAt: string | null;
}

export interface YoungGenerationMaskingAuditMetadataInput {
  auditRecordId?: string | null;
  policyVersion?: string | null;
  runtimePhase?: string | null;
  sourceEvaluationAt?: string | null;
  sourceEvaluationMode?: string | null;
  recordedAt?: string | null;
  actor?: string | null;
  metadata?: Record<string, unknown> | null;
}

export interface YoungGenerationMaskingAuditMetadata {
  auditRecordId: string | null;
  policyVersion: string | null;
  runtimePhase: string | null;
  sourceEvaluationAt: string | null;
  sourceEvaluationMode: string | null;
  recordedAt: string | null;
  actor: string | null;
  metadata: Record<string, unknown> | null;
}

export interface YoungGenerationMaskingMetadataInput {
  isMasked?: boolean;
  maskedAt?: string | null;
  unmaskedAt?: string | null;
  maskUpdatedAt?: string | null;
  maskedBy?: string | null;
  reason?: string | null;
  maskedOriginalContent?:
    | string
    | YoungGenerationMaskedOriginalContentInput
    | null;
  audit?: YoungGenerationMaskingAuditMetadataInput | null;
  provenance?: Record<string, unknown> | null;
}

export interface YoungGenerationMaskingMetadata {
  isMasked: boolean;
  maskedAt: string | null;
  unmaskedAt: string | null;
  maskUpdatedAt: string | null;
  maskedBy: string | null;
  reason: string | null;
  maskedOriginalContent: YoungGenerationMaskedOriginalContent | null;
  audit: YoungGenerationMaskingAuditMetadata | null;
  provenance: Record<string, unknown> | null;
}

export type YoungGenerationMemoryLifecycleState =
  | "active"
  | "inactive"
  | "archived";

export interface YoungGenerationArchiveLinkageInput {
  archiveId?: string | null;
  archiveNodeId?: string | null;
  archivedAt?: string | null;
}

export interface YoungGenerationArchiveLinkage {
  archiveId: string | null;
  archiveNodeId: string | null;
  archivedAt: string | null;
}

export type ArchivedMemoryReference = YoungGenerationArchiveLinkage;

export type ArchivedMemoryReferenceInput =
  | string
  | YoungGenerationArchiveLinkageInput
  | YoungGenerationArchiveLinkage;

export interface YoungGenerationMemoryLifecycleInput {
  state?: YoungGenerationMemoryLifecycleState;
  inactiveAt?: string | null;
  inactiveReason?: string | null;
  archiveLinkage?: YoungGenerationArchiveLinkageInput | null;
}

export interface YoungGenerationMemoryLifecycle {
  state: YoungGenerationMemoryLifecycleState;
  inactiveAt: string | null;
  inactiveReason: string | null;
  archiveLinkage: YoungGenerationArchiveLinkage | null;
}

export interface YoungGenerationMemoryEnvelopeInput {
  record: MemoryItemRecordInput;
  inactiveForRetrieval?: boolean;
  masking?: YoungGenerationMaskingMetadataInput | null;
  lifecycle?: YoungGenerationMemoryLifecycleInput | null;
}

export type YoungGenerationMemoryInput =
  | MemoryItemRecordInput
  | YoungGenerationMemoryEnvelopeInput;

export interface YoungGenerationMemory {
  record: MemoryItemRecord;
  inactiveForRetrieval: boolean;
  masking: YoungGenerationMaskingMetadata;
  lifecycle: YoungGenerationMemoryLifecycle;
}

export interface WorkingMemory extends YoungGenerationMemory {}

export interface ShortTermMemory extends YoungGenerationMemory {}

export interface ImportanceIndexEntryInput {
  entryId: string;
  agentId: string;
  memoryId: string;
  memoryKind: YoungGenerationMemoryKind;
  signals: Record<string, number>;
  lastUpdatedAt: string;
  provenance?: Record<string, unknown> | null;
}

export interface ImportanceIndexEntry extends ImportanceIndexEntryInput {
  signalCount: number;
  importanceScore: number;
  provenance: Record<string, unknown> | null;
}

export interface ImportanceIndexEntryReference {
  agentId?: string;
  memoryId: string;
  memoryKind: YoungGenerationMemoryKind;
}

export interface ImportanceIndexEntryUpdate {
  signals: Record<string, number>;
  lastUpdatedAt?: string;
  provenance?: Record<string, unknown> | null;
  replaceSignals?: boolean;
}

export interface ImportanceIndexQuery {
  accessMode?: "retrieval" | "inspection" | "administrative";
  agentId?: string;
  memoryId?: string;
  memoryKind?: YoungGenerationMemoryKind;
  minImportanceScore?: number;
  signalName?: string;
  minSignalValue?: number;
  limit?: number;
  sortBy?: "importanceScoreDesc" | "lastUpdatedAtDesc";
}

export type ConsolidationSignalDimension = "importance" | "stability";

export type ConsolidationSignalGeneration =
  | "youngGeneration"
  | "oldGeneration";

export type ConsolidationPromotionSignalPath =
  | "youngGeneration.importance"
  | "youngGeneration.stability"
  | "oldGeneration.importance"
  | "oldGeneration.stability";

export interface ConsolidationSignalCaptureInput {
  score?: number | null;
  signals: Record<string, number>;
  capturedAt: string;
  sourceCollection?: string | null;
  sourceRecordIds?: string[];
  provenance?: Record<string, unknown> | null;
}

export interface ConsolidationSignalCapture {
  score: number;
  signals: Record<string, number>;
  signalCount: number;
  capturedAt: string;
  sourceCollection: string | null;
  sourceRecordIds: string[];
  provenance: Record<string, unknown> | null;
}

export interface ConsolidationGenerationSignalSetInput {
  importance?: ConsolidationSignalCaptureInput | null;
  stability?: ConsolidationSignalCaptureInput | null;
}

export interface ConsolidationGenerationSignalSet {
  importance: ConsolidationSignalCapture | null;
  stability: ConsolidationSignalCapture | null;
}

export interface ConsolidationPromotionCandidateInput {
  candidateId: string;
  agentId: string;
  sourceMemoryId: string;
  sourceMemoryKind: YoungGenerationMemoryKind;
  targetMemoryId?: string | null;
  targetNodeKind?: "long_term_memory";
  learnedTraitCandidate?: boolean;
  signals: {
    youngGeneration: {
      importance: ConsolidationSignalCaptureInput;
      stability: ConsolidationSignalCaptureInput;
    };
    oldGeneration?: ConsolidationGenerationSignalSetInput | null;
  };
  provenance?: Record<string, unknown> | null;
}

export interface ConsolidationPromotionCandidate {
  candidateId: string;
  agentId: string;
  sourceMemoryId: string;
  sourceMemoryKind: YoungGenerationMemoryKind;
  targetMemoryId: string | null;
  targetNodeKind: "long_term_memory";
  learnedTraitCandidate: boolean;
  signals: {
    youngGeneration: ConsolidationGenerationSignalSet;
    oldGeneration: ConsolidationGenerationSignalSet;
  };
  signalCoverage: ReadonlyArray<ConsolidationPromotionSignalPath>;
  provenance: Record<string, unknown> | null;
}

export interface ConsolidationPromotionThresholdsInput {
  minimumPromotionScore?: number;
  minimumYoungImportanceScore?: number;
  minimumYoungStabilityScore?: number;
  minimumOldImportanceScore?: number;
  minimumOldStabilityScore?: number;
}

export interface ConsolidationPromotionThresholds {
  minimumPromotionScore: number;
  minimumYoungImportanceScore: number;
  minimumYoungStabilityScore: number;
  minimumOldImportanceScore: number;
  minimumOldStabilityScore: number;
}

export interface ConsolidationPromotionWeightsInput {
  youngImportance?: number;
  youngStability?: number;
  oldImportance?: number;
  oldStability?: number;
}

export interface ConsolidationPromotionWeights {
  youngImportance: number;
  youngStability: number;
  oldImportance: number;
  oldStability: number;
}

export interface ConsolidationPromotionPolicyInput {
  policyId?: string;
  version?: string;
  targetNodeKind?: "long_term_memory";
  requiresRuntimeAuthorization?: boolean;
  allowedRuntimePhases?: string[];
  inactivityHeuristicsAuthorize?: boolean;
  teamIdleCoordinatesOnly?: boolean;
  allowIdentityPromotion?: boolean;
  learnedTraitsTargetNodeKind?: "long_term_memory";
  protectedIdentityFields?: string[];
  requiredSignals?: ConsolidationPromotionSignalPath[];
  thresholds?: ConsolidationPromotionThresholdsInput | null;
  weights?: ConsolidationPromotionWeightsInput | null;
}

export interface ConsolidationPromotionPolicy {
  policyId: string;
  version: string;
  targetNodeKind: "long_term_memory";
  requiresRuntimeAuthorization: true;
  allowedRuntimePhases: string[];
  inactivityHeuristicsAuthorize: false;
  teamIdleCoordinatesOnly: true;
  allowIdentityPromotion: false;
  learnedTraitsTargetNodeKind: "long_term_memory";
  protectedIdentityFields: string[];
  requiredSignals: ConsolidationPromotionSignalPath[];
  thresholds: ConsolidationPromotionThresholds;
  weights: ConsolidationPromotionWeights;
}

export interface ConsolidationPromotionCriterionResult {
  signalPath: ConsolidationPromotionSignalPath;
  generation: ConsolidationSignalGeneration;
  dimension: ConsolidationSignalDimension;
  required: boolean;
  available: boolean;
  score: number | null;
  threshold: number;
  weight: number;
  meetsThreshold: boolean | null;
  signalCount: number;
  capturedAt: string | null;
  sourceCollection: string | null;
  sourceRecordIds: string[];
}

export interface ConsolidationPromotionCriteriaSummary {
  totalCriteria: number;
  requiredCriteria: number;
  optionalCriteria: number;
  availableCriteria: number;
  satisfiedCriteria: number;
  blockedCriteria: number;
  missingRequiredCriteria: ConsolidationPromotionSignalPath[];
}

export interface ConsolidationPromotionDecisionMetadata {
  evaluatedAt: string;
  policyId: string;
  policyVersion: string;
  scoringModel: "weighted-thresholds";
  evaluationMode: "offline-promotion-eligibility";
  offlineOnly: true;
}

export interface ConsolidationPromotionEvaluation {
  candidateId: string;
  agentId: string;
  sourceMemoryId: string;
  sourceMemoryKind: YoungGenerationMemoryKind;
  targetMemoryId: string | null;
  targetNodeKind: "long_term_memory";
  learnedTraitCandidate: boolean;
  policyId: string;
  policyVersion: string;
  evaluatedAt: string;
  signalCoverage: ReadonlyArray<ConsolidationPromotionSignalPath>;
  requiredSignals: ConsolidationPromotionSignalPath[];
  criteria: ReadonlyArray<ConsolidationPromotionCriterionResult>;
  criteriaBySignalPath: Readonly<
    Partial<Record<ConsolidationPromotionSignalPath, ConsolidationPromotionCriterionResult>>
  >;
  criteriaSummary: Readonly<ConsolidationPromotionCriteriaSummary>;
  thresholdChecks: Partial<Record<ConsolidationPromotionSignalPath, boolean | null>>;
  signalScores: Partial<Record<ConsolidationPromotionSignalPath, number | null>>;
  promotionScore: number;
  minimumPromotionScoreMet: boolean;
  eligible: boolean;
  eligibleForPromotion: boolean;
  decision: "promote" | "defer";
  recommendedOperation: "promote" | "defer";
  blockedReasons: string[];
  requiresRuntimeAuthorization: true;
  allowedRuntimePhases: string[];
  inactivityHeuristicsAuthorize: false;
  teamIdleCoordinatesOnly: true;
  identityPromotionBlocked: boolean;
  learnedTraitsTargetNodeKind: "long_term_memory";
  protectedIdentityFields: string[];
  decisionMetadata: Readonly<ConsolidationPromotionDecisionMetadata>;
}

export interface ConsolidationPromotionPlanSelection {
  candidate: Readonly<ConsolidationPromotionCandidate>;
  evaluation: Readonly<ConsolidationPromotionEvaluation>;
  sourceCollection: "workingMemory" | "shortTermMemory";
  targetMemoryId: string | null;
  targetNodeId: string | null;
  outputMemoryId: string;
  outputNodeId: string;
}

export interface ConsolidationPromotionPlanDeferredCandidate {
  candidate: Readonly<ConsolidationPromotionCandidate>;
  evaluation: Readonly<ConsolidationPromotionEvaluation> | null;
  sourceCollection: "workingMemory" | "shortTermMemory" | null;
  targetMemoryId: string | null;
  targetNodeId: string | null;
  outputMemoryId: string | null;
  outputNodeId: string | null;
  deferredReason: string;
  abort: Readonly<ConsolidationPipelineAbort> | null;
}

export interface ConsolidationPromotionPlanOptions {
  candidates: ReadonlyArray<ConsolidationPromotionCandidateInput>;
  runtimePhase?: string | ArchivalTransitionRuntimePhaseInput;
  inactivitySuggestion?: ArchivalTransitionIdleWindowSuggestionInput | null;
  teamIdle?: boolean;
  policy?: ConsolidationPromotionPolicyInput | ConsolidationPromotionPolicy;
  edges?: ReadonlyArray<ConsolidationPromotionPageRankEdgeInput> | null;
  topK?: number;
}

export interface ConsolidationPromotionPlan {
  agentId: string;
  policyId: string;
  policyVersion: string;
  authorization: Readonly<ArchivalTransitionAuthorization>;
  promotionCandidateCount: number;
  selectedPromotions: ReadonlyArray<Readonly<ConsolidationPromotionPlanSelection>>;
  selectedPromotionCount: number;
  deferredCandidates: ReadonlyArray<Readonly<ConsolidationPromotionPlanDeferredCandidate>>;
  deferredCount: number;
  batchEligible: boolean;
  selectionMode: "offline-promotion-selection";
}

export interface WeightedPageRankEdgeInput {
  from: string;
  to: string;
  weight?: number;
  timestamp?: string | number | Date;
}

export interface WeightedPageRankInput {
  nodes: ReadonlyArray<string>;
  edges?: ReadonlyArray<WeightedPageRankEdgeInput> | null;
  dampingFactor?: number;
  tolerance?: number;
  maxIterations?: number;
  personalization?: Readonly<Record<string, number>> | null;
  decayLambda?: number;
  evaluatedAt?: string | number | Date | null;
}

export interface WeightedPageRankResult {
  dampingFactor: number;
  tolerance: number;
  maxIterations: number;
  iterations: number;
  converged: boolean;
  nodeCount: number;
  edgeCount: number;
  rankedNodeIds: ReadonlyArray<string>;
  personalization: Readonly<Record<string, number>>;
  scores: Readonly<Record<string, number>>;
  totalScore: number;
}

export interface ConsolidationPromotionPageRankEdgeInput {
  fromCandidateId: string;
  toCandidateId: string;
  weight?: number;
}

export interface ConsolidationPromotionPageRankOptions {
  candidates: ReadonlyArray<ConsolidationPromotionCandidateInput | ConsolidationPromotionCandidate>;
  edges?: ReadonlyArray<ConsolidationPromotionPageRankEdgeInput> | null;
  policy?: ConsolidationPromotionPolicyInput | ConsolidationPromotionPolicy;
  dampingFactor?: number;
  tolerance?: number;
  maxIterations?: number;
  topK?: number;
}

export interface ConsolidationPromotionPageRankEntry {
  rank: number;
  candidateId: string;
  candidate: Readonly<ConsolidationPromotionCandidate>;
  weightedSignalScore: number;
  personalizationScore: number;
  pageRankScore: number;
}

export interface ConsolidationPromotionPageRankResult {
  policyId: string;
  policyVersion: string;
  dampingFactor: number;
  tolerance: number;
  maxIterations: number;
  iterations: number;
  converged: boolean;
  rankedCandidateIds: ReadonlyArray<string>;
  personalizationByCandidateId: Readonly<Record<string, number>>;
  scoresByCandidateId: Readonly<Record<string, number>>;
  rankedCandidates: ReadonlyArray<Readonly<ConsolidationPromotionPageRankEntry>>;
}

export interface ConsolidationPromotionTopKSelection {
  topK: number;
  ranking: Readonly<ConsolidationPromotionPageRankResult>;
  selectedCandidates: ReadonlyArray<Readonly<ConsolidationPromotionPageRankEntry>>;
  overflowCandidates: ReadonlyArray<Readonly<ConsolidationPromotionPageRankEntry>>;
}

export type ZepiaToolCallMemoryReferenceScalar = string | number | bigint;

export interface ZepiaToolCallMemoryReferenceInput {
  agentId?: string;
  memoryId?: ZepiaToolCallMemoryReferenceScalar;
  id?: ZepiaToolCallMemoryReferenceScalar;
  role?: "source" | "target";
}

export interface ZepiaToolCallTrackingEntryInput {
  agentId?: string;
  toolCallId?: ZepiaToolCallMemoryReferenceScalar;
  trackingId?: ZepiaToolCallMemoryReferenceScalar;
  stepId?: ZepiaToolCallMemoryReferenceScalar;
  toolLoopId?: string;
  loopId?: string;
  traceId?: string;
  stepIndex?: number;
  toolName?: string;
  tool?: string;
  toolCall?: {
    tool?: string;
  } | null;
  calledAt?: string | number | Date;
  observedAt?: string | number | Date;
  timestamp?: string | number | Date;
  source?:
    | ZepiaToolCallMemoryReferenceInput
    | ZepiaToolCallMemoryReferenceScalar
    | null;
  sources?:
    | ReadonlyArray<
        | ZepiaToolCallMemoryReferenceInput
        | ZepiaToolCallMemoryReferenceScalar
      >
    | null;
  sourceMemoryId?: ZepiaToolCallMemoryReferenceScalar;
  sourceMemoryIds?: ReadonlyArray<ZepiaToolCallMemoryReferenceScalar> | null;
  memoryId?: ZepiaToolCallMemoryReferenceScalar;
  target?:
    | ZepiaToolCallMemoryReferenceInput
    | ZepiaToolCallMemoryReferenceScalar
    | null;
  targets?:
    | ReadonlyArray<
        | ZepiaToolCallMemoryReferenceInput
        | ZepiaToolCallMemoryReferenceScalar
      >
    | null;
  targetMemoryId?: ZepiaToolCallMemoryReferenceScalar;
  targetMemoryIds?: ReadonlyArray<ZepiaToolCallMemoryReferenceScalar> | null;
  referencedMemoryIds?: ReadonlyArray<ZepiaToolCallMemoryReferenceScalar> | null;
  references?: ReadonlyArray<ZepiaToolCallMemoryReferenceInput> | null;
  provenance?: Readonly<Record<string, unknown>> | null;
}

export interface ZepiaToolCallTrackingInput {
  agentId?: string;
  sessionId?: string | null;
  toolWeights?: Readonly<Record<string, number>> | null;
  toolWeightConfigPath?: string | null;
  defaultToolWeight?: number;
  toolCalls: ReadonlyArray<ZepiaToolCallTrackingEntryInput>;
}

export interface ZepiaConsolidationTopKInput {
  agentId: string;
  topK?: number | null;
  consolidationConfigPath?: string | null;
}

export interface ZepiaConsolidationTopKResolution {
  agentId: string;
  configPath: string | null;
  topK: number | null;
}

export interface ZepiaToolCallLinkCandidate {
  candidateId: string;
  pairId: string;
  relation: "tool_call_co_reference";
  agentId: string;
  toolCallId: string;
  toolName: string;
  calledAt: string;
  sourceId: string;
  targetId: string;
  sourceMemoryId: string;
  targetMemoryId: string;
  provenance: Readonly<Record<string, unknown>>;
}

export interface ZepiaToolCallCoReferenceEdge {
  edgeId: string;
  pairId: string;
  relation: "tool_call_co_reference";
  agentId: string;
  toolCallId: string;
  toolName: string;
  calledAt: string;
  fromId: string;
  toId: string;
  fromMemoryId: string;
  toMemoryId: string;
  edgeWeight: number;
  provenance: Readonly<Record<string, unknown>>;
  candidateIds: ReadonlyArray<string>;
}

export interface ZepiaToolCallTrackingEntry {
  agentId: string;
  toolCallId: string;
  toolName: string;
  calledAt: string;
  sourceIds: ReadonlyArray<string>;
  targetIds: ReadonlyArray<string>;
  sourceMemoryIds: ReadonlyArray<string>;
  targetMemoryIds: ReadonlyArray<string>;
  provenance: Readonly<Record<string, unknown>>;
  linkCandidateCount: number;
  linkCandidates: ReadonlyArray<Readonly<ZepiaToolCallLinkCandidate>>;
  coReferenceEdgeCount: number;
  coReferenceEdges: ReadonlyArray<Readonly<ZepiaToolCallCoReferenceEdge>>;
}

export interface ZepiaToolCallTrackingIngestionResult {
  agentId: string;
  sessionId: string | null;
  toolCallCount: number;
  linkCandidateCount: number;
  coReferenceEdgeCount: number;
  toolCallIds: ReadonlyArray<string>;
  toolCalls: ReadonlyArray<Readonly<ZepiaToolCallTrackingEntry>>;
  linkCandidates: ReadonlyArray<Readonly<ZepiaToolCallLinkCandidate>>;
  coReferenceEdges: ReadonlyArray<Readonly<ZepiaToolCallCoReferenceEdge>>;
}

export interface ZepiaConsolidationPayloadMemoryEntityInput {
  agentId?: string;
  memoryId?: string | number | bigint;
  id?: string | number | bigint;
  record?: {
    agentId?: string;
    memoryId?: string | number | bigint;
    [key: string]: unknown;
  } | null;
  deleted?: boolean;
  operation?: string;
  [key: string]: unknown;
}

export interface ZepiaConsolidationPayloadMemorySnapshotDescriptor {
  memoryId: string;
  fingerprint: string;
}

export interface ZepiaConsolidationPayloadCheckpointSnapshot {
  schemaId: "agent_brain_zepia_consolidation_memory_snapshot";
  schemaVersion: "1.0.0";
  agentId: string;
  memories: ReadonlyArray<
    Readonly<ZepiaConsolidationPayloadMemorySnapshotDescriptor>
  >;
}

export type ZepiaConsolidationPayloadCheckpointInput =
  | Readonly<ConsolidationCheckpoint>
  | Readonly<SerializedConsolidationCheckpointEntry>
  | Readonly<ReadConsolidationCheckpointResult>
  | {
      found?: boolean;
      checkpoint: Readonly<ConsolidationCheckpoint> | null;
    };

export interface ZepiaConsolidationPayloadMemoryRecord {
  operation: "added" | "updated" | "deleted";
  memoryId: string;
  previousFingerprint: string | null;
  currentFingerprint: string | null;
  entity: Readonly<Record<string, unknown>>;
}

export interface ZepiaConsolidationPayloadSummary {
  checkpointMemoryCount: number;
  currentMemoryCount: number;
  unchangedCount: number;
  emittedMemoryCount: number;
  addedCount: number;
  updatedCount: number;
  deletedCount: number;
}

export interface ZepiaConsolidationPayloadInput {
  agentId: string;
  sessionId?: string | null;
  idleSince?: string | number | Date | null;
  checkpoint?: ZepiaConsolidationPayloadCheckpointInput | null;
  memoryEntities?:
    | ReadonlyArray<ZepiaConsolidationPayloadMemoryEntityInput>
    | null;
  memories?: ReadonlyArray<ZepiaConsolidationPayloadMemoryEntityInput> | null;
  toolCalls?: ReadonlyArray<ZepiaToolCallTrackingEntryInput> | null;
  toolWeights?: Readonly<Record<string, number>> | null;
  toolWeightConfigPath?: string | null;
  defaultToolWeight?: number;
}

export interface ZepiaConsolidationPayload {
  agentId: string;
  sessionId: string | null;
  idleSince: string | null;
  checkpointFound: boolean;
  checkpoint: Readonly<ConsolidationCheckpoint> | null;
  memories: ReadonlyArray<Readonly<ZepiaConsolidationPayloadMemoryRecord>>;
  toolCallTracking: Readonly<ZepiaToolCallTrackingIngestionResult>;
  checkpointSnapshot: Readonly<ZepiaConsolidationPayloadCheckpointSnapshot>;
  checkpointProvenance: Readonly<Record<string, unknown>>;
  summary: Readonly<ZepiaConsolidationPayloadSummary>;
}

export interface PromotionSelectionLongTermMemorySerializationInput {
  nodeId?: string;
  selection: Readonly<ConsolidationPromotionPlanSelection>;
  memory: YoungGenerationMemoryInput | YoungGenerationMemory | Record<string, unknown>;
  memoryId?: string;
  category?: LongTermMemoryCategory;
  content?: string;
  summary?: string | null;
  confidence?: number;
  stabilizedAt?: string | Date;
  provenance?: Record<string, unknown>;
  temporalContext?: OldGenerationTemporalContextInput | null;
  salience?: OldGenerationSalienceInput | null;
  consolidationState?: OldGenerationConsolidationStateInput | null;
  learnedTrait?: {
    label?: string;
    confidence?: number;
    provenance?: Record<string, unknown>;
  } | null;
}

export interface PromotionSelectionLongTermMemoryRewriteInput {
  selection: Readonly<ConsolidationPromotionPlanSelection>;
  memory: YoungGenerationMemoryInput | YoungGenerationMemory | Record<string, unknown>;
  rewrittenEntry:
    | SerializedLongTermMemoryEntry
    | LongTermMemoryInput
    | LongTermMemory;
}

export interface ImmutableIdentityInput {
  nodeId?: string;
  agentId: string;
  persona: string;
  role: string;
  durableMission: string;
  safetyConstraints: ReadonlyArray<string>;
  ownership: ReadonlyArray<string>;
  nonNegotiablePreferences: ReadonlyArray<string>;
  runtimeInvariants: Readonly<Record<string, unknown>>;
  protectedCoreFacts: ReadonlyArray<string>;
  provenance?: Readonly<Record<string, unknown>>;
  temporalContext?: OldGenerationTemporalContextInput | null;
  consolidationState?: OldGenerationConsolidationStateInput | null;
}

export interface ImmutableIdentity {
  readonly nodeId: string;
  readonly agentId: string;
  readonly persona: string;
  readonly role: string;
  readonly durableMission: string;
  readonly safetyConstraints: ReadonlyArray<string>;
  readonly ownership: ReadonlyArray<string>;
  readonly nonNegotiablePreferences: ReadonlyArray<string>;
  readonly runtimeInvariants: Readonly<Record<string, unknown>>;
  readonly protectedCoreFacts: ReadonlyArray<string>;
  readonly provenance: Readonly<Record<string, unknown>>;
  readonly temporalContext: DeepReadonly<OldGenerationTemporalContext>;
  readonly consolidationState: DeepReadonly<OldGenerationConsolidationState>;
}

export interface YoungGeneration {
  generation: "young";
  workingMemory: ReadonlyArray<WorkingMemory>;
  shortTermMemory: ReadonlyArray<ShortTermMemory>;
  importanceIndex: ReadonlyArray<ImportanceIndexEntry>;
}

export interface YoungGenerationGraphStateConstructionMetadata {
  agentId: string;
  savedAt: string;
  sourceGraphSchemaId: string;
  sourceGraphSchemaVersion: string;
  youngGenerationNodeKind: "young_generation";
  workingMemoryNodeKind: "working_memory";
  shortTermMemoryNodeKind: "short_term_memory";
  importanceIndexNodeKind: "importance_index";
  reconstructionMetadata: GraphStateReconstructionMetadata;
}

export interface OldGenerationGraphStateConstructionMetadata {
  agentId: string;
  savedAt: string;
  sourceGraphSchemaId: string;
  sourceGraphSchemaVersion: string;
  oldGenerationNodeKind: "old_generation";
  longTermMemoryNodeKind: "long_term_memory";
  archivedMemoryNodeKind?: "archived_memory";
  memoryEvidenceNodeKind: "memory_evidence";
  consolidationRecordNodeKind: "consolidation_record";
  immutableIdentityNodeKind: "immutable_identity";
  reconstructionMetadata: GraphStateReconstructionMetadata;
}

export interface YoungGenerationStateInput {
  generation?: "young";
  workingMemory?: ReadonlyArray<YoungGenerationMemoryInput>;
  shortTermMemory?: ReadonlyArray<YoungGenerationMemoryInput>;
  importanceIndex?: ReadonlyArray<ImportanceIndexEntryInput>;
}

export interface OldGenerationStateInput {
  generation?: "old";
  longTermMemory?: ReadonlyArray<LongTermMemoryInput>;
  archivedMemory?: ReadonlyArray<ArchivedMemoryInput>;
  memoryEvidence?: ReadonlyArray<MemoryEvidenceInput>;
  consolidationJournal?: ReadonlyArray<ConsolidationRecordInput>;
  immutableIdentity: ImmutableIdentityInput;
}

export interface YoungGenerationGraphStateExportSource {
  agentId?: string;
  youngGeneration?: YoungGeneration | YoungGenerationStateInput;
  edges?: ReadonlyArray<MemoryGraphEdge>;
  getAgentId?: () => string;
  getYoungGeneration?: () => YoungGeneration | YoungGenerationStateInput | null | undefined;
  getEdges?: () => ReadonlyArray<MemoryGraphEdge> | null | undefined;
}

export interface OldGenerationGraphStateExportSource {
  agentId?: string;
  immutableIdentity?: ImmutableIdentity | ImmutableIdentityInput;
  oldGeneration?: OldGeneration | OldGenerationStateInput;
  edges?: ReadonlyArray<MemoryGraphEdge>;
  getAgentId?: () => string;
  getImmutableIdentity?: () => ImmutableIdentity | ImmutableIdentityInput | null | undefined;
  getOldGeneration?: () => OldGeneration | OldGenerationStateInput | null | undefined;
  getEdges?: () => ReadonlyArray<MemoryGraphEdge> | null | undefined;
}

export interface OldGeneration {
  generation: "old";
  longTermMemory: ReadonlyArray<LongTermMemory>;
  archivedMemory: ReadonlyArray<ArchivedMemory>;
  memoryEvidence: ReadonlyArray<MemoryEvidence>;
  consolidationJournal: ReadonlyArray<ConsolidationRecord>;
  immutableIdentity: ImmutableIdentity;
}

export type OldGenerationNodeKind =
  | "long_term_memory"
  | "archived_memory"
  | "memory_evidence"
  | "consolidation_record"
  | "immutable_identity";

export type OldGenerationAccessMode = "retrieval" | "administrative";

export type OldGenerationRelationshipDirection =
  | "outbound"
  | "inbound"
  | "both";

export type OldGenerationNode =
  | LongTermMemory
  | ArchivedMemory
  | MemoryEvidence
  | ConsolidationRecord
  | ImmutableIdentity;

export interface OldGenerationNodeLookup {
  nodeId?: string;
  nodeKind?: OldGenerationNodeKind;
  localId?: string;
  memoryId?: string;
  archiveId?: string;
  evidenceId?: string;
  recordId?: string;
}

export interface OldGenerationAccessOptions {
  accessMode?: OldGenerationAccessMode;
}

export interface OldGenerationRelationshipWalkOptions
  extends OldGenerationAccessOptions {
  direction?: OldGenerationRelationshipDirection;
  maxDepth?: number;
  relations?: ReadonlyArray<string>;
  edgeTypes?: ReadonlyArray<string>;
  nodeKinds?: ReadonlyArray<OldGenerationNodeKind>;
  fanOutLimit?: number;
}

export interface OldGenerationRelationshipWalkStep {
  depth: number;
  traversalIndex: number;
  direction: Exclude<OldGenerationRelationshipDirection, "both">;
  edge: Readonly<OldGenerationEdge>;
  fromNode: Readonly<OldGenerationNode>;
  toNode: Readonly<OldGenerationNode>;
  relatedNode: Readonly<OldGenerationNode>;
  pathNodeIds: ReadonlyArray<string>;
  pathEdgeIds: ReadonlyArray<string>;
}

export interface OldGenerationRelationshipWalkResult {
  accessMode: OldGenerationAccessMode;
  direction: OldGenerationRelationshipDirection;
  maxDepth: number;
  fanOutLimit: number | null;
  startNode: Readonly<OldGenerationNode> | null;
  steps: ReadonlyArray<Readonly<OldGenerationRelationshipWalkStep>>;
}

export interface OldGenerationSeedExpansionStep
  extends OldGenerationRelationshipWalkStep {
  seedNodeId: string;
}

export interface OldGenerationSeedExpansionResult {
  accessMode: OldGenerationAccessMode;
  direction: OldGenerationRelationshipDirection;
  maxDepth: number;
  fanOutLimit: number | null;
  seedNodeIds: ReadonlyArray<string>;
  seedNodes: ReadonlyArray<Readonly<OldGenerationNode>>;
  discoveredNodeIds: ReadonlyArray<string>;
  discoveredNodes: ReadonlyArray<Readonly<OldGenerationNode>>;
  steps: ReadonlyArray<Readonly<OldGenerationSeedExpansionStep>>;
}

export interface PromptToSeedResolutionOptions extends OldGenerationAccessOptions {
  limit?: number;
  minimumScore?: number;
}

export interface PromptToSeedResolutionSeed {
  nodeId: string;
  memoryId: string;
  category: LongTermMemoryCategory;
  score: number;
  directScore: number;
  metadataScore: number;
  phraseScore: number;
  structuralScore: number;
  matchedTerms: ReadonlyArray<string>;
  matchedContentTerms: ReadonlyArray<string>;
  matchedMetadataTerms: ReadonlyArray<string>;
  supportingNodeIds: ReadonlyArray<string>;
}

export interface PromptToSeedResolutionResult {
  prompt: string;
  normalizedPrompt: string;
  promptTokens: ReadonlyArray<string>;
  accessMode: OldGenerationAccessMode;
  candidateCount: number;
  seedNodeIds: ReadonlyArray<string>;
  seeds: ReadonlyArray<Readonly<PromptToSeedResolutionSeed>>;
}

export interface OldGenerationRetrievalCandidateSelectionOptions
  extends PromptToSeedResolutionOptions,
    OldGenerationRelationshipWalkOptions {
  topK?: number | null;
}

export interface OldGenerationRetrievalCandidateExpansionProvenance {
  seedNodeId: string;
  seedMemoryId: string | null;
  seedRank: number | null;
  seedScore: number | null;
  depth: number;
  traversalIndex: number;
  direction: Exclude<OldGenerationRelationshipDirection, "both">;
  relation: string;
  edgeId: string;
  fromNodeId: string;
  toNodeId: string;
  pathNodeIds: ReadonlyArray<string>;
  pathEdgeIds: ReadonlyArray<string>;
}

export interface OldGenerationRetrievalCandidateOrdering {
  minDepth: number;
  seedRank: number | null;
  seedScore: number | null;
  closestSeedRank: number | null;
  closestSeedScore: number | null;
  firstTraversalIndex: number | null;
  expansionCount: number;
}

export interface OldGenerationRetrievalCandidateRanking {
  retrievalRank: number;
  pageRankRank: number;
  pageRankScore: number;
  personalizationScore: number;
}

export interface OldGenerationRetrievalCandidatePageRankEdge {
  fromNodeId: string;
  toNodeId: string;
  weight: number;
  traversalCount: number;
}

export interface OldGenerationRetrievalCandidatePageRankResult {
  dampingFactor: number;
  tolerance: number;
  maxIterations: number;
  iterations: number;
  converged: boolean;
  candidateNodeIds: ReadonlyArray<string>;
  rankedCandidateNodeIds: ReadonlyArray<string>;
  rankedCandidateMemoryIds: ReadonlyArray<string>;
  personalizationByNodeId: Readonly<Record<string, number>>;
  scoresByNodeId: Readonly<Record<string, number>>;
  edges: ReadonlyArray<Readonly<OldGenerationRetrievalCandidatePageRankEdge>>;
}

export type OldGenerationRetrievalCandidateSource =
  | "seed"
  | "expansion"
  | "seed_and_expansion";

export interface OldGenerationRetrievalCandidate {
  nodeId: string;
  memoryId: string;
  category: LongTermMemoryCategory;
  source: OldGenerationRetrievalCandidateSource;
  seed: Readonly<PromptToSeedResolutionSeed> | null;
  node: Readonly<LongTermMemory>;
  expansionProvenance: ReadonlyArray<
    Readonly<OldGenerationRetrievalCandidateExpansionProvenance>
  >;
  ordering: Readonly<OldGenerationRetrievalCandidateOrdering>;
  ranking: Readonly<OldGenerationRetrievalCandidateRanking>;
}

export interface OldGenerationRetrievalCandidateSelectionResult {
  prompt: string;
  normalizedPrompt: string;
  promptTokens: ReadonlyArray<string>;
  accessMode: OldGenerationAccessMode;
  topK: number | null;
  candidateCount: number;
  candidateNodeIds: ReadonlyArray<string>;
  candidateMemoryIds: ReadonlyArray<string>;
  rankedCandidateCount: number;
  rankedCandidateNodeIds: ReadonlyArray<string>;
  rankedCandidateMemoryIds: ReadonlyArray<string>;
  seedResolution: Readonly<PromptToSeedResolutionResult>;
  expansion: Readonly<OldGenerationSeedExpansionResult>;
  pageRank: Readonly<OldGenerationRetrievalCandidatePageRankResult> | null;
  rankedCandidates: ReadonlyArray<Readonly<OldGenerationRetrievalCandidate>>;
  candidates: ReadonlyArray<Readonly<OldGenerationRetrievalCandidate>>;
  overflowCandidates: ReadonlyArray<Readonly<OldGenerationRetrievalCandidate>>;
}

export interface MemoryGraphEdge {
  from: string;
  to: string;
  relation: string;
  edgeId?: string;
  agentId?: string;
  provenance?: Record<string, unknown>;
  temporalContext?:
    | OldGenerationTemporalContextInput
    | OldGenerationTemporalContext
    | null;
  salience?: OldGenerationSalienceInput | OldGenerationSalience | null;
  consolidationState?:
    | OldGenerationConsolidationStateInput
    | OldGenerationConsolidationState
    | null;
}

export interface OldGenerationEdgeInput {
  from: string;
  to: string;
  relation: string;
  agentId: string;
  edgeId?: string;
  provenance?: Record<string, unknown>;
  temporalContext?: OldGenerationTemporalContextInput | null;
  salience?: OldGenerationSalienceInput | null;
  consolidationState?: OldGenerationConsolidationStateInput | null;
}

export interface OldGenerationEdge extends MemoryGraphEdge {
  edgeId: string;
  agentId: string;
  provenance: Record<string, unknown>;
  temporalContext: OldGenerationTemporalContext;
  salience: OldGenerationSalience | null;
  consolidationState: OldGenerationConsolidationState;
}

export interface YoungGenerationGraphStateInput {
  schemaId: string;
  schemaVersion: string;
  constructionMetadata: YoungGenerationGraphStateConstructionMetadata;
  youngGeneration: YoungGeneration;
  edges: ReadonlyArray<MemoryGraphEdge>;
}

export interface YoungGenerationGraphState {
  schemaId: string;
  schemaVersion: string;
  constructionMetadata: YoungGenerationGraphStateConstructionMetadata;
  youngGeneration: YoungGeneration;
  edges: ReadonlyArray<MemoryGraphEdge>;
}

export interface OldGenerationGraphStateInput {
  schemaId: string;
  schemaVersion: string;
  constructionMetadata: OldGenerationGraphStateConstructionMetadata;
  oldGeneration: OldGeneration | OldGenerationStateInput;
  edges: ReadonlyArray<MemoryGraphEdge>;
}

export interface OldGenerationGraphState {
  schemaId: string;
  schemaVersion: string;
  constructionMetadata: OldGenerationGraphStateConstructionMetadata;
  oldGeneration: OldGeneration;
  edges: ReadonlyArray<MemoryGraphEdge>;
}

export interface MemoryGraphOptions {
  workingMemory?: ReadonlyArray<YoungGenerationMemoryInput>;
  shortTermMemory?: ReadonlyArray<YoungGenerationMemoryInput>;
  importanceIndex?: ReadonlyArray<ImportanceIndexEntryInput>;
  longTermMemory?: ReadonlyArray<LongTermMemoryGraphInput>;
  archivedMemory?: ReadonlyArray<ArchivedMemoryInput>;
  memoryEvidence?: ReadonlyArray<MemoryEvidenceInput>;
  consolidationJournal?: ReadonlyArray<ConsolidationRecordInput>;
  edges?: ReadonlyArray<MemoryGraphEdge>;
  reconstructionBudget?:
    | IdleWindowReconstructionBudgetInput
    | IdleWindowReconstructionBudget
    | null;
}

export interface RestoreMemoryGraphFromStorageOptions
  extends MemoryGraphOptions,
    LongTermMemoryPersistenceKeyOptions {
  storage?: LongTermMemoryPersistenceStorageAdapter;
  storageAdapter?: LongTermMemoryPersistenceStorageAdapter;
}

export interface MemoryGraphRebuildOptions extends MemoryGraphOptions {
  persistedGraphStateReconstructionMetadata?:
    | GraphStateReconstructionMetadata
    | null;
}

export interface AgentBrainMemoryGraph {
  agentId: string;
  youngGeneration: YoungGeneration;
  oldGeneration: OldGeneration;
  edges: ReadonlyArray<MemoryGraphEdge>;
}

export interface SchemaFieldDefinition {
  type: string;
  required: boolean;
  nodeKind?: string;
  itemNodeKind?: string;
  mutable?: boolean;
  identityField?: boolean;
  identityRole?: string;
  regeneration?: string;
  reassignment?: string;
  source?: string;
  values?: readonly string[];
  min?: number;
  max?: number;
  const?: true | string | boolean;
  description?: string;
  fields?: Record<string, SchemaFieldDefinition>;
  schema?: unknown;
  requiredFields?: readonly string[];
  agentScoped?: boolean;
  mergeStrategy?: string;
  allowLearnedTraits?: boolean;
}

export interface SchemaNodeDefinition {
  nodeKind: string;
  description: string;
  agentScoped?: boolean;
  mergeStrategy?: string;
  allowLearnedTraits?: boolean;
  fields: Record<string, SchemaFieldDefinition>;
}

export interface SchemaEdgeDefinition {
  relation: string;
  sourceNodeKind: string;
  targetNodeKind: string;
  description: string;
  agentScoped: boolean;
  crossAgentAllowed: boolean;
  consolidationVisible: boolean;
  idPattern?: string;
  fields?: Record<string, SchemaFieldDefinition>;
}

export interface OldGenerationAllowedEdgeCombination {
  sourceNodeKind: string;
  targetNodeKind: string;
}

export interface OldGenerationGraphRules {
  version: string;
  identityNodeKind: string;
  allowedEdgeCombinations: Record<string, OldGenerationAllowedEdgeCombination>;
  invariants: ReadonlyArray<string>;
}

export interface MemoryGraphSchema {
  schemaId: string;
  version: string;
  rootNodeKind: string;
  fields: Record<string, SchemaFieldDefinition>;
  edgeSchema?: Record<string, Record<string, SchemaEdgeDefinition>>;
  nodes: Record<string, SchemaNodeDefinition>;
}

export interface YoungGenerationGraphStateSchema {
  schemaId: string;
  version: string;
  description: string;
  fields: Record<string, SchemaFieldDefinition>;
  edgeSchema: Record<string, SchemaEdgeDefinition>;
  nodes: Record<string, SchemaNodeDefinition>;
}

export interface BrainLibraryDescription {
  name: string;
  modules: string[];
  runtimeModel: string;
}

export interface StaleMemoryWeights {
  recency: number;
  accessFrequency: number;
  retentionValue: number;
}

export interface StaleMemoryInput {
  memoryId: string;
  createdAt: string | number | Date;
  lastAccessedAt?: string | number | Date | null;
  accessCount?: number;
  retentionValue: number;
  metadata?: Record<string, unknown> | null;
}

export interface StaleMemoryBreakdown {
  recency: number;
  accessFrequency: number;
  retentionValue: number;
}

export interface StaleMemoryEvaluation {
  memoryId: string;
  createdAt: string;
  lastAccessedAt: string;
  ageMs: number;
  recencyMs: number;
  accessCount: number;
  accessFrequencyPerDay: number;
  retentionValue: number;
  staleScore: number;
  staleCandidate: boolean;
  breakdown: Readonly<StaleMemoryBreakdown>;
  reasons: ReadonlyArray<string>;
  metadata: Record<string, unknown> | null;
}

export interface StaleMemoryEvaluationOptions {
  memories: StaleMemoryInput[];
  now?: string | number | Date;
  staleThreshold?: number;
  minimumRecencyMs?: number;
  recencyHorizonMs?: number;
  accessFrequencyCapPerDay?: number;
  weights?: Partial<StaleMemoryWeights>;
}

export interface StaleMemoryEvaluationResult {
  evaluatedAt: string;
  staleThreshold: number;
  minimumRecencyMs: number;
  recencyHorizonMs: number;
  accessFrequencyCapPerDay: number;
  weights: Readonly<StaleMemoryWeights>;
  scoredMemories: ReadonlyArray<Readonly<StaleMemoryEvaluation>>;
  staleCandidates: ReadonlyArray<Readonly<StaleMemoryEvaluation>>;
  staleCandidateCount: number;
  evaluationMode: "offline-suggestion-only";
}

export interface StaleMemoryMaskingDecision {
  memoryId: string;
  memoryKind: YoungGenerationMemoryKind | null;
  staleScore: number;
  retentionValue: number;
  recencyMs: number;
  reasons: ReadonlyArray<string>;
  breakdown: Readonly<StaleMemoryBreakdown>;
  metadata: Record<string, unknown> | null;
  inactiveForRetrieval: true;
  masking: Readonly<YoungGenerationMaskingMetadata>;
}

export interface StaleMemoryMaskingDecisionOptions {
  evaluation: StaleMemoryEvaluationResult;
  maskedAt?: string | number | Date;
  maskedBy?: string;
  reason?: string;
  maskableReasons?: ReadonlyArray<string>;
  provenance?: Record<string, unknown> | null;
}

export interface StaleMemoryMaskingDecisionResult {
  sourceEvaluationAt: string;
  sourceEvaluationMode: StaleMemoryEvaluationResult["evaluationMode"];
  maskedAt: string;
  maskedBy: string;
  reason: string;
  maskableReasons: ReadonlyArray<string>;
  maskedDecisions: ReadonlyArray<Readonly<StaleMemoryMaskingDecision>>;
  maskedDecisionCount: number;
  deferredCandidates: ReadonlyArray<Readonly<StaleMemoryEvaluation>>;
  deferredCandidateCount: number;
  decisionMode: "offline-suggestion-only";
}

export interface ArchivalTransitionRuntimePhaseInput {
  value?: string;
  phase?: string;
  name?: string;
  authority?: string;
  source?: string;
  changedAt?: string | null;
  note?: string | null;
}

export interface ArchivalTransitionIdleWindowSuggestionInput {
  source?: string;
  suggestedPhase?: string;
  inactivityMs?: number;
  idleThresholdMs?: number | null;
  note?: string | null;
}

export interface IdleWindowReconstructionBudgetInput {
  idleTriggerWindowMs: number;
  reserveWindowMs?: number | null;
  reconstructionReserveWindowMs?: number | null;
}

export interface RuntimePhase {
  value: string;
  authority: string;
  changedAt: string | null;
  note: string | null;
}

export interface IdleWindowReconstructionBudget {
  source: "idle-trigger-window";
  idleTriggerWindowMs: number;
  reserveWindowMs: number;
  reconstructionBudgetMs: number;
}

export interface IdleWindowSuggestion {
  source: string;
  suggestedPhase: string;
  inactivityMs: number;
  idleThresholdMs: number | null;
  thresholdReached: boolean;
  authorizesConsolidation: false;
  note: string | null;
}

export interface ArchivalTransitionAuthorization {
  agentId: string;
  runtimePhase: RuntimePhase | null;
  inactivitySuggestion: IdleWindowSuggestion | null;
  reconstructionBudget: IdleWindowReconstructionBudget | null;
  teamIdle: boolean;
  eligible: boolean;
  opensConsolidation: boolean;
  decisionSource: "runtime-phase" | null;
  blockedReason: string | null;
  requiresOfflineExecution: true;
}

export interface IdleWindowAuthorizationOptions {
  agentId: string;
  runtimePhase?: string | ArchivalTransitionRuntimePhaseInput;
  inactivitySuggestion?: ArchivalTransitionIdleWindowSuggestionInput | null;
  idleTriggerWindowMs?: number | null;
  reserveWindowMs?: number | null;
  reconstructionReserveWindowMs?: number | null;
  teamIdle?: boolean;
}

export interface IdleWindowConsolidationAgentInput {
  agentId: string;
  runtimePhase?: string | ArchivalTransitionRuntimePhaseInput;
  inactivitySuggestion?: ArchivalTransitionIdleWindowSuggestionInput | null;
  idleTriggerWindowMs?: number | null;
  reserveWindowMs?: number | null;
  reconstructionReserveWindowMs?: number | null;
}

export interface IdleWindowConsolidationPlan {
  teamIdle: boolean;
  windowAuthority: "runtime-phase";
  eligibleAgents: ReadonlyArray<Readonly<ArchivalTransitionAuthorization>>;
  blockedAgents: ReadonlyArray<Readonly<ArchivalTransitionAuthorization>>;
  eligibleCount: number;
  blockedCount: number;
  batchWindowOpen: boolean;
}

export type OfflineConsolidationPlanBuilderRuntimeWindow = "idle" | "sleep";

export type OfflineConsolidationPlanBuilderIntensity =
  | "conservative"
  | "balanced"
  | "extended";

export type OfflineConsolidationPlanBuilderGenerationCoverage =
  | "young"
  | "old";

export type OfflineConsolidationPlanBuilderCandidateSource =
  | "young-working-memory"
  | "young-short-term-memory"
  | "old-long-term-memory"
  | "old-archived-memory";

export type OfflineConsolidationPlanBuilderPlanningGoal =
  | "mask-stale-young-memory"
  | "archive-stale-memory"
  | "promote-stable-young-memory"
  | "reinforce-old-memory"
  | "review-superseded-memory"
  | "preserve-learned-traits";

export type OfflineConsolidationPlanBuilderCoordinationHint =
  | "independent"
  | "team-idle";

export type OfflineConsolidationBatchPlanStageId =
  | "young-generation-triage"
  | "young-generation-promotion"
  | "old-generation-reinforcement"
  | "archived-memory-review"
  | "learned-trait-preservation";

export type OfflineConsolidationBatchPlanSafeOperation =
  | "offline-consolidation-young-generation-triage"
  | "offline-consolidation-young-generation-promotion"
  | "offline-consolidation-old-generation-reinforcement"
  | "offline-consolidation-archived-memory-review"
  | "offline-consolidation-learned-trait-preservation";

export interface OfflineConsolidationPlanBuilderPresetInput {
  presetId: string;
  version?: string;
  displayName: string;
  description: string;
  runtimeWindow?: OfflineConsolidationPlanBuilderRuntimeWindow;
  intensity?: OfflineConsolidationPlanBuilderIntensity;
  generationCoverage?: ReadonlyArray<OfflineConsolidationPlanBuilderGenerationCoverage>;
  candidateSources?: ReadonlyArray<OfflineConsolidationPlanBuilderCandidateSource>;
  planningGoals?: ReadonlyArray<OfflineConsolidationPlanBuilderPlanningGoal>;
  batchProfileId?: string;
  notes?: string | null;
}

export interface OfflineConsolidationPlanBuilderPreset {
  presetId: string;
  version: string;
  displayName: string;
  description: string;
  runtimeWindow: OfflineConsolidationPlanBuilderRuntimeWindow;
  intensity: OfflineConsolidationPlanBuilderIntensity;
  generationCoverage: ReadonlyArray<OfflineConsolidationPlanBuilderGenerationCoverage>;
  candidateSources: ReadonlyArray<OfflineConsolidationPlanBuilderCandidateSource>;
  planningGoals: ReadonlyArray<OfflineConsolidationPlanBuilderPlanningGoal>;
  batchProfileId: string;
  contractLayer: "plan-builder";
  outputPlanApi: "offline-batch-plan";
  authorizationModel: "runtime-phase-only";
  heuristicsPolicy: "suggest-only";
  teamCoordinationPolicy: "batch-only";
  scope: "agent-scoped";
  immutableIdentityPolicy: "runtime-invariants-only";
  learnedTraitPolicy: "long-term-memory-only";
  allowIdentityPromotion: false;
  workingLoopIsolation: "offline-decoupled";
  numericThroughputBenchmarkRequired: false;
  notes: string | null;
}

export interface OfflineConsolidationPlanBuilderPresetCatalogInput {
  catalogId?: string;
  version?: string;
  defaultPresetId?: string;
  presets?:
    | ReadonlyArray<
        | OfflineConsolidationPlanBuilderPresetInput
        | OfflineConsolidationPlanBuilderPreset
      >
    | Record<string, OfflineConsolidationPlanBuilderPresetInput | OfflineConsolidationPlanBuilderPreset>;
  presetIds?: ReadonlyArray<string>;
}

export interface OfflineConsolidationPlanBuilderPresetCatalog {
  catalogId: string;
  version: string;
  defaultPresetId: string;
  presetIds: ReadonlyArray<string>;
  presetCount: number;
  presets: Readonly<
    Record<string, Readonly<OfflineConsolidationPlanBuilderPreset>>
  >;
  contractLayer: "plan-builder";
  outputPlanApi: "offline-batch-plan";
  workingLoopIsolation: "offline-decoupled";
  numericThroughputBenchmarkRequired: false;
}

export interface OfflineConsolidationPlanBuilderRequestInput {
  requestId: string;
  version?: string;
  agentId: string;
  presetId?: string;
  preset?:
    | OfflineConsolidationPlanBuilderPresetInput
    | OfflineConsolidationPlanBuilderPreset
    | null;
  presetCatalog?:
    | OfflineConsolidationPlanBuilderPresetCatalogInput
    | OfflineConsolidationPlanBuilderPresetCatalog
    | null;
  runtimePhase?:
    | string
    | ArchivalTransitionRuntimePhaseInput
    | RuntimePhase
    | null;
  inactivitySuggestion?:
    | ArchivalTransitionIdleWindowSuggestionInput
    | IdleWindowSuggestion
    | null;
  teamIdle?: boolean;
  priorityMemoryIds?: ReadonlyArray<string | number | bigint>;
  metadata?: Record<string, unknown> | null;
}

export interface OfflineConsolidationPlanBuilderRequest {
  requestId: string;
  version: string;
  agentId: string;
  presetCatalogId: string;
  presetId: string;
  presetVersion: string;
  preset: Readonly<OfflineConsolidationPlanBuilderPreset>;
  runtimeWindow: OfflineConsolidationPlanBuilderRuntimeWindow;
  runtimePhase: RuntimePhase | null;
  inactivitySuggestion: IdleWindowSuggestion | null;
  teamIdle: boolean;
  coordinationHint: OfflineConsolidationPlanBuilderCoordinationHint;
  priorityMemoryIds: ReadonlyArray<string>;
  batchProfileId: string;
  contractLayer: "plan-builder";
  outputPlanApi: "offline-batch-plan";
  authorizationModel: "runtime-phase-only";
  heuristicsPolicy: "suggest-only";
  teamCoordinationPolicy: "batch-only";
  scope: "agent-scoped";
  immutableIdentityPolicy: "runtime-invariants-only";
  learnedTraitPolicy: "long-term-memory-only";
  allowIdentityPromotion: false;
  workingLoopIsolation: "offline-decoupled";
  numericThroughputBenchmarkRequired: false;
  metadata: Readonly<Record<string, unknown>> | null;
}

export interface OfflineConsolidationBatchPlanBuildOptions {
  planId?: string;
  batchLimit?: OfflineBatchLimitInput | OfflineBatchLimit | null;
  batchPlanMetadata?: Record<string, unknown> | null;
}

export interface OfflineConsolidationBatchPlanBuilderInput
  extends OfflineConsolidationPlanBuilderRequestInput,
    OfflineConsolidationBatchPlanBuildOptions {}

export interface OfflineConsolidationBatchPlanBuilderFromRequestInput
  extends OfflineConsolidationBatchPlanBuildOptions {
  request:
    | OfflineConsolidationPlanBuilderRequestInput
    | OfflineConsolidationPlanBuilderRequest;
}

export type OfflineConsolidationBatchPlanRequestRejectionStage =
  | "request-validation"
  | "runtime-authorization"
  | "batch-limit-validation"
  | "plan-translation"
  | "plan-validation"
  | "internal-error";

export interface OfflineConsolidationBatchPlanRequestRejection {
  stage: OfflineConsolidationBatchPlanRequestRejectionStage;
  reasonCode: string;
  blockedReason: string | null;
  message: string;
  requestId: string | null;
  agentId: string | null;
  planId: string | null;
  runtimeWindow: OfflineConsolidationPlanBuilderRuntimeWindow | null;
}

export interface ValidatedOfflineConsolidationBatchPlanRequestResult {
  status: "validated";
  safeToExecute: true;
  request: Readonly<OfflineConsolidationPlanBuilderRequest>;
  plan: Readonly<OfflineBatchPlan>;
  rejection: null;
}

export interface RejectedOfflineConsolidationBatchPlanRequestResult {
  status: "rejected";
  safeToExecute: false;
  request: Readonly<OfflineConsolidationPlanBuilderRequest> | null;
  plan: null;
  rejection: Readonly<OfflineConsolidationBatchPlanRequestRejection>;
}

export type OfflineConsolidationBatchPlanRequestResult =
  | ValidatedOfflineConsolidationBatchPlanRequestResult
  | RejectedOfflineConsolidationBatchPlanRequestResult;

export type OfflineBatchOrderingStrategy =
  | "priority-descending-then-sequence"
  | "sequence-only";

export interface OfflineBatchLimitInput {
  limitId?: string;
  targetProfile?: string;
  profile?: string;
  acceleratorClass?: string;
  orderingStrategy?: OfflineBatchOrderingStrategy;
  maxAgentsPerBatch?: number | null;
  maxWorkUnitsPerBatch?: number | null;
  maxOverwriteTargetsPerBatch?: number | null;
  maxOverwriteTargetsPerWorkUnit?: number | null;
  maxIdentityScopesPerBatch?: number | null;
  requiresRuntimeAuthorization?: true;
  heuristicsAuthorizeExecution?: false;
  teamIdleCoordinatesOnly?: true;
  identityIsolationMode?: "agent-scoped";
  requiresIndependentWrites?: true;
  executionMode?: "offline-plan-only";
  executorBinding?: "external";
  liveWorkingLoopCoupling?: "offline-decoupled";
  numericThroughputBenchmarkRequired?: false;
  notes?: string | null;
}

export interface OfflineBatchLimit {
  limitId: string;
  targetProfile: string;
  acceleratorClass: string;
  orderingStrategy: OfflineBatchOrderingStrategy;
  maxAgentsPerBatch: number | null;
  maxWorkUnitsPerBatch: number | null;
  maxOverwriteTargetsPerBatch: number | null;
  maxOverwriteTargetsPerWorkUnit: number | null;
  maxIdentityScopesPerBatch: number | null;
  requiresRuntimeAuthorization: true;
  heuristicsAuthorizeExecution: false;
  teamIdleCoordinatesOnly: true;
  identityIsolationMode: "agent-scoped";
  requiresIndependentWrites: true;
  executionMode: "offline-plan-only";
  executorBinding: "external";
  liveWorkingLoopCoupling: "offline-decoupled";
  numericThroughputBenchmarkRequired: false;
  notes: string | null;
}

export interface OfflineBatchWorkUnitInput {
  workUnitId?: string;
  unitId?: string;
  batchId?: string | null;
  agentId: string;
  operation?: string;
  coordinationSignal?: string;
  runtimePhase?:
    | string
    | ArchivalTransitionRuntimePhaseInput
    | RuntimePhase
    | null;
  identityScopeKey?: string;
  overwriteNamespace?: string;
  overwriteTargets?: ReadonlyArray<
    | string
    | number
    | bigint
    | TeamIdleConsolidationBatchOverwriteTargetInput
  >;
  order?: {
    priority?: number;
    sequence?: number;
    sortKey?: string | null;
  };
  priority?: number;
  sequence?: number;
  sortKey?: string | null;
  metadata?: Record<string, unknown> | null;
}

export interface OfflineBatchWorkUnit {
  workUnitId: string;
  batchId: string | null;
  agentId: string;
  operation: string;
  coordinationSignal: string;
  executionMode: "offline-plan-only";
  executorBinding: "external";
  liveWorkingLoopCoupling: "offline-decoupled";
  identityIsolationMode: "agent-scoped";
  identityScopeKey: string;
  overwriteNamespace: string;
  overwriteTargets: ReadonlyArray<string>;
  overwriteTargetCount: number;
  runtimePhase: string | null;
  order: Readonly<{
    priority: number;
    sequence: number;
    sortKey: string;
  }>;
  capacityCost: Readonly<{
    agentCount: 1;
    workUnitCount: 1;
    overwriteTargetCount: number;
    identityScopeCount: 1;
  }>;
  requiresRuntimeAuthorization: true;
  metadata: Readonly<Record<string, unknown>> | null;
}

export interface OfflineBatchPlanInput {
  planId: string;
  coordinationSignal?: string | null;
  limit?: OfflineBatchLimitInput | OfflineBatchLimit | null;
  workUnits?: ReadonlyArray<OfflineBatchWorkUnitInput | OfflineBatchWorkUnit>;
  metadata?: Record<string, unknown> | null;
}

export interface OfflineBatchPlan {
  planId: string;
  coordinationSignal: string;
  executionMode: "offline-plan-only";
  executorBinding: "external";
  liveWorkingLoopCoupling: "offline-decoupled";
  limit: Readonly<OfflineBatchLimit>;
  workUnits: ReadonlyArray<Readonly<OfflineBatchWorkUnit>>;
  workUnitCount: number;
  orderedWorkUnitIds: ReadonlyArray<string>;
  agentIds: ReadonlyArray<string>;
  agentCount: number;
  capacityUsage: Readonly<{
    agentCount: number;
    workUnitCount: number;
    overwriteTargetCount: number;
    identityScopeCount: number;
    maxOverwriteTargetsPerWorkUnitObserved: number;
  }>;
  capacityViolations: ReadonlyArray<string>;
  withinCapacity: boolean;
  requiresRuntimeAuthorization: true;
  heuristicsAuthorizeExecution: false;
  metadata: Readonly<Record<string, unknown>> | null;
}

export interface OfflineBatchExecutionBlockedWorkUnit {
  workUnitId: string;
  agentId: string;
  identityScopeKey: string;
  overwriteNamespace: string;
  blockedReason: string | null;
  violations: ReadonlyArray<string>;
}

export interface OfflineBatchExecutionSlice {
  sliceId: string;
  sequence: number;
  batchPlan: Readonly<OfflineBatchPlan>;
}

export interface OfflineBatchExecutionSchedule {
  planId: string;
  coordinationSignal: string;
  executionMode: "offline-external-dispatch";
  executorBinding: "caller-supplied";
  liveWorkingLoopCoupling: "offline-decoupled";
  schedulingStrategy: "ordered-slice-packing";
  limit: Readonly<OfflineBatchLimit>;
  sourcePlan: Readonly<OfflineBatchPlan>;
  sourcePlanWithinCapacity: boolean;
  sourcePlanCapacityViolations: ReadonlyArray<string>;
  scheduledWorkUnitIds: ReadonlyArray<string>;
  scheduledWorkUnitCount: number;
  blockedWorkUnits: ReadonlyArray<Readonly<OfflineBatchExecutionBlockedWorkUnit>>;
  blockedWorkUnitCount: number;
  slices: ReadonlyArray<Readonly<OfflineBatchExecutionSlice>>;
  sliceCount: number;
  executable: boolean;
  requiresRuntimeAuthorization: true;
  heuristicsAuthorizeExecution: false;
}

export type OfflineBatchExecutionAuthorizationMode =
  | "plan-runtime-phase"
  | "execution-runtime-phase";

export interface OfflineBatchExecutionContext {
  planId: string;
  coordinationSignal: string;
  schedulingStrategy: "ordered-slice-packing";
  sliceId: string;
  sliceSequence: number;
  slicePlan: Readonly<OfflineBatchPlan>;
  limit: Readonly<OfflineBatchLimit>;
  authorizationMode: OfflineBatchExecutionAuthorizationMode;
}

export interface OfflineBatchExecutionResolverContext {
  workUnit: Readonly<OfflineBatchWorkUnit>;
  slice: Readonly<OfflineBatchExecutionSlice>;
  schedule: Readonly<OfflineBatchExecutionSchedule>;
  executionContext: Readonly<OfflineBatchExecutionContext>;
}

export type OfflineBatchExecutionRuntimePhaseResolver = (
  context: OfflineBatchExecutionResolverContext,
) =>
  | string
  | ArchivalTransitionRuntimePhaseInput
  | RuntimePhase
  | null
  | Promise<
      string | ArchivalTransitionRuntimePhaseInput | RuntimePhase | null
    >;

export type OfflineBatchExecutionInactivitySuggestionResolver = (
  context: OfflineBatchExecutionResolverContext,
) =>
  | ArchivalTransitionIdleWindowSuggestionInput
  | IdleWindowSuggestion
  | null
  | Promise<
      ArchivalTransitionIdleWindowSuggestionInput | IdleWindowSuggestion | null
    >;

export interface OfflineBatchWorkUnitDispatchContext
  extends OfflineBatchExecutionContext {
  runtimePhase: Readonly<RuntimePhase> | null;
  authorization: Readonly<ArchivalTransitionAuthorization>;
}

export type OfflineBatchWorkUnitDispatcher = (
  workUnit: Readonly<OfflineBatchWorkUnit>,
  context: Readonly<OfflineBatchWorkUnitDispatchContext>,
) => unknown | Promise<unknown>;

export interface OfflineBatchExecutionOptions {
  dispatchWorkUnit?: OfflineBatchWorkUnitDispatcher;
  resolveRuntimePhase?: OfflineBatchExecutionRuntimePhaseResolver | null;
  resolveInactivitySuggestion?:
    | OfflineBatchExecutionInactivitySuggestionResolver
    | null;
  maxConcurrentWorkUnits?: number | null;
}

export interface OfflineBatchExecutionError {
  name: string;
  message: string;
}

export type OfflineBatchWorkUnitExecutionStatus =
  | "executed"
  | "blocked"
  | "failed";

export interface OfflineBatchWorkUnitExecutionResult {
  workUnitId: string;
  agentId: string;
  sliceId: string;
  sliceSequence: number;
  status: OfflineBatchWorkUnitExecutionStatus;
  authorizationMode: OfflineBatchExecutionAuthorizationMode;
  runtimePhase: string | null;
  authorization: Readonly<ArchivalTransitionAuthorization>;
  blockedReason: string | null;
  output: unknown;
  error: Readonly<OfflineBatchExecutionError> | null;
}

export type OfflineBatchExecutionStatus =
  | "blocked-by-schedule"
  | "completed"
  | "completed-with-blocked-work-units"
  | "completed-with-errors";

export interface OfflineBatchExecutionResult {
  planId: string;
  status: OfflineBatchExecutionStatus;
  authorizationMode: OfflineBatchExecutionAuthorizationMode;
  schedule: Readonly<OfflineBatchExecutionSchedule>;
  results: ReadonlyArray<Readonly<OfflineBatchWorkUnitExecutionResult>>;
  dispatchedCount: number;
  executedCount: number;
  blockedCount: number;
  failedCount: number;
}

export interface TeamIdleConsolidationBatchIdentityScopeInput {
  agentId?: string | null;
  persona?: string | null;
  role?: string | null;
}

export interface TeamIdleConsolidationBatchIdentityScope {
  agentId: string;
  persona: string | null;
  role: string | null;
}

export interface TeamIdleConsolidationBatchOverwriteTargetInput {
  scope?: string;
  kind?: string;
  targetId?: string | number | bigint;
  memoryId?: string | number | bigint;
  archiveId?: string | number | bigint;
  recordId?: string | number | bigint;
  key?: string | number | bigint;
  agentId?: string | null;
}

export interface TeamIdleConsolidationBatchOverwriteTarget {
  scope: string;
  targetId: string;
  agentId: string;
}

export interface TeamIdleConsolidationBatchAgentInput
  extends IdleWindowConsolidationAgentInput {
  identityScope?: TeamIdleConsolidationBatchIdentityScopeInput | null;
  overwriteTargets?: ReadonlyArray<TeamIdleConsolidationBatchOverwriteTargetInput>;
}

export interface TeamIdleConsolidationBatchAgentPlan {
  agentId: string;
  authorization: Readonly<ArchivalTransitionAuthorization>;
  identityScope: Readonly<TeamIdleConsolidationBatchIdentityScope>;
  identityIsolationKey: string;
  sharedIdentity: false;
  overwriteNamespace: string;
  overwriteTargets: ReadonlyArray<Readonly<TeamIdleConsolidationBatchOverwriteTarget>>;
  safetyViolations: ReadonlyArray<string>;
  batchEligible: boolean;
  blockedReason: string | null;
  requiresIndependentWrites: true;
}

export interface TeamIdleConsolidationBatchGroup {
  batchId: string;
  coordinationSignal: "team-idle" | "independent";
  executionMode: "offline-independent";
  isolationMode: "agent-scoped";
  writeIsolationMode: "agent-scoped";
  agentIds: ReadonlyArray<string>;
  agents: ReadonlyArray<Readonly<TeamIdleConsolidationBatchAgentPlan>>;
  batchPlan: Readonly<OfflineBatchPlan>;
}

export interface TeamIdleConsolidationBatchPlan {
  teamIdle: boolean;
  coordinationSignal: "team-idle" | "independent";
  windowAuthority: "runtime-phase";
  defaultBatchLimit: Readonly<OfflineBatchLimit>;
  eligibleAgents: ReadonlyArray<Readonly<TeamIdleConsolidationBatchAgentPlan>>;
  blockedAgents: ReadonlyArray<Readonly<TeamIdleConsolidationBatchAgentPlan>>;
  eligibleCount: number;
  blockedCount: number;
  batchWindowOpen: boolean;
  batchCount: number;
  batches: ReadonlyArray<Readonly<TeamIdleConsolidationBatchGroup>>;
}

export interface ArchivalTransitionCandidate {
  memoryId: string;
  originalGeneration: ArchivedMemorySourceGeneration;
  originalMemoryKind: ArchivedMemorySourceMemoryKind;
  sourceCollection: "workingMemory" | "shortTermMemory" | "longTermMemory";
  sourceNodeId: string | null;
  staleScore: number;
  retentionValue: number;
  recencyMs: number;
  reasons: ReadonlyArray<string>;
  breakdown: Readonly<StaleMemoryBreakdown>;
  metadata: Record<string, unknown> | null;
}

export interface ArchivalTransitionDeferredCandidate {
  memoryId: string;
  originalGeneration: ArchivedMemorySourceGeneration | null;
  originalMemoryKind: ArchivedMemorySourceMemoryKind | null;
  sourceCollection:
    | "workingMemory"
    | "shortTermMemory"
    | "longTermMemory"
    | null;
  sourceNodeId: string | null;
  staleScore: number;
  retentionValue: number;
  recencyMs: number;
  reasons: ReadonlyArray<string>;
  breakdown: Readonly<StaleMemoryBreakdown>;
  metadata: Record<string, unknown> | null;
  deferredReason: string;
}

export interface ArchivalTransitionAppliedMemory
  extends ArchivalTransitionCandidate {
  archiveId: string;
  archivedMemory: Readonly<ArchivedMemory>;
  detachedEdgeCount: number;
  detachedImportanceEntryCount: number;
}

export interface ArchivalTransitionOptions
  extends LongTermMemoryPersistenceKeyOptions {
  evaluation: StaleMemoryEvaluationResult;
  runtimePhase?: string | ArchivalTransitionRuntimePhaseInput;
  archivedAt?: string | number | Date;
  archivedBy?: string;
  archivalReason?: string;
  archivableReasons?: ReadonlyArray<string>;
  policyVersion?: string | null;
  teamIdle?: boolean;
  inactivitySuggestion?: ArchivalTransitionIdleWindowSuggestionInput | null;
  provenance?: Record<string, unknown> | null;
  storage?: LongTermMemoryPersistenceStorageAdapter;
  storageAdapter?: LongTermMemoryPersistenceStorageAdapter;
}

export interface ArchivalTransitionResult {
  agentId: string;
  sourceEvaluationAt: string;
  sourceEvaluationMode: StaleMemoryEvaluationResult["evaluationMode"];
  archivedAt: string;
  archivedBy: string;
  archivalReason: string;
  archivableReasons: ReadonlyArray<string>;
  authorization: Readonly<ArchivalTransitionAuthorization>;
  archivableCandidates: ReadonlyArray<Readonly<ArchivalTransitionCandidate>>;
  archivableCandidateCount: number;
  archivedTransitions: ReadonlyArray<Readonly<ArchivalTransitionAppliedMemory>>;
  archivedCount: number;
  persistedDeletes: ReadonlyArray<Readonly<DeleteLongTermMemoryEntryResult>>;
  persistedDeleteCount: number;
  deferredCandidates: ReadonlyArray<Readonly<ArchivalTransitionDeferredCandidate>>;
  deferredCount: number;
  applied: boolean;
  nextGraph: Readonly<AgentBrainMemoryGraph>;
}

export type Gemma4B200ElectricSafeRuntimeTransport =
  | "rpc"
  | "grpc"
  | "connect-rpc"
  | "http-rpc"
  | "unix-socket-rpc";

export type Gemma4B200ElectricWorkerOperation =
  | "embedding-generation"
  | "memory-candidate-reranking"
  | "hippocampus-summary-distillation"
  | "near-duplicate-clustering"
  | "stale-memory-detection"
  | "contradiction-screening";

export interface Gemma4B200ElectricConsolidationPlanInput {
  planId?: string | null;
  streamIds?: ReadonlyArray<string> | null;
  postgresTables?: ReadonlyArray<string> | null;
  runtimeBoundary?: {
    transport?: Gemma4B200ElectricSafeRuntimeTransport | null;
    zepiaToBrainUsesRdma?: false | null;
  } | null;
  electric?: {
    streamIds?: ReadonlyArray<string> | null;
    postgresTables?: ReadonlyArray<string> | null;
  } | null;
  model?: {
    modelFamily?: "gemma-4" | null;
  } | null;
  accelerator?: {
    acceleratorClass?: "b200" | null;
  } | null;
  workerPipeline?: {
    operations?: ReadonlyArray<Gemma4B200ElectricWorkerOperation> | null;
  } | null;
  writePath?: {
    electricOwnsWrites?: false | null;
    durableWriter?: string | null;
  } | null;
}

export interface Gemma4B200ElectricConsolidationPlan {
  schemaId: "gemma4_b200_electric_consolidation_plan";
  schemaVersion: "1.0.0";
  planId: string;
  purpose: string;
  runtimeBoundary: Readonly<{
    transport: Gemma4B200ElectricSafeRuntimeTransport;
    zepiaToBrainUsesRdma: false;
    authority: "caller-authorized-offline-window";
    authorizedRuntimePhases: ReadonlyArray<"idle" | "rest" | "break" | "sleep">;
  }>;
  electric: Readonly<{
    role: "durable-stream-and-read-sync-plane";
    streamProtocol: "http-append-only-offset-stream";
    syncPrimitive: "postgres-shape-read-sync";
    streamIds: ReadonlyArray<string>;
    postgresTables: ReadonlyArray<string>;
  }>;
  model: Readonly<{
    modelFamily: "gemma-4";
    servingRole: "local-private-memory-intelligence";
    expectedCapabilities: ReadonlyArray<string>;
  }>;
  accelerator: Readonly<{
    acceleratorClass: "b200";
    placement: "offline-worker-pool";
    rdmaScope: "inside-brain-worker-pool-only";
  }>;
  identityIsolation: Readonly<{
    mode: "agent-scoped";
    teamIdleMergesIdentity: false;
    overwriteNamespace: "agent-scoped";
    requiresIndependentWrites: true;
  }>;
  workerPipeline: Readonly<{
    executionMode: "offline-plan-only";
    liveWorkingLoopCoupling: "offline-decoupled";
    operations: ReadonlyArray<Gemma4B200ElectricWorkerOperation>;
  }>;
  checkpointPolicy: Readonly<{
    cursorScope: "agentId+syncSource+streamId";
    advanceAfterDurableWrite: true;
    failedConsolidationAdvancesCheckpoint: false;
    replayPreference: "replay-is-safer-than-gap";
  }>;
  writePath: Readonly<{
    electricOwnsWrites: false;
    durableWriter: string;
    syncAfterWrite: "postgres-logical-replication-to-electric-shapes";
  }>;
}

export type ElectricEventOffset = string | number;

export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | ReadonlyArray<JsonValue> | { readonly [key: string]: JsonValue };

export interface ElectricStreamEventInput {
  agentId: string;
  syncSource?: string | null;
  streamId: string;
  offset: ElectricEventOffset;
  eventType?: string | null;
  type?: string | null;
  payload?: JsonValue;
  observedAt?: string | null;
}

export interface ElectricEventIngestionOptions {
  syncSource?: string | null;
  observedAt?: string | null;
  durableWriteResult?: unknown;
}

export interface NormalizedElectricBrainEventRow {
  agentId: string;
  syncSource: string;
  streamId: string;
  offset: ElectricEventOffset;
  eventType: string;
  payload: JsonValue;
  observedAt: string | null;
}

export interface ElectricCheckpointIntent {
  agentId: string;
  syncSource: string;
  streamId: string;
  fromOffset: ElectricEventOffset;
  toOffset: ElectricEventOffset;
  status: "pending" | "committable";
  committable: boolean;
  durableWriteResult: unknown | null;
}

export interface ElectricEventIngestionResult {
  rows: ReadonlyArray<Readonly<NormalizedElectricBrainEventRow>>;
  checkpointIntents: ReadonlyArray<Readonly<ElectricCheckpointIntent>>;
}

export type ElectricPostgresShapeTable =
  | "agent_events"
  | "memory_candidates"
  | "short_term_memory"
  | "tool_calls"
  | "long_term_memory"
  | "consolidation_jobs"
  | "consolidation_runs"
  | "stream_checkpoints";

export type ElectricPostgresShapeAccessScope = "agent" | "session" | "service";

export interface ElectricPostgresShapeContractEntry {
  shapeName: string;
  table: ElectricPostgresShapeTable;
  whereTemplate: string;
  parameters: ReadonlyArray<string>;
  accessScope: ElectricPostgresShapeAccessScope;
  exposure?: "backend-only";
  requiresServiceAuthorization?: true;
}

export interface ElectricPostgresShapeContract {
  schemaId: "agent_brain_electric_postgres_shape_contract";
  schemaVersion: "1.0.0";
  description: string;
  readSyncPlane: "electric-postgres-shapes";
  writeAuthority: false;
  shapes: ReadonlyArray<Readonly<ElectricPostgresShapeContractEntry>>;
}

export const MEMORY_NODE_KINDS: Readonly<{
  root: "agent_brain";
  youngGeneration: "young_generation";
  oldGeneration: "old_generation";
  workingMemory: "working_memory";
  shortTermMemory: "short_term_memory";
  importanceIndex: "importance_index";
  longTermMemory: "long_term_memory";
  archivedMemory: "archived_memory";
  memoryEvidence: "memory_evidence";
  consolidationRecord: "consolidation_record";
  immutableIdentity: "immutable_identity";
}>;

export const YOUNG_GENERATION_MEMORY_LIFECYCLE_STATES: ReadonlyArray<
  YoungGenerationMemoryLifecycleState
>;

export const BRAIN_LIBRARY_NAME: "@zep/brain";
export const BRAIN_LIBRARY_MODULES: ReadonlyArray<
  "memory-graph" | "consolidation" | "batch-planning" | "identity-guard"
>;
export const OFFLINE_CONSOLIDATION_PLAN_BUILDER_RUNTIME_WINDOWS: ReadonlyArray<
  OfflineConsolidationPlanBuilderRuntimeWindow
>;
export const OFFLINE_CONSOLIDATION_PLAN_BUILDER_INTENSITIES: ReadonlyArray<
  OfflineConsolidationPlanBuilderIntensity
>;
export const OFFLINE_CONSOLIDATION_PLAN_BUILDER_GENERATION_COVERAGE: ReadonlyArray<
  OfflineConsolidationPlanBuilderGenerationCoverage
>;
export const OFFLINE_CONSOLIDATION_PLAN_BUILDER_CANDIDATE_SOURCES: ReadonlyArray<
  OfflineConsolidationPlanBuilderCandidateSource
>;
export const OFFLINE_CONSOLIDATION_PLAN_BUILDER_PLANNING_GOALS: ReadonlyArray<
  OfflineConsolidationPlanBuilderPlanningGoal
>;
export const OFFLINE_CONSOLIDATION_BATCH_PLAN_STAGE_IDS: ReadonlyArray<
  OfflineConsolidationBatchPlanStageId
>;
export const OFFLINE_CONSOLIDATION_BATCH_PLAN_SAFE_OPERATIONS: Readonly<
  Record<
    OfflineConsolidationBatchPlanStageId,
    OfflineConsolidationBatchPlanSafeOperation
  >
>;
export const DEFAULT_OFFLINE_CONSOLIDATION_PLAN_BUILDER_PRESET_ID: "idle-balanced-consolidation";
export const DEFAULT_OFFLINE_CONSOLIDATION_PLAN_BUILDER_PRESET_CATALOG: Readonly<OfflineConsolidationPlanBuilderPresetCatalog>;
export const OFFLINE_CONSOLIDATION_PLAN_BUILDER_PRESET_IDS: ReadonlyArray<string>;
export const OFFLINE_BATCH_ORDERING_STRATEGIES: ReadonlyArray<OfflineBatchOrderingStrategy>;
export const DEFAULT_OFFLINE_BATCH_ORDERING_STRATEGY: "priority-descending-then-sequence";
export const DEFAULT_B200_OFFLINE_BATCH_LIMIT: Readonly<OfflineBatchLimit>;
export const GEMMA4_B200_ELECTRIC_PLAN_SCHEMA_ID: "gemma4_b200_electric_consolidation_plan";
export const GEMMA4_B200_ELECTRIC_SAFE_RUNTIME_TRANSPORTS: ReadonlyArray<Gemma4B200ElectricSafeRuntimeTransport>;
export const GEMMA4_B200_ELECTRIC_WORKER_OPERATIONS: ReadonlyArray<Gemma4B200ElectricWorkerOperation>;
export function createGemma4B200ElectricConsolidationPlan(
  options?: Gemma4B200ElectricConsolidationPlanInput,
): Readonly<Gemma4B200ElectricConsolidationPlan>;
export function ingestElectricEventBatch(
  events: ReadonlyArray<ElectricStreamEventInput>,
  options?: ElectricEventIngestionOptions,
): Readonly<ElectricEventIngestionResult>;
export const ELECTRIC_POSTGRES_SHAPE_CONTRACT_SCHEMA_ID: "agent_brain_electric_postgres_shape_contract";
export function createElectricPostgresShapeContract(): Readonly<ElectricPostgresShapeContract>;
export const PROTECTED_IDENTITY_FIELDS: ReadonlyArray<
  | "agentId"
  | "persona"
  | "role"
  | "durableMission"
  | "safetyConstraints"
  | "ownership"
  | "nonNegotiablePreferences"
  | "runtimeInvariants"
  | "protectedCoreFacts"
>;

export const LONG_TERM_MEMORY_CATEGORIES: ReadonlyArray<LongTermMemoryCategory>;
export const MEMORY_EVIDENCE_KINDS: ReadonlyArray<MemoryEvidenceKind>;
export const CONSOLIDATION_OPERATIONS: ReadonlyArray<ConsolidationOperation>;
export const OLD_GENERATION_CONSOLIDATION_STATES: ReadonlyArray<OldGenerationConsolidationStateStatus>;
export const ARCHIVED_MEMORY_SOURCE_GENERATIONS: ReadonlyArray<ArchivedMemorySourceGeneration>;
export const ARCHIVED_MEMORY_SOURCE_MEMORY_KINDS: ReadonlyArray<ArchivedMemorySourceMemoryKind>;
export const YOUNG_GENERATION_MEMORY_KINDS: ReadonlyArray<YoungGenerationMemoryKind>;
export const CONSOLIDATION_SIGNAL_DIMENSIONS: ReadonlyArray<ConsolidationSignalDimension>;
export const CONSOLIDATION_SIGNAL_GENERATIONS: ReadonlyArray<ConsolidationSignalGeneration>;
export const OLD_GENERATION_NODE_KINDS: ReadonlyArray<
  | "long_term_memory"
  | "archived_memory"
  | "memory_evidence"
  | "consolidation_record"
  | "immutable_identity"
>;
export const OLD_GENERATION_ALLOWED_EDGE_COMBINATIONS: Readonly<
  Record<string, OldGenerationAllowedEdgeCombination>
>;
export const OLD_GENERATION_GRAPH_INVARIANTS: ReadonlyArray<string>;
export const OLD_GENERATION_GRAPH_RULES: Readonly<OldGenerationGraphRules>;
export const OLD_GENERATION_ACCESS_MODES: ReadonlyArray<OldGenerationAccessMode>;
export const OLD_GENERATION_RELATIONSHIP_DIRECTIONS: ReadonlyArray<OldGenerationRelationshipDirection>;
export const MEMORY_ITEM_IDENTITY_SCHEMA: Readonly<MemoryItemIdentitySchema>;
export const CONSOLIDATION_PIPELINE_ABORT_STAGES: ReadonlyArray<ConsolidationPipelineAbortStage>;
export const CONSOLIDATION_PIPELINE_ABORT_REASONS: ReadonlyArray<ConsolidationPipelineAbortReason>;
export const CONSOLIDATION_IDENTITY_PRESERVATION_INVARIANT: Readonly<{
  invariantId: "agent-scoped-canonical-id-preservation";
  version: "1.0.0";
  description: string;
  protectedCanonicalFields: ReadonlyArray<"agentId" | "memoryId" | "nodeId">;
  stages: ReadonlyArray<ConsolidationPipelineAbortStage>;
  abortReason: "canonical-id-mutation";
  safeAction: "abort-offline-pipeline-before-write";
}>;
export const CONSOLIDATION_PIPELINE_ABORT_CONTRACT: Readonly<{
  version: "1.0.0";
  invariantId: "agent-scoped-canonical-id-preservation";
  reasons: ReadonlyArray<ConsolidationPipelineAbortReason>;
  stages: ReadonlyArray<ConsolidationPipelineAbortStage>;
  safeAction: "abort-offline-pipeline-before-write";
}>;
export const OLD_GENERATION_IDENTIFIER_SCHEMA: Readonly<{
  version: "1.0.0";
  delimiter: "/";
  identityLocalId: "self";
  memoryItemStableIdField: "memoryId";
  nodeIdPattern: string;
  edgeIdPattern: string;
  nodeKinds: Record<
    | "longTermMemory"
    | "archivedMemory"
    | "memoryEvidence"
    | "consolidationRecord"
    | "immutableIdentity",
    Readonly<{
      nodeKind: string;
      localIdField: string;
      example: string;
    }>
  >;
}>;
export const OLD_GENERATION_TEMPORAL_CONTEXT_SCHEMA: Readonly<SchemaFieldDefinition>;
export const OLD_GENERATION_SALIENCE_SCHEMA: Readonly<SchemaFieldDefinition>;
export const OLD_GENERATION_CONSOLIDATION_STATE_SCHEMA: Readonly<SchemaFieldDefinition>;
export const OLD_GENERATION_EDGE_FIELDS: Readonly<Record<string, SchemaFieldDefinition>>;
export const IMMUTABLE_IDENTITY_SCHEMA: Readonly<SchemaNodeDefinition>;
export const YOUNG_GENERATION_MASKED_CONTENT_SCHEMA: Readonly<SchemaFieldDefinition>;
export const YOUNG_GENERATION_MASKING_AUDIT_SCHEMA: Readonly<SchemaFieldDefinition>;
export const YOUNG_GENERATION_MASKING_SCHEMA: Readonly<SchemaFieldDefinition>;
export const YOUNG_GENERATION_MEMORY_RECORD_SCHEMA: Readonly<SchemaFieldDefinition>;
export const YOUNG_GENERATION_MEMORY_SCHEMA_FIELDS: Readonly<
  Record<string, SchemaFieldDefinition>
>;
export const WORKING_MEMORY_SCHEMA: Readonly<SchemaNodeDefinition>;
export const SHORT_TERM_MEMORY_SCHEMA: Readonly<SchemaNodeDefinition>;
export const IMPORTANCE_INDEX_SCHEMA: Readonly<SchemaNodeDefinition>;
export const CONSOLIDATION_SIGNAL_CAPTURE_SCHEMA: Readonly<{
  description: string;
  fields: Record<string, SchemaFieldDefinition>;
}>;
export const CONSOLIDATION_GENERATION_SIGNAL_SET_SCHEMA: Readonly<{
  description: string;
  fields: Record<string, SchemaFieldDefinition>;
}>;
export const CONSOLIDATION_PROMOTION_INPUT_SCHEMA: Readonly<{
  schemaId: "agent_brain_consolidation_promotion_input";
  version: "1.0.0";
  description: string;
  fields: Record<string, SchemaFieldDefinition>;
}>;
export const CONSOLIDATION_PROMOTION_POLICY_SCHEMA: Readonly<{
  schemaId: "agent_brain_consolidation_promotion_policy";
  version: "1.0.0";
  description: string;
  fields: Record<string, SchemaFieldDefinition>;
}>;
export const OFFLINE_CONSOLIDATION_PLAN_BUILDER_REQUEST_SCHEMA: Readonly<{
  schemaId: "agent_brain_offline_consolidation_request";
  version: "1.0.0";
  description: string;
  fields: Record<string, SchemaFieldDefinition>;
}>;
export const LONG_TERM_MEMORY_SCHEMA: Readonly<SchemaNodeDefinition>;
export const LONG_TERM_MEMORY_PERSISTENCE_REQUIRED_CONTENT_FIELDS: ReadonlyArray<
  keyof LongTermMemoryPersistenceContent
>;
export const LONG_TERM_MEMORY_PERSISTENCE_REQUIRED_METADATA_FIELDS: ReadonlyArray<
  Exclude<keyof LongTermMemoryPersistenceMetadata, "learnedTrait">
>;
export const LONG_TERM_MEMORY_RECORD_CONTRACT: Readonly<{
  schemaId: "agent_brain_long_term_memory_entry";
  version: "1.0.0";
  nodeKind: "long_term_memory";
  requiredContentFields: ReadonlyArray<keyof LongTermMemoryPersistenceContent>;
  requiredMetadataFields: ReadonlyArray<
    Exclude<keyof LongTermMemoryPersistenceMetadata, "learnedTrait">
  >;
  optionalMetadataFields: ReadonlyArray<"learnedTrait">;
  learnedTraitCategoryRequiresMetadata: true;
  learnedTraitsRemainProtectedFromIdentityPromotion: true;
}>;
export const DEFAULT_LONG_TERM_MEMORY_PERSISTENCE_KEY_PREFIX: "agent-brain/long-term-memory";
export const LONG_TERM_MEMORY_PERSISTENCE_SCHEMA: Readonly<{
  schemaId: "agent_brain_long_term_memory_entry";
  version: "1.0.0";
  description: string;
  fields: Record<string, SchemaFieldDefinition>;
}>;
export const LONG_TERM_MEMORY_LOGICAL_IDENTITY_MATCH_SCHEMA: Readonly<{
  version: "1.0.0";
  description: string;
  exactMatchFields: ReadonlyArray<
    | "agentId"
    | "category"
    | "content"
    | "summary"
    | "lineageMemoryIds"
    | "learnedTraitLabel"
  >;
  excludedMutableFields: ReadonlyArray<string>;
  notes: ReadonlyArray<string>;
}>;
export const CONSOLIDATION_CHECKPOINT_REQUIRED_CURSOR_FIELDS: ReadonlyArray<
  keyof ConsolidationCheckpointCursor
>;
export const CONSOLIDATION_CHECKPOINT_RECORD_CONTRACT: Readonly<{
  schemaId: "agent_brain_consolidation_checkpoint";
  version: "1.0.0";
  recordType: "consolidation_checkpoint";
  requiredFields: ReadonlyArray<
    "agentId" | "syncSource" | "cursor" | "consolidatedAt"
  >;
  requiredCursorFields: ReadonlyArray<keyof ConsolidationCheckpointCursor>;
  requiresResumePosition: true;
}>;
export const DEFAULT_CONSOLIDATION_CHECKPOINT_KEY_PREFIX: "agent-brain/consolidation-checkpoints";
export const CONSOLIDATION_CHECKPOINT_SCHEMA: Readonly<{
  schemaId: "agent_brain_consolidation_checkpoint";
  version: "1.0.0";
  description: string;
  fields: Record<string, SchemaFieldDefinition>;
}>;
export const ARCHIVED_MEMORY_SCHEMA: Readonly<SchemaNodeDefinition>;
export const MEMORY_EVIDENCE_SCHEMA: Readonly<SchemaNodeDefinition>;
export const CONSOLIDATION_RECORD_SCHEMA: Readonly<SchemaNodeDefinition>;
export const YOUNG_GENERATION_EDGE_SCHEMA: Readonly<
  Record<
    | "workingMemoryReference"
    | "workingToShortTermCapture"
    | "importanceToWorkingMemory"
    | "importanceToShortTermMemory"
    | "shortTermRecall"
    | "shortTermAssociation",
    SchemaEdgeDefinition
  >
>;
export const OLD_GENERATION_EDGE_SCHEMA: Readonly<
  Record<
    | "memoryAssociation"
    | "supportedByEvidence"
    | "createdByConsolidation"
    | "supersedes",
    SchemaEdgeDefinition
  >
>;
export const OLD_GENERATION_DOMAIN_SCHEMA: Readonly<SchemaNodeDefinition>;
export const MEMORY_GRAPH_SCHEMA: Readonly<MemoryGraphSchema>;
export const YOUNG_GENERATION_GRAPH_STATE_SCHEMA: Readonly<YoungGenerationGraphStateSchema>;
export const OLD_GENERATION_GRAPH_STATE_SCHEMA: Readonly<{
  schemaId: "agent_brain_old_generation_graph_state";
  version: "1.0.0";
  description: string;
  fields: Record<string, SchemaFieldDefinition>;
  nodes: Record<string, SchemaNodeDefinition>;
  edgeSchema: Record<string, SchemaEdgeDefinition>;
}>;
export const HIPPOCAMPUS_SECRET_BOUNDARY_DIRECTIONS: ReadonlyArray<
  HippocampusBoundaryDirection
>;
export const HIPPOCAMPUS_SECRET_DETECTOR_IDS: ReadonlyArray<string>;
export const DEFAULT_HIPPOCAMPUS_SECRET_REDACTION_POLICY: Readonly<
  HippocampusSecretRedactionPolicy
>;
export const DEFAULT_STALE_MEMORY_WEIGHTS: Readonly<StaleMemoryWeights>;
export const DEFAULT_CONSOLIDATION_PROMOTION_POLICY: Readonly<ConsolidationPromotionPolicy>;

export function isConsolidationPipelineAbortError(
  value: unknown,
): value is ConsolidationPipelineAbortError;

export function isMemoryGraphReconstructionDeferredError(
  value: unknown,
): value is MemoryGraphReconstructionDeferredError;

export function createImmutableIdentity(
  input: ImmutableIdentityInput,
): Readonly<ImmutableIdentity>;

export function createOldGenerationNodeId(
  nodeKind: string,
  agentId: string,
  localId: string,
): string;

export function createOldGenerationEdgeId(input: {
  agentId: string;
  relation: string;
  from: string;
  to: string;
}): string;

export function createOldGenerationTemporalContext(
  input?: OldGenerationTemporalContextInput | null,
  fallback?: OldGenerationTemporalContextInput | null,
): Readonly<OldGenerationTemporalContext>;

export function createOldGenerationSalience(
  input?: OldGenerationSalienceInput | null,
  fallbackScore?: number | null,
): Readonly<OldGenerationSalience> | null;

export function createOldGenerationConsolidationState(
  input?: OldGenerationConsolidationStateInput | null,
  defaults?: OldGenerationConsolidationStateInput | null,
): Readonly<OldGenerationConsolidationState>;

export function createOldGenerationEdge(
  input: OldGenerationEdgeInput,
): Readonly<OldGenerationEdge>;

export function createLongTermMemory(
  input: LongTermMemoryInput,
): Readonly<LongTermMemory>;

export function serializePromotionSelectionToLongTermMemoryEntry(
  input: PromotionSelectionLongTermMemorySerializationInput,
): Readonly<SerializedLongTermMemoryEntry>;

export function rewritePromotionSelectionToLongTermMemoryEntry(
  input: PromotionSelectionLongTermMemoryRewriteInput,
): Readonly<SerializedLongTermMemoryEntry>;

export function serializeLongTermMemoryEntry(
  input:
    | LongTermMemoryInput
    | LongTermMemory
    | PromotionSelectionLongTermMemorySerializationInput
    | PromotionSelectionLongTermMemoryRewriteInput,
): Readonly<SerializedLongTermMemoryEntry>;

export function deserializeLongTermMemoryEntry(
  entry: LongTermMemoryPersistenceReadableEntryInput,
): Readonly<LongTermMemory>;

export function createLongTermMemoryLogicalIdentity(
  input: LongTermMemoryLogicalIdentityRecordInput,
): Readonly<LongTermMemoryLogicalIdentity>;

export function matchLongTermMemoryLogicalIdentity(
  records: ReadonlyArray<LongTermMemoryLogicalIdentityRecordInput>,
  input: LongTermMemoryLogicalIdentityRecordInput,
): Readonly<LongTermMemoryLogicalIdentityMatchResult>;

export function createLongTermMemoryPersistenceRecordName(
  input: LongTermMemoryPersistenceWritableEntryInput,
): string;

export function createLongTermMemoryPersistenceKey(
  input: LongTermMemoryPersistenceWritableEntryInput,
  options?: LongTermMemoryPersistenceKeyOptions | null,
): string;

export function serializeLongTermMemoryPersistenceStorageRecord(
  input: LongTermMemoryPersistenceWritableEntryInput,
  options?: LongTermMemoryPersistenceKeyOptions | null,
): Readonly<LongTermMemoryPersistenceStorageRecord>;

export function persistLongTermMemoryEntry(
  input: PersistLongTermMemoryEntryInput,
): Promise<Readonly<PersistLongTermMemoryEntryResult>>;

export function deleteLongTermMemoryEntry(
  input: DeleteLongTermMemoryEntryInput,
): Promise<Readonly<DeleteLongTermMemoryEntryResult>>;

export function persistPromotionSelectionToLongTermMemory(
  graph: AgentBrainMemoryGraph,
  input: PersistPromotionSelectionToLongTermMemoryInput,
): Promise<Readonly<PersistPromotionSelectionToLongTermMemoryResult>>;

export function createConsolidationCheckpoint(
  input: ConsolidationCheckpointInput,
): Readonly<ConsolidationCheckpoint>;

export function serializeConsolidationCheckpointEntry(
  input: ConsolidationCheckpointWritableEntryInput,
): Readonly<SerializedConsolidationCheckpointEntry>;

export function deserializeConsolidationCheckpointEntry(
  entry: ConsolidationCheckpointReadableEntryInput,
): Readonly<ConsolidationCheckpoint>;

export function createConsolidationCheckpointRecordName(
  input: ConsolidationCheckpointKeyInput,
): string;

export function createConsolidationCheckpointKey(
  input: ConsolidationCheckpointKeyInput,
  options?: ConsolidationCheckpointKeyOptions | null,
): string;

export function serializeConsolidationCheckpointStorageRecord(
  input: ConsolidationCheckpointWritableEntryInput,
  options?: ConsolidationCheckpointKeyOptions | null,
): Readonly<ConsolidationCheckpointStorageRecord>;

export function persistConsolidationCheckpoint(
  input: PersistConsolidationCheckpointInput,
): Promise<Readonly<PersistConsolidationCheckpointResult>>;

export function persistCompletedConsolidationCheckpoint(
  input: PersistCompletedConsolidationCheckpointInput,
): Promise<Readonly<PersistConsolidationCheckpointResult>>;

export function readConsolidationCheckpoint(
  input: ReadConsolidationCheckpointInput,
): Promise<Readonly<ReadConsolidationCheckpointResult>>;

export function resolveConsolidationRpcChangeWindow(
  input: ResolveConsolidationRpcChangeWindowInput,
): Promise<Readonly<ResolveConsolidationRpcChangeWindowResult>>;

export function createArchivedMemory(
  input: ArchivedMemoryInput,
): Readonly<ArchivedMemory>;

export function createMemoryEvidence(
  input: MemoryEvidenceInput,
): Readonly<MemoryEvidence>;

export function createConsolidationRecord(
  input: ConsolidationRecordInput,
): Readonly<ConsolidationRecord>;

export function validateOldGenerationGraph(
  graph: AgentBrainMemoryGraph,
): true;

export function createYoungGenerationMaskingMetadata(
  input?: YoungGenerationMaskingMetadataInput | null,
  inactiveForRetrieval?: boolean,
  record?: MemoryItemRecordInput | null,
): Readonly<YoungGenerationMaskingMetadata>;

export function createHippocampusSecretRedactionPolicy(
  input?: HippocampusSecretRedactionPolicyInput | null,
): Readonly<HippocampusSecretRedactionPolicy>;

export function sanitizeHippocampusBoundaryPayload<T>(
  payload: T,
  options?: HippocampusBoundarySanitizationOptions | null,
): Readonly<HippocampusBoundarySanitizationResult<T>>;

export function createYoungGenerationMemory(
  input: YoungGenerationMemoryInput,
): Readonly<YoungGenerationMemory>;

export function createImportanceIndexEntry(
  input: ImportanceIndexEntryInput,
): Readonly<ImportanceIndexEntry>;

export function createConsolidationSignalCapture(
  input: ConsolidationSignalCaptureInput,
): Readonly<ConsolidationSignalCapture>;

export function createConsolidationPromotionPolicy(
  input?: ConsolidationPromotionPolicyInput,
): Readonly<ConsolidationPromotionPolicy>;

export function createConsolidationPromotionCandidate(
  input: ConsolidationPromotionCandidateInput,
): Readonly<ConsolidationPromotionCandidate>;

export function evaluateConsolidationPromotionEligibility(
  input: ConsolidationPromotionCandidateInput,
  policy?: ConsolidationPromotionPolicyInput | ConsolidationPromotionPolicy,
): Readonly<ConsolidationPromotionEvaluation>;

export function evaluateConsolidationPromotionCandidate(
  input: ConsolidationPromotionCandidateInput,
  policy?: ConsolidationPromotionPolicyInput | ConsolidationPromotionPolicy,
): Readonly<ConsolidationPromotionEvaluation>;

export const DEFAULT_WEIGHTED_PAGERANK_DAMPING_FACTOR: 0.85;
export const DEFAULT_WEIGHTED_PAGERANK_MAX_ITERATIONS: 100;
export const DEFAULT_WEIGHTED_PAGERANK_TOLERANCE: number;

export function evaluateWeightedPageRank(
  input: WeightedPageRankInput,
): Readonly<WeightedPageRankResult>;

export function evaluateConsolidationPromotionPageRank(
  options: ConsolidationPromotionPageRankOptions,
): Readonly<ConsolidationPromotionPageRankResult>;

export function selectTopKConsolidationPromotions(
  options: ConsolidationPromotionPageRankOptions,
): Readonly<ConsolidationPromotionTopKSelection>;

export function ingestZepiaToolCallTracking(
  input: ZepiaToolCallTrackingInput,
): Readonly<ZepiaToolCallTrackingIngestionResult>;

export function buildZepiaConsolidationPayload(
  input: ZepiaConsolidationPayloadInput,
): Readonly<ZepiaConsolidationPayload>;

export function resolveZepiaConsolidationTopK(
  input: ZepiaConsolidationTopKInput,
): Readonly<ZepiaConsolidationTopKResolution>;

export function planConsolidationPromotions(
  graph: AgentBrainMemoryGraph,
  options: ConsolidationPromotionPlanOptions,
): Readonly<ConsolidationPromotionPlan>;

export function createMemoryGraph(
  identityInput: ImmutableIdentityInput,
  options?: MemoryGraphOptions,
): Readonly<AgentBrainMemoryGraph>;

export function restoreMemoryGraphFromStorage(
  identityInput: ImmutableIdentityInput,
  options: RestoreMemoryGraphFromStorageOptions,
): Promise<Readonly<AgentBrainMemoryGraph>>;

export function rebuildMemoryGraph(
  graph: AgentBrainMemoryGraph,
  options?: MemoryGraphRebuildOptions,
): Readonly<AgentBrainMemoryGraph>;

export function getMemoryGraphReconstructionBudget(
  graph: AgentBrainMemoryGraph,
): Readonly<IdleWindowReconstructionBudget> | null;

export function getMemoryGraphReconstructionProfile(
  graph: AgentBrainMemoryGraph,
): Readonly<MemoryGraphReconstructionProfile> | null;

export function getMemoryGraphAgentId(
  graph: AgentBrainMemoryGraph | YoungGenerationGraphStateExportSource,
): string;

export function getYoungGenerationConstructionState(
  graph: AgentBrainMemoryGraph | YoungGenerationGraphStateExportSource,
): Readonly<YoungGeneration>;

export function getYoungGenerationSnapshotEdges(
  graph: AgentBrainMemoryGraph | YoungGenerationGraphStateExportSource,
): ReadonlyArray<MemoryGraphEdge>;

export function getOldGenerationConstructionState(
  graph: AgentBrainMemoryGraph | OldGenerationGraphStateExportSource,
): Readonly<OldGeneration>;

export function getOldGenerationSnapshotEdges(
  graph: AgentBrainMemoryGraph | OldGenerationGraphStateExportSource,
): ReadonlyArray<OldGenerationEdge>;

export function saveYoungGenerationGraphState(
  graph: AgentBrainMemoryGraph | YoungGenerationGraphStateExportSource,
): Readonly<YoungGenerationGraphState>;

export function saveOldGenerationGraphState(
  graph: AgentBrainMemoryGraph | OldGenerationGraphStateExportSource,
): Readonly<OldGenerationGraphState>;

export function loadYoungGenerationGraphState(
  graph: AgentBrainMemoryGraph,
  state: YoungGenerationGraphStateInput,
  options?: {
    reconstructionBudget?:
      | IdleWindowReconstructionBudgetInput
      | IdleWindowReconstructionBudget
      | null;
  },
): Readonly<AgentBrainMemoryGraph>;

export function loadOldGenerationGraphState(
  graph: AgentBrainMemoryGraph,
  state: OldGenerationGraphStateInput,
  options?: {
    reconstructionBudget?:
      | IdleWindowReconstructionBudgetInput
      | IdleWindowReconstructionBudget
      | null;
  },
): Readonly<AgentBrainMemoryGraph>;

export function lookupLongTermMemory(
  graph: AgentBrainMemoryGraph,
  memoryId: string,
): Readonly<LongTermMemory> | null;

export function lookupMemoryEvidence(
  graph: AgentBrainMemoryGraph,
  evidenceId: string,
): Readonly<MemoryEvidence> | null;

export function lookupConsolidationRecord(
  graph: AgentBrainMemoryGraph,
  recordId: string,
): Readonly<ConsolidationRecord> | null;

export function lookupArchivedMemory(
  graph: AgentBrainMemoryGraph,
  archiveId: string,
): Readonly<ArchivedMemory> | null;

export function resolveArchivedMemoryReference(
  graph: AgentBrainMemoryGraph,
  reference?: ArchivedMemoryReferenceInput | null,
): Readonly<ArchivedMemory> | null;

export function lookupOldGenerationNode(
  graph: AgentBrainMemoryGraph,
  lookup: OldGenerationNodeLookup,
  options?: OldGenerationAccessOptions,
): Readonly<OldGenerationNode> | null;

export function walkOldGenerationRelationships(
  graph: AgentBrainMemoryGraph,
  lookup: OldGenerationNodeLookup,
  options?: OldGenerationRelationshipWalkOptions,
): Readonly<OldGenerationRelationshipWalkResult>;

export function expandOldGenerationSeedNodes(
  graph: AgentBrainMemoryGraph,
  seedNodeIds: ReadonlyArray<string>,
  options?: OldGenerationRelationshipWalkOptions,
): Readonly<OldGenerationSeedExpansionResult>;

export function resolvePromptToSeedMemoryNodeIds(
  graph: AgentBrainMemoryGraph,
  prompt: string,
  options?: PromptToSeedResolutionOptions,
): Readonly<PromptToSeedResolutionResult>;

export function selectOldGenerationRetrievalCandidates(
  graph: AgentBrainMemoryGraph,
  prompt: string,
  options?: OldGenerationRetrievalCandidateSelectionOptions,
): Readonly<OldGenerationRetrievalCandidateSelectionResult>;

export function createYoungGenerationInspectionView(
  graph: AgentBrainMemoryGraph,
): Readonly<YoungGeneration>;

export function createYoungGenerationAdministrativeView(
  graph: AgentBrainMemoryGraph,
): Readonly<YoungGeneration>;

export function createYoungGenerationRetrievalView(
  graph: AgentBrainMemoryGraph,
): Readonly<YoungGeneration>;

export function putImportanceIndexEntry(
  graph: AgentBrainMemoryGraph,
  input: ImportanceIndexEntryInput,
): Readonly<AgentBrainMemoryGraph>;

export function updateImportanceIndexEntry(
  graph: AgentBrainMemoryGraph,
  memoryReference: ImportanceIndexEntryReference,
  update: ImportanceIndexEntryUpdate,
): Readonly<AgentBrainMemoryGraph>;

export function queryImportanceIndex(
  graph: AgentBrainMemoryGraph,
  query?: ImportanceIndexQuery,
): ReadonlyArray<ImportanceIndexEntry>;

export function describeBrainLibrary(): BrainLibraryDescription;

export function evaluateStaleMemories(
  options: StaleMemoryEvaluationOptions,
): Readonly<StaleMemoryEvaluationResult>;

export const RUNTIME_AUTHORIZED_IDLE_PHASES: ReadonlyArray<
  "idle" | "rest" | "break" | "sleep"
>;

export function createRuntimePhase(
  value: string,
  options?: ArchivalTransitionRuntimePhaseInput,
): Readonly<RuntimePhase>;

export function createIdleWindowSuggestion(
  options?: ArchivalTransitionIdleWindowSuggestionInput,
): Readonly<IdleWindowSuggestion>;

export function createIdleWindowReconstructionBudget(
  options: IdleWindowReconstructionBudgetInput,
): Readonly<IdleWindowReconstructionBudget>;

export function evaluateIdleWindowAuthorization(
  options: IdleWindowAuthorizationOptions,
): Readonly<ArchivalTransitionAuthorization>;

export function planIdleWindowConsolidation(options: {
  teamIdle?: boolean;
  agents: ReadonlyArray<IdleWindowConsolidationAgentInput>;
}): Readonly<IdleWindowConsolidationPlan>;

export function createOfflineConsolidationPlanBuilderPreset(
  options: OfflineConsolidationPlanBuilderPresetInput,
): Readonly<OfflineConsolidationPlanBuilderPreset>;

export function createOfflineConsolidationPlanBuilderPresetCatalog(
  options?: OfflineConsolidationPlanBuilderPresetCatalogInput,
): Readonly<OfflineConsolidationPlanBuilderPresetCatalog>;

export function resolveOfflineConsolidationPlanBuilderPreset(
  presetOrId?:
    | string
    | OfflineConsolidationPlanBuilderPresetInput
    | OfflineConsolidationPlanBuilderPreset
    | null,
  options?: {
    catalog?:
      | OfflineConsolidationPlanBuilderPresetCatalogInput
      | OfflineConsolidationPlanBuilderPresetCatalog
      | null;
  },
): Readonly<OfflineConsolidationPlanBuilderPreset>;

export function createOfflineConsolidationPlanBuilderRequest(
  options: OfflineConsolidationPlanBuilderRequestInput,
): Readonly<OfflineConsolidationPlanBuilderRequest>;

export function buildOfflineConsolidationBatchPlan(
  options:
    | OfflineConsolidationBatchPlanBuilderInput
    | OfflineConsolidationBatchPlanBuilderFromRequestInput,
): Readonly<OfflineBatchPlan>;

export function requestOfflineConsolidationBatchPlan(
  options:
    | OfflineConsolidationBatchPlanBuilderInput
    | OfflineConsolidationBatchPlanBuilderFromRequestInput,
): Readonly<OfflineConsolidationBatchPlanRequestResult>;

export function validateOfflineConsolidationBatchPlan(
  plan: OfflineBatchPlanInput | OfflineBatchPlan,
): true;

export function createOfflineBatchLimit(
  options?: OfflineBatchLimitInput,
): Readonly<OfflineBatchLimit>;

export function createOfflineBatchWorkUnit(
  options: OfflineBatchWorkUnitInput,
): Readonly<OfflineBatchWorkUnit>;

export function createOfflineBatchPlan(
  options: OfflineBatchPlanInput,
): Readonly<OfflineBatchPlan>;

export function scheduleOfflineBatchExecution(
  plan: OfflineBatchPlanInput | OfflineBatchPlan,
): Readonly<OfflineBatchExecutionSchedule>;

export function executeOfflineBatchPlan(
  plan: OfflineBatchPlanInput | OfflineBatchPlan,
  options?: OfflineBatchExecutionOptions,
): Promise<Readonly<OfflineBatchExecutionResult>>;

export function planTeamIdleConsolidationBatch(options: {
  teamIdle?: boolean;
  batchLimit?: OfflineBatchLimitInput | OfflineBatchLimit | null;
  agents: ReadonlyArray<TeamIdleConsolidationBatchAgentInput>;
}): Readonly<TeamIdleConsolidationBatchPlan>;

export function createStaleMemoryMaskingDecisions(
  options: StaleMemoryMaskingDecisionOptions,
): Readonly<StaleMemoryMaskingDecisionResult>;

export function archiveStaleMemories(
  graph: AgentBrainMemoryGraph,
  options: ArchivalTransitionOptions,
): Promise<Readonly<ArchivalTransitionResult>>;


export interface AgentBrainApiEventInput {
  id?: string;
  memoryId?: string;
  kind?: string;
  content: string;
  summary?: string | null;
  references?: string[];
  referenceIds?: string[];
  signals?: Record<string, number>;
  identity?: Record<string, unknown> | null;
  metadata?: Record<string, unknown>;
}

export interface AgentBrainApiToolCallInput {
  id?: string;
  toolName?: string;
  name?: string;
  sourceEventIds?: string[];
  sourceMemoryIds?: string[];
  referencedEventIds?: string[];
  referencedMemoryIds?: string[];
  targetEventIds?: string[];
  weight?: number;
}

export interface AgentBrainApiRuntimeInput {
  phase?: string;
  authority?: string;
}

export interface AgentBrainApiInput {
  agentId: string;
  events?: AgentBrainApiEventInput[];
  toolCalls?: AgentBrainApiToolCallInput[];
}

export interface AgentBrainExperimentInput extends AgentBrainApiInput {
  runtime?: AgentBrainApiRuntimeInput;
  iterations?: number;
  topK?: number;
}

export interface AgentBrainApiMemoryGraph {
  apiKind: "agent_brain_api_graph";
  schemaVersion: "1.0.0";
  agentId: string;
  zepiaCoupling: "none";
  nodes: ReadonlyArray<Record<string, unknown>>;
  toolCalls: ReadonlyArray<Record<string, unknown>>;
  edges: ReadonlyArray<Record<string, unknown>>;
}

export interface AgentBrainExperimentResult {
  apiKind: "agent_brain_experiment_result";
  status: "completed" | "blocked";
  agentId: string;
  iterationsRequested: number;
  runtimeAuthorization: Readonly<Record<string, unknown>>;
  graph: Readonly<AgentBrainApiMemoryGraph> | null;
  pageRank: Readonly<Record<string, unknown>> | null;
  rankedMemories: ReadonlyArray<Record<string, unknown>>;
  longTermCandidates: ReadonlyArray<Record<string, unknown>>;
  graphSecretBoundary: Readonly<HippocampusBoundarySanitizationResult> | null;
  secretBoundary: Readonly<HippocampusBoundarySanitizationResult> | null;
}

export const AGENT_BRAIN_API_DEFAULT_EXPERIMENT_ITERATIONS: 90;
export const AGENT_BRAIN_API_DEFAULT_TOP_K: 5;

export function buildAgentBrainMemoryGraph(
  input: AgentBrainApiInput,
): Readonly<AgentBrainApiMemoryGraph>;

export function runAgentBrainExperiment(
  input: AgentBrainExperimentInput,
): Readonly<AgentBrainExperimentResult>;
