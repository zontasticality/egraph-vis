// Core types for e-graph implementation
// Based on the egg paper: https://arxiv.org/abs/2004.03082

export type ENodeId = number;

export interface ENode {
  op: string;
  args: ENodeId[];
}

export interface ParentInfo {
  enode: ENode;
  parent_id: ENodeId;
}

/**
 * Creates a unique key for a ParentInfo entry
 * Used for Map-based parent tracking
 */
export function parentKey(info: ParentInfo): string {
  return `${info.parent_id}:${canonicalKey(info.enode)}`;
}

export interface EClass {
  id: ENodeId; // canonical id
  nodes: ENode[];
  // Use Map instead of Set to avoid reference equality issues with ParentInfo objects
  // Key is parentKey(ParentInfo), value is ParentInfo
  parents: Map<string, ParentInfo>;
  data?: any; // For e-class analysis (future extension)
}

/**
 * Creates a canonical string key for an e-node
 * Must call find() on all args before calling this
 */
export function canonicalKey(node: ENode): string {
  return JSON.stringify({ op: node.op, args: node.args });
}

/**
 * Helper to compare e-nodes for structural equality
 */
export function enodesEqual(a: ENode, b: ENode): boolean {
  return a.op === b.op &&
         a.args.length === b.args.length &&
         a.args.every((arg, i) => arg === b.args[i]);
}

/**
 * Events emitted during e-graph operations (for animation/history)
 */
export type EGraphEvent =
  | { type: 'add', node: ENode, result_id: ENodeId, timestamp: number }
  | { type: 'merge', id1: ENodeId, id2: ENodeId, result_id: ENodeId, timestamp: number }
  | { type: 'rebuild_start', worklist_size: number, timestamp: number }
  | { type: 'repair', eclass_id: ENodeId, timestamp: number }
  | { type: 'rebuild_complete', timestamp: number }
  | { type: 'hashcons_update', old_key: string, new_key: string, eclass_id: ENodeId, timestamp: number };

export interface EGraphSnapshot {
  eclasses: EClass[];
  hashcons: Map<string, ENodeId>;
  worklist: Set<ENodeId>;
}
