/**
 * Naive e-graph implementation with immediate rebuilding
 * Maintains invariants after every operation (traditional approach)
 *
 * Based on Nelson (1980) and traditional e-graph implementations
 */

import { ReactiveEGraph } from './base-egraph.svelte';
import type { ENode, ENodeId, EClass, ParentInfo } from './types';
import { canonicalKey, parentKey } from './types';

export class NaiveEGraph extends ReactiveEGraph {
  // Always empty worklist - rebuilds happen immediately
  worklist = $state(new Set<ENodeId>());
  dirty = $state(false);

  /**
   * Add an e-node to the e-graph
   * Maintains hashcons invariant immediately
   */
  add(node: ENode): ENodeId {
    // Canonicalize the node first
    const canonical = this.canonicalize(node);
    const key = canonicalKey(canonical);

    // Check if already exists in hashcons
    const existing = this.hashcons.get(key);
    if (existing !== undefined) {
      return this.find(existing);
    }

    // Create new e-class
    const id = this.nextId++;
    this.unionFind.makeSet(id);

    const eclass = {
      id,
      nodes: [node],
      parents: new Map<string, ParentInfo>()
    };

    this.eclassMap.set(id, eclass);
    this.hashcons.set(key, id);

    // Update parent pointers in children
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
   * Performs upward merging IMMEDIATELY to maintain congruence
   */
  merge(id1: ENodeId, id2: ENodeId): ENodeId {
    const root1 = this.find(id1);
    const root2 = this.find(id2);

    if (root1 === root2) return root1;

    // Perform union in union-find
    const newRoot = this.unionFind.union(root1, root2);
    const oldRoot = newRoot === root1 ? root2 : root1;

    // Merge e-class data
    const newClass = this.eclassMap.get(newRoot)!;
    const oldClass = this.eclassMap.get(oldRoot)!;

    // Combine nodes
    newClass.nodes.push(...oldClass.nodes);

    // Combine parent maps
    for (const [key, parent] of oldClass.parents) {
      newClass.parents.set(key, parent);
    }

    // Update map so oldRoot points to merged class
    this.eclassMap.set(oldRoot, newClass);

    // IMMEDIATE UPWARD MERGING
    this.upwardMerge(newClass);

    return newRoot;
  }

  /**
   * Traditional upward merging
   * Finds congruent parents and recursively merges them
   */
  private upwardMerge(eclass: EClass): void {
    // Group parents by their canonicalized form
    const parentsToMerge = new Map<string, ENodeId[]>();

    for (const { enode, parent_id } of eclass.parents.values()) {
      const canonical = this.canonicalize(enode);
      const key = canonicalKey(canonical);

      // Remove old hashcons entry
      const oldKey = canonicalKey(enode);
      if (oldKey !== key) {
        this.hashcons.delete(oldKey);
      }

      if (!parentsToMerge.has(key)) {
        parentsToMerge.set(key, []);
      }
      parentsToMerge.get(key)!.push(parent_id);
    }

    // Merge congruent parents and update hashcons
    for (const [key, ids] of parentsToMerge) {
      // Merge all congruent parents into the first one
      if (ids.length > 1) {
        const canonical = this.find(ids[0]);
        for (let i = 1; i < ids.length; i++) {
          // Recursive merge - triggers more upward merging
          this.merge(canonical, ids[i]);
        }
      }

      // Update hashcons to point to canonical id
      this.hashcons.set(key, this.find(ids[0]));
    }
  }

  /**
   * No-op for naive implementation - invariants always maintained
   */
  rebuild(): void {
    // Nothing to do - invariants are always valid
  }
}
