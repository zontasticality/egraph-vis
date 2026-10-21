import { NodeStyleClass, EClassStyleClass, type Phase } from './types';

/** Appearance of an e-node box. Colors must be hex so they can be interpolated. */
export interface NodeStyle {
    fill: string;
    stroke: string;
    text: string;
    dashed: boolean;
    label: string;
    description: string;
}

/** Appearance of an e-class box. */
export interface EClassStyle {
    fill: string;
    stroke: string;
    dashed: boolean;
    strokeWidth: number;
    opacity: number;
    label: string;
    description: string;
}

// Node style definitions - single source of truth (graph, state pane and legend)
export const NODE_STYLES: Record<NodeStyleClass, NodeStyle> = {
    [NodeStyleClass.Default]: {
        fill: '#ffffff', stroke: '#475569', text: '#0f172a', dashed: false,
        label: 'E-node', description: 'An operator applied to child e-classes'
    },
    [NodeStyleClass.MatchedLHS]: {
        fill: '#fde68a', stroke: '#d97706', text: '#78350f', dashed: false,
        label: 'Matched', description: 'Matched by the left-hand side of a rule'
    },
    [NodeStyleClass.NewNode]: {
        fill: '#fecdd3', stroke: '#e11d48', text: '#881337', dashed: false,
        label: 'Created', description: 'Added by instantiating a right-hand side'
    },
    [NodeStyleClass.NonCanonical]: {
        fill: '#ffffff', stroke: '#ea580c', text: '#0f172a', dashed: true,
        label: 'Stale', description: 'Points at a merged e-class; fixed by repair'
    },
    [NodeStyleClass.ParentNode]: {
        fill: '#bfdbfe', stroke: '#2563eb', text: '#1e3a8a', dashed: false,
        label: 'Repairing', description: 'Parent e-node being re-canonicalized'
    }
};

// E-Class style definitions
export const ECLASS_STYLES: Record<EClassStyleClass, EClassStyle> = {
    [EClassStyleClass.Default]: {
        fill: '#f8fafc', stroke: '#94a3b8', dashed: true, strokeWidth: 1.5, opacity: 1,
        label: 'E-class', description: 'A set of equivalent e-nodes'
    },
    [EClassStyleClass.Active]: {
        fill: '#eff6ff', stroke: '#2563eb', dashed: false, strokeWidth: 2.5, opacity: 1,
        label: 'Active', description: 'Being compacted or repaired right now'
    },
    [EClassStyleClass.InWorklist]: {
        fill: '#f0f9ff', stroke: '#38bdf8', dashed: true, strokeWidth: 2, opacity: 1,
        label: 'In worklist', description: 'Merged; its parents still need repair'
    },
    [EClassStyleClass.Merged]: {
        fill: '#fff7ed', stroke: '#fb923c', dashed: true, strokeWidth: 1.5, opacity: 0.9,
        label: 'Merged', description: 'Non-canonical; waiting to be compacted'
    },
    [EClassStyleClass.Searching]: {
        fill: '#fffbeb', stroke: '#f59e0b', dashed: false, strokeWidth: 2.5, opacity: 1,
        label: 'Searching', description: 'A worker is searching it for rule matches'
    }
};

/** Parallel workers (deferred read and write phases): badge and scan-beam colors. */
export const WORKER_STYLE = {
    fill: '#f59e0b',
    /** Badge color while applying a rewrite (write phase). */
    writeFill: '#f43f5e',
    beam: '#fbbf24',
    check: '#b45309',
    tagFill: '#fef3c7',
    tagStroke: '#d97706',
    tagText: '#78350f',
    label: 'Worker',
    description: 'Searches one e-class (read) or applies one rewrite (write) per step; all workers run at the same time'
};

/** Union-find set container (deferred mode, between a union and compaction). */
export const SET_STYLE = { fill: '#f5f3ff', stroke: '#a78bfa', label: 'Union-find set', description: 'E-classes unioned but not yet compacted' };

export const EDGE_COLORS = { normal: '#94a3b8', stale: '#ea580c', highlight: '#2563eb' };

/** Phase accent colors (controller track, badges, active e-class outline). */
export const PHASE_COLORS: Record<Phase, string> = {
    init: '#9ca3af',
    read: '#f59e0b',
    'read-batch': '#fbbf24',
    write: '#f43f5e',
    compact: '#f97316',
    repair: '#3b82f6',
    done: '#10b981'
};

/** Active e-class colors depend on which phase is processing it. */
export function activeClassColors(phase: Phase): { stroke: string; fill: string } {
    return phase === 'compact'
        ? { stroke: '#ea580c', fill: '#fff7ed' }
        : { stroke: '#2563eb', fill: '#eff6ff' };
}
