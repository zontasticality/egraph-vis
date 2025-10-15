/**
 * Union-Find (Disjoint Set Union) data structure with path compression and union by rank
 * Based on Tarjan (1975) and the egg paper implementation
 */

import type { ENodeId } from './types';

export class UnionFind {
  private parent = $state(new Map<ENodeId, ENodeId>());
  private rank = $state(new Map<ENodeId, number>());

  /**
   * Creates a new singleton set containing just `id`
   */
  makeSet(id: ENodeId): void {
    this.parent.set(id, id);
    this.rank.set(id, 0);
  }

  /**
   * Finds the canonical representative of the set containing `id`
   * Uses path compression for amortized O(α(n)) time
   */
  find(id: ENodeId): ENodeId {
    const p = this.parent.get(id);

    // Not in any set
    if (p === undefined) {
      throw new Error(
        `ENodeId ${id} not found in union-find. ` +
        `Make sure to call makeSet(${id}) before using this ID. ` +
        `Total elements in union-find: ${this.parent.size}`
      );
    }

    // Already canonical
    if (p === id) return id;

    // Path compression: update parent to point directly to root
    const root = this.find(p);
    this.parent.set(id, root);
    return root;
  }

  /**
   * Unions the sets containing id1 and id2
   * Returns the canonical id of the merged set
   * Uses union by rank for balanced trees
   */
  union(id1: ENodeId, id2: ENodeId): ENodeId {
    const root1 = this.find(id1);
    const root2 = this.find(id2);

    // Already in same set
    if (root1 === root2) return root1;

    const rank1 = this.rank.get(root1)!;
    const rank2 = this.rank.get(root2)!;

    // Union by rank: attach smaller tree under larger tree
    if (rank1 < rank2) {
      this.parent.set(root1, root2);
      return root2;
    } else if (rank1 > rank2) {
      this.parent.set(root2, root1);
      return root1;
    } else {
      // Same rank: arbitrarily choose root1 and increment its rank
      this.parent.set(root2, root1);
      this.rank.set(root1, rank1 + 1);
      return root1;
    }
  }

  /**
   * Check if two ids are in the same set (equivalent)
   */
  equiv(id1: ENodeId, id2: ENodeId): boolean {
    try {
      return this.find(id1) === this.find(id2);
    } catch {
      return false;
    }
  }

  /**
   * Get all canonical representatives (for debugging/visualization)
   */
  getRoots(): Set<ENodeId> {
    const roots = new Set<ENodeId>();
    for (const id of this.parent.keys()) {
      roots.add(this.find(id));
    }
    return roots;
  }

  /**
   * Get number of sets
   */
  size(): number {
    return this.parent.size;
  }

  /**
   * Clear all data
   */
  clear(): void {
    this.parent.clear();
    this.rank.clear();
  }
}
