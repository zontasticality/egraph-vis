export type ENodeId = number;
export type EClassId = number; // Synonymous with canonical ENodeId
export type PresetId = string;

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
    phase: 'init' | 'read' | 'write' | 'rebuild' | 'done';
    implementation: 'naive' | 'deferred';
    unionFind: Array<{ id: number; canonical: number; isCanonical: boolean }>;
    eclasses: EClassViewModel[];
    nodeChunks: ENode[][]; // Chunked array of all nodes (index = id)
    worklist: number[];
    metadata: StepMetadata;
}

export interface EClassViewModel {
    id: number;
    nodes: Array<{ id: number; op: string; args: number[] }>;
    parents: Array<{ parentId: number; op: string }>;
    inWorklist: boolean;
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
}

export interface EGraphEngine {
    loadPreset(preset: PresetConfig, options: EngineOptions): void;
    runUntilHalt(): EGraphTimeline;
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
