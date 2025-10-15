/**
 * Deferred rebuilding e-graph implementation
 * Defers invariant maintenance until rebuild() is called
 *
 * This is the key innovation of the egg paper:
 * - Merge operations just add to a worklist
 * - rebuild() processes the worklist in batches
 * - Deduplication provides asymptotic speedup
 *
 * Based on egg paper Section 3: https://arxiv.org/abs/2004.03082
 */

import { ReactiveEGraph } from './base-egraph.svelte';
import type { ENode, ENodeId, EClass, ParentInfo } from './types';
import { canonicalKey, parentKey } from './types';

export class DeferredEGraph extends ReactiveEGraph {
  // Reactive worklist - tracks e-classes needing repair
  worklist = $state(new Set<ENodeId>());
  dirty = $state(false);

  /**
   * Add an e-node to the e-graph
   * Same as naive implementation - doesn't break invariants
   */
  add(node: ENode): ENodeId {
    const canonical = this.canonicalize(node);
    const key = canonicalKey(canonical);

    const existing = this.hashcons.get(key);
    if (existing !== undefined) {
      return this.find(existing);
    }

    const id = this.nextId++;
    this.unionFind.makeSet(id);

    const eclass: EClass = {
      id,
      nodes: [node],
      parents: new Map<string, ParentInfo>()
    };

    this.eclassMap.set(id, eclass);
    this.hashcons.set(key, id);

    for (const childId of node.args) {
      const childClass = this.eclassMap.get(this.find(childId));
      if (childClass) {
        const pinfo = { enode: node, parent_id: id };
        childClass.parents.set(parentKey(pinfo), pinfo);
      }
    }

    return id;
  }

  /**
   * Merge two e-classes
   * DOES NOT maintain invariants immediately - adds to worklist instead
   */
  merge(id1: ENodeId, id2: ENodeId): ENodeId {
    const root1 = this.find(id1);
    const root2 = this.find(id2);

    if (root1 === root2) return root1;

    // Perform union
    const newRoot = this.unionFind.union(root1, root2);
    const oldRoot = newRoot === root1 ? root2 : root1;

    // Merge e-class data
    const newClass = this.eclassMap.get(newRoot)!;
    const oldClass = this.eclassMap.get(oldRoot)!;

    newClass.nodes.push(...oldClass.nodes);

    for (const [key, parent] of oldClass.parents) {
      newClass.parents.set(key, parent);
    }

    this.eclassMap.set(oldRoot, newClass);

    // DEFER repair - just add to worklist
    this.worklist.add(newRoot);
    this.dirty = true;

    return newRoot;
  }

  /**
   * Restore e-graph invariants by processing worklist
   * This is the key algorithm from egg paper Figure 4
   */
  rebuild(): void {
    while (this.worklist.size > 0) {
      // Empty worklist into local variable (egg paper line 30)
      const todo = new Set(this.worklist);
      this.worklist.clear();

      // Canonicalize and deduplicate (egg paper lines 32-33)
      // This is the KEY optimization - deduplicates work
      const canonical = new Set<ENodeId>();
      for (const id of todo) {
        canonical.add(this.find(id));
      }

      // Repair each unique e-class (egg paper line 34-35)
      for (const id of canonical) {
        this.repair(id);
      }
    }

    this.dirty = false;
  }

  /**
   * Repair a single e-class
   * Updates hashcons and merges congruent parents
   * Implementation of egg paper Figure 4, lines 37-53
   */
  private repair(eclassId: ENodeId): void {
    const eclass = this.eclassMap.get(this.find(eclassId));
    if (!eclass) return;

    // Phase 1: Update hashcons for all parents (lines 38-43)
    const parentUpdates: Array<{ oldKey: string, newKey: string, parent_id: ENodeId }> = [];

    for (const { enode, parent_id } of eclass.parents.values()) {
      // Remove old hashcons entry with non-canonical args
      const oldKey = canonicalKey(enode);
      this.hashcons.delete(oldKey);

      // Add new entry with canonical args
      const canonical = this.canonicalize(enode);
      const newKey = canonicalKey(canonical);
      this.hashcons.set(newKey, this.find(parent_id));

      parentUpdates.push({ oldKey, newKey, parent_id });
    }

    // Phase 2: Find congruent parents and merge (lines 45-53)
    const newParents = new Map<string, ENodeId>();

    for (const { enode, parent_id } of eclass.parents.values()) {
      const canonical = this.canonicalize(enode);
      const key = canonicalKey(canonical);

      if (newParents.has(key)) {
        // Found congruent parent! Merge them (adds to worklist)
        const existingParent = newParents.get(key)!;
        this.merge(parent_id, existingParent);
      }

      newParents.set(key, this.find(parent_id));
    }

    // Phase 3: Update parent list with deduplicated entries
    // Build new parent map with canonical parent_ids
    const updatedParents = new Map<string, ParentInfo>();

    for (const [key, canonical_parent_id] of newParents) {
      const parentClass = this.eclassMap.get(canonical_parent_id);
      if (!parentClass) continue;

      // Find an e-node in the parent class that matches this key
      for (const pnode of parentClass.nodes) {
        const canonPnode = this.canonicalize(pnode);
        if (canonicalKey(canonPnode) === key) {
          const pinfo = {
            enode: pnode,
            parent_id: canonical_parent_id
          };
          updatedParents.set(parentKey(pinfo), pinfo);
          break;
        }
      }
    }

    eclass.parents = updatedParents;
  }
}
