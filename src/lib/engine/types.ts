export type ENodeId = number;
export type EClassId = number; // Synonymous with canonical ENodeId
export type PresetId = string;

export type Implementation = 'naive' | 'deferred';

export type Phase =
    | 'init'
    | 'read'        // naive: all matches collected at once
    | 'read-batch'  // deferred: one batch of e-classes searched
    | 'write'       // one rewrite applied (instantiate RHS + union)
    | 'compact'     // deferred: a merged e-class is physically folded into its canonical class
    | 'repair'      // one worklist entry processed (congruence closure)
    | 'done';

export type HaltReason = 'saturated' | 'iteration-cap' | 'node-limit' | 'step-limit' | 'canceled';

// --- Visual State Enums (for Animation System) ---

export enum NodeStyleClass {
    Default = 0,
    MatchedLHS = 1,      // Read/Write: e-node that is part of a pattern match
    NewNode = 2,         // Write: newly created by the rewrite being applied
    NonCanonical = 3,    // Any phase: e-node whose stored children point at merged (non-canonical) e-classes
    ParentNode = 4,      // Repair: parent e-node being re-canonicalized
}

export enum EClassStyleClass {
    Default = 0,
    Active = 1,          // Currently being processed (repair/compact phase)
    InWorklist = 2,      // In the worklist
    Merged = 3,          // Non-canonical (merged away, waiting for compaction)
}

// --- Visual State Structures ---

export interface NodeVisualState {
    styleClass: NodeStyleClass;
}

export interface EClassVisualState {
    styleClass: EClassStyleClass;
    isCanonical: boolean;
}

// --- Layout Data ---

export interface Rect {
    x: number;
    y: number;
    width: number;
    height: number;
}

/**
 * Absolute positions (top-left corners) of every rendered entity.
 * Keys: e-node ID for nodes, e-class ID for classes, canonical ID for union-find sets
 * (sets are only laid out when they contain more than one e-class).
 */
export interface LayoutData {
    nodes: Map<number, Rect>;
    classes: Map<number, Rect>;
    sets: Map<number, Rect>;
    bounds: Rect;
}

// --- Runtime Structures (Mutable) ---

export interface ENode {
    op: string;
    args: ENodeId[];
}

export interface ParentInfo {
    parentId: ENodeId; // ID of the parent e-node (find() it to get its e-class)
    enode: ENode;      // parent node structure when it was registered
}

export interface EClassRuntime {
    id: ENodeId;                     // canonical id
    nodes: ENodeId[];                // Store IDs instead of full objects
    parents: Map<string, ParentInfo>;// key = parent e-node id
    data?: Record<string, unknown>;  // optional analysis payload
    version: number;                 // incremented on mutation
}

// --- Snapshot Structures (Immutable) ---

export interface UnionFindEntry {
    id: number;
    canonical: number;
    isCanonical: boolean;
}

export interface HashconsEntry {
    key: string;
    op: string;
    args: number[];
    eclass: number; // canonical e-class at snapshot time
}

export interface EGraphState {
    id: string;                      // `${presetId}:${stepIndex}`
    presetId: string;
    stepIndex: number;
    phase: Phase;
    implementation: Implementation;
    unionFind: UnionFindEntry[];
    eclasses: EClassViewModel[];
    nodeChunks: ENode[][]; // Chunked array of all nodes (index = id), stored form
    hashcons: HashconsEntry[];
    worklist: number[];
    metadata: StepMetadata;
    visualStates: {
        nodes: Map<number, NodeVisualState>;     // sparse: only non-default entries
        eclasses: Map<number, EClassVisualState>;
    };
    layout?: LayoutData;  // Populated progressively by layout manager
}

export interface EClassViewModel {
    id: number;
    nodes: Array<{ id: number; op: string; args: number[] }>; // args as stored (may be stale)
}

// --- Deferred Mode Writelist ---

export interface WriteListEntry {
    ruleName: string;       // Rule name for diff recording
    rhsPattern: Pattern;    // RHS pattern to instantiate
    targetClass: ENodeId;   // E-class from the match (needs re-canonicalization)
    substitution: Map<string, ENodeId>;  // Variable bindings (need re-canonicalization)
    batchId: number;        // Batch that discovered this
    lhsNodes: number[];     // E-nodes matched by the LHS (for highlighting)
}

/**
 * Snapshot view of the writelist. `entries` is shared (append-only during the
 * read phase) between all snapshots of one iteration; only the first `count`
 * entries existed when the snapshot was taken.
 */
export interface WriteList {
    entries: WriteListEntry[];
    count: number;
    nextIndex: number;      // Consumption pointer for write phase
}

export interface StepMetadata {
    iteration: number;
    diffs: DiffEvent[];
    matches: MatchEvent[]; // Matches relevant to this snapshot (batch / all / applied)
    invariants: {
        congruenceValid: boolean;
        hashconsValid: boolean;
    };
    selectionHints: Array<{ type: 'eclass' | 'enode' | 'hashcons'; id: number | string }>;
    haltedReason?: HaltReason;
    timestamp?: number;
    activeId?: number; // ID of the e-class being processed (compact/repair)

    /** read-batch: the e-classes searched in this batch */
    batch?: { index: number; total: number; classIds: number[] };
    /** compact: the merged e-class being folded into `activeId` */
    compactedId?: number;
    /** repair: parent e-nodes that were re-canonicalized */
    repairedNodes?: number[];
    /** write: the rewrite being applied */
    applied?: { rule: string; targetClass: number; createdId: number; newNodes: number[]; lhsNodes: number[] };

    // Deferred mode fields
    writelist?: WriteList;
}

export interface MatchEvent {
    rule: string;
    eclassId: number;
    nodes: number[]; // E-nodes matched by the LHS pattern (variables bind e-classes, not nodes)
}

export type DiffEvent =
    | { type: 'add'; nodeId: number; enode: ENode }
    | { type: 'merge'; winner: number; losers: number[] }
    | { type: 'remove'; nodeId: number; duplicateOf: number }
    | { type: 'rewrite'; rule: string; targetClass: number; createdId: number; mergedInto: number };

// --- Timeline & Engine API ---

export interface EGraphTimeline {
    presetId: string;
    implementation: Implementation;
    states: EGraphState[];
    haltedReason: HaltReason;
}

export interface EngineOptions {
    implementation: Implementation;
    iterationCap?: number;
    recordDiffs?: boolean;
    debugInvariants?: boolean; // Check e-graph invariants after every rebuild (throws on violation)
    maxNodes?: number;         // Stop applying rewrites once this many e-nodes exist
    maxSteps?: number;         // Stop once this many snapshots were emitted
    seed?: number; // Seed for random union-find decisions
    parallelism?: number; // Number of parallel operations (for deferred mode): 2, 4, 8, 16, 32
}

export interface EGraphEngine {
    loadPreset(preset: PresetConfig, options: EngineOptions): void;
    runUntilHalt(): Promise<EGraphTimeline>;
    getTimeline(): EGraphTimeline;
}

// --- Presets & Rewrites ---

export type Pattern = string | {
    op: string;
    args: (string | Pattern | number)[]; // number for concrete ENodeId references
};

export interface RewriteRule {
    name: string;
    lhs: Pattern;
    rhs: Pattern;
    enabled: boolean;
    priority?: number;
}

export interface PresetConfig {
    id: string;
    label: string;
    description: string;
    root: Pattern;
    rewrites: RewriteRule[];
    implementationHints?: {
        defaultImpl?: Implementation;
        iterationCap?: number;
    };
    visualization?: {
        autoPlay?: boolean;
        highlightNodes?: number[];
    };
}
