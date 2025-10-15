/**
 * Base reactive e-graph class implementing core operations
 * Subclasses implement different rebuilding strategies
 */

import { UnionFind } from './union-find.svelte';
import type { ENode, ENodeId, EClass, ParentInfo } from './types';
import { canonicalKey, parentKey } from './types';

export abstract class ReactiveEGraph {
  // Core reactive state - Svelte 5 tracks mutations automatically
  protected unionFind = $state(new UnionFind());
  protected eclassMap = $state(new Map<ENodeId, EClass>());
  protected hashcons = $state(new Map<string, ENodeId>());
  protected nextId = $state(0);

  // Subclasses must implement these as reactive state
  abstract worklist: Set<ENodeId>;
  abstract dirty: boolean;

  // Derived getters - auto-recompute when dependencies change
  get invariantsValid(): boolean {
    return !this.dirty;
  }

  get allEClasses(): EClass[] {
    const canonical = new Set<ENodeId>();
    for (const id of this.eclassMap.keys()) {
      canonical.add(this.find(id));
    }
    return Array.from(canonical).map(id => this.eclassMap.get(id)!);
  }

  get hashconsEntries() {
    return Array.from(this.hashcons.entries()).map(([key, id]) => ({
      key,
      enode: JSON.parse(key) as ENode,
      eclassId: id,
      isCanonical: this.find(id) === id
    }));
  }

  get stats() {
    return {
      eclassCount: this.allEClasses.length,
      hashconsSize: this.hashcons.size,
      worklistSize: this.worklist.size,
      totalNodes: this.nextId,
      invariantsValid: this.invariantsValid
    };
  }

  // ========== Core Operations ==========

  /**
   * Find canonical e-class id for a given id
   */
  find(id: ENodeId): ENodeId {
    return this.unionFind.find(id);
  }

  /**
   * Canonicalize an e-node by calling find() on all children
   */
  canonicalize(node: ENode): ENode {
    return {
      op: node.op,
      args: node.args.map(id => this.find(id))
    };
  }

  /**
   * Get e-class by id (returns canonical e-class)
   */
  getEClass(id: ENodeId): EClass | undefined {
    return this.eclassMap.get(this.find(id));
  }

  /**
   * Get read-only view of hashcons
   */
  getHashcons(): ReadonlyMap<string, ENodeId> {
    return this.hashcons;
  }

  /**
   * Check if e-graph contains a specific e-node
   */
  contains(node: ENode): ENodeId | undefined {
    const canonical = this.canonicalize(node);
    const key = canonicalKey(canonical);
    return this.hashcons.get(key);
  }

  /**
   * Check congruence invariant for debugging
   * Returns list of violations
   */
  checkCongruenceInvariant(): Array<{ node1: ENode, node2: ENode, id1: ENodeId, id2: ENodeId }> {
    const violations: Array<{ node1: ENode, node2: ENode, id1: ENodeId, id2: ENodeId }> = [];

    // Build map of canonical e-nodes to e-class ids
    const canonicalToIds = new Map<string, ENodeId[]>();

    for (const eclass of this.allEClasses) {
      for (const node of eclass.nodes) {
        const canonical = this.canonicalize(node);
        const key = canonicalKey(canonical);

        if (!canonicalToIds.has(key)) {
          canonicalToIds.set(key, []);
        }
        canonicalToIds.get(key)!.push(eclass.id);
      }
    }

    // Check for congruent nodes in different e-classes
    for (const [key, ids] of canonicalToIds) {
      const uniqueIds = new Set(ids.map(id => this.find(id)));
      if (uniqueIds.size > 1) {
        const node = JSON.parse(key) as ENode;
        const [id1, id2] = Array.from(uniqueIds);
        violations.push({ node1: node, node2: node, id1, id2 });
      }
    }

    return violations;
  }

  /**
   * Check hashcons invariant for debugging
   */
  checkHashconsInvariant(): boolean {
    for (const eclass of this.allEClasses) {
      for (const node of eclass.nodes) {
        const canonical = this.canonicalize(node);
        const key = canonicalKey(canonical);
        const stored = this.hashcons.get(key);

        if (stored === undefined) {
          console.error('Hashcons missing entry for:', node);
          return false;
        }

        if (this.find(stored) !== eclass.id) {
          console.error('Hashcons points to wrong e-class:', node, stored, eclass.id);
          return false;
        }
      }
    }
    return true;
  }

  // ========== Abstract Operations (implemented by subclasses) ==========

  /**
   * Add an e-node to the e-graph
   * Returns the e-class id containing this e-node
   */
  abstract add(node: ENode): ENodeId;

  /**
   * Merge two e-classes
   * Returns the canonical id of the merged class
   */
  abstract merge(id1: ENodeId, id2: ENodeId): ENodeId;

  /**
   * Restore e-graph invariants
   */
  abstract rebuild(): void;

  // ========== Utility Methods ==========

  /**
   * Clear all data and reset to empty e-graph
   */
  clear(): void {
    this.unionFind.clear();
    this.eclassMap.clear();
    this.hashcons.clear();
    this.nextId = 0;
  }

  /**
   * Pretty print e-graph for debugging
   */
  toString(): string {
    const lines: string[] = [];
    lines.push('E-Graph:');
    lines.push(`  Stats: ${JSON.stringify(this.stats)}`);
    lines.push('  E-classes:');

    for (const eclass of this.allEClasses) {
      const nodes = eclass.nodes.map(n =>
        `${n.op}(${n.args.join(', ')})`
      ).join(', ');
      lines.push(`    [${eclass.id}]: {${nodes}}`);
    }

    return lines.join('\n');
  }
}
