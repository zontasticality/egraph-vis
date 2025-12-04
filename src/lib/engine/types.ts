export type ENodeId = number;
export type EClassId = number; // Synonymous with canonical ENodeId
export type PresetId = string;

// --- Visual State Enums (for Animation System) ---

export enum NodeStyleClass {
    Default = 0,
    MatchedLHS = 1,      // Read phase: part of pattern match
    NewNode = 2,         // Write phase: newly created
    NonCanonical = 3,    // Compact phase: ghost node (dashed border)
    ParentNode = 4,      // Repair phase: parent being repaired
}

export enum EClassStyleClass {
    Default = 0,
    Active = 1,          // Currently being processed (repair/compact phase)
    InWorklist = 2,      // In the worklist
    Merged = 3,          // Non-canonical (merged away in compact)
}

// --- Visual State Structures ---

export interface NodeVisualState {
    styleClass: NodeStyleClass;
    portTargets: number[];  // Canonical IDs for each argument (for port colors)
}

export interface EClassVisualState {
    styleClass: EClassStyleClass;
    isCanonical: boolean;
}

// --- Layout Data ---

export interface LayoutData {
    nodes: Map<number, { x: number; y: number }>;
    groups: Map<string, { x: number; y: number; width: number; height: number }>; // String keys: "class-123", "set-456"
    edges: Set<string>;
}

// --- Runtime Structures (Mutable) ---

export interface ENode {
    op: string;
    args: ENodeId[];
}

export interface ParentInfo {
    parentId: ENodeId; // canonical id of parent class
    enode: ENode;      // parent node structure before canonicalization
}

export interface EClassRuntime {
    id: ENodeId;                     // canonical id
    nodes: ENodeId[];                // Store IDs instead of full objects
    parents: Map<string, ParentInfo>;// key = `${parentId}:${canonicalKey(parent)}`
    data?: Record<string, unknown>;  // optional analysis payload
    version: number;                 // incremented on mutation
}

// --- Snapshot Structures (Immutable) ---

export interface EGraphState {
    id: string;                      // `${presetId}:${stepIndex}`
    presetId: string;
    stepIndex: number;
    phase: 'init' | 'read' | 'read-batch' | 'write' | 'compact' | 'repair' | 'done';
    implementation: 'naive' | 'deferred';
    unionFind: Array<{ id: number; canonical: number; isCanonical: boolean }>;
    eclasses: EClassViewModel[];
    nodeChunks: ENode[][]; // Chunked array of all nodes (index = id)
    worklist: number[];
    metadata: StepMetadata;
    visualStates: {
        nodes: Map<number, NodeVisualState>;
        eclasses: Map<number, EClassVisualState>;
    };
    layout?: LayoutData;  // Populated progressively by layout manager
}

export interface EClassViewModel {
    id: number;
    nodes: Array<{ id: number; op: string; args: number[] }>;
    parents: Array<{ parentId: number; op: string }>;
    inWorklist: boolean;
}

// --- Deferred Mode Writelist ---

export interface WriteListEntry {
    ruleName: string;       // Rule name for diff recording
    rhsPattern: Pattern;    // RHS pattern to instantiate
    targetClass: ENodeId;   // E-class from the match (needs re-canonicalization)
    substitution: Map<string, ENodeId>;  // Variable bindings (need re-canonicalization)
    batchId: number;        // Batch that discovered this
}

export interface WriteList {
    entries: WriteListEntry[];
    nextIndex: number;      // Consumption pointer for write phase
}

export interface StepMetadata {
    diffs: DiffEvent[];
    matches: MatchEvent[]; // Nodes involved in pattern matches
    invariants: {
        congruenceValid: boolean;
        hashconsValid: boolean;
    };
    selectionHints: Array<{ type: 'eclass' | 'enode' | 'hashcons'; id: number | string }>;
    haltedReason?: 'saturated' | 'iteration-cap' | 'canceled';
    timestamp?: number;
    activeId?: number; // ID of the e-class being processed (for compact/repair highlighting)

    // Deferred mode fields
    writelist?: WriteList;
    currentMatchingNodes?: number[];
}

export interface MatchEvent {
    rule: string;
    nodes: number[]; // IDs of nodes involved in the match
}

export type DiffEvent =
    | { type: 'add'; nodeId: number; enode: ENode }
    | { type: 'merge'; winner: number; losers: number[] }
    | { type: 'rewrite'; rule: string; targetClass: number; createdId: number; mergedInto: number };

export interface GraphPayload {
    nodes: Array<{ id: number; label: string; degree: number }>;
    edges: Array<{ id: string; source: number; target: number; argIndex: number }>;
}

// --- Timeline & Engine API ---

export interface EGraphTimeline {
    presetId: string;
    implementation: 'naive' | 'deferred';
    states: EGraphState[];
    haltedReason: 'saturated' | 'iteration-cap' | 'canceled';
}

export interface EngineOptions {
    implementation: 'naive' | 'deferred';
    iterationCap?: number;
    recordDiffs?: boolean;
    debugInvariants?: boolean;
    maxNodes?: number;
    seed?: number; // Seed for random union-find decisions
    parallelism?: number; // Number of parallel operations (for deferred mode): 2, 4, 8, 16, 32
}

export interface EGraphEngine {
    loadPreset(preset: PresetConfig, options: EngineOptions): void;
    runUntilHalt(): Promise<EGraphTimeline>;
    step(): EGraphState | null;
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
        defaultImpl?: 'naive' | 'deferred';
        iterationCap?: number;
    };
    visualization?: {
        autoPlay?: boolean;
        highlightNodes?: number[];
    };
}
