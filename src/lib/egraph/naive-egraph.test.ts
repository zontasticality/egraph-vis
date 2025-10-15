import { describe, it, expect, beforeEach } from 'vitest';
import { NaiveEGraph } from './naive-egraph.svelte';
import type { ENode } from './types';

describe('NaiveEGraph', () => {
  let eg: NaiveEGraph;

  beforeEach(() => {
    eg = new NaiveEGraph();
  });

  describe('add', () => {
    it('should add a constant node', () => {
      const id = eg.add({ op: 'a', args: [] });
      expect(id).toBe(0);

      const eclass = eg.getEClass(id);
      expect(eclass).toBeDefined();
      expect(eclass!.nodes).toHaveLength(1);
      expect(eclass!.nodes[0].op).toBe('a');
    });

    it('should return existing id for duplicate nodes', () => {
      const id1 = eg.add({ op: 'a', args: [] });
      const id2 = eg.add({ op: 'a', args: [] });

      expect(id1).toBe(id2);
      expect(eg.allEClasses).toHaveLength(1);
    });

    it('should add node with children', () => {
      const a = eg.add({ op: 'a', args: [] });
      const b = eg.add({ op: 'b', args: [] });
      const add = eg.add({ op: '+', args: [a, b] });

      const eclass = eg.getEClass(add);
      expect(eclass!.nodes[0]).toEqual({ op: '+', args: [a, b] });
    });

    it('should update parent pointers', () => {
      const a = eg.add({ op: 'a', args: [] });
      const b = eg.add({ op: 'b', args: [] });
      eg.add({ op: '+', args: [a, b] });

      const aClass = eg.getEClass(a)!;
      expect(aClass.parents.size).toBe(1);

      // parents is now a Map, so we get values
      const parent = Array.from(aClass.parents.values())[0];
      expect(parent.enode.op).toBe('+');
    });

    it('should handle complex expressions', () => {
      // (a + b) * (a + b)
      const a = eg.add({ op: 'a', args: [] });
      const b = eg.add({ op: 'b', args: [] });
      const add = eg.add({ op: '+', args: [a, b] });
      const mul = eg.add({ op: '*', args: [add, add] });

      expect(eg.allEClasses).toHaveLength(4);

      const mulClass = eg.getEClass(mul)!;
      expect(mulClass.nodes[0].args).toEqual([add, add]);
    });
  });

  describe('merge', () => {
    it('should merge two e-classes', () => {
      const a = eg.add({ op: 'a', args: [] });
      const b = eg.add({ op: 'b', args: [] });

      expect(eg.allEClasses).toHaveLength(2);

      eg.merge(a, b);

      expect(eg.allEClasses).toHaveLength(1);
      expect(eg.find(a)).toBe(eg.find(b));
    });

    it('should combine nodes from both classes', () => {
      const a = eg.add({ op: 'a', args: [] });
      const b = eg.add({ op: 'b', args: [] });

      const root = eg.merge(a, b);
      const mergedClass = eg.getEClass(root)!;

      expect(mergedClass.nodes).toHaveLength(2);
      expect(mergedClass.nodes.map(n => n.op).sort()).toEqual(['a', 'b']);
    });

    it('should be idempotent', () => {
      const a = eg.add({ op: 'a', args: [] });
      const b = eg.add({ op: 'b', args: [] });

      const root1 = eg.merge(a, b);
      const root2 = eg.merge(a, b);

      expect(root1).toBe(root2);
    });

    it('should maintain congruence immediately (upward merging)', () => {
      // Create: f(a) and f(b)
      const a = eg.add({ op: 'a', args: [] });
      const b = eg.add({ op: 'b', args: [] });
      const fa = eg.add({ op: 'f', args: [a] });
      const fb = eg.add({ op: 'f', args: [b] });

      expect(eg.find(fa)).not.toBe(eg.find(fb));

      // Merge a and b -> should automatically merge f(a) and f(b)
      eg.merge(a, b);

      expect(eg.find(fa)).toBe(eg.find(fb));
    });

    it('should handle nested congruence', () => {
      // f(g(a)) and f(g(b))
      const a = eg.add({ op: 'a', args: [] });
      const b = eg.add({ op: 'b', args: [] });
      const ga = eg.add({ op: 'g', args: [a] });
      const gb = eg.add({ op: 'g', args: [b] });
      const fga = eg.add({ op: 'f', args: [ga] });
      const fgb = eg.add({ op: 'f', args: [gb] });

      eg.merge(a, b);

      // Both g(a) and g(b) should be merged
      expect(eg.find(ga)).toBe(eg.find(gb));
      // Both f(g(a)) and f(g(b)) should be merged
      expect(eg.find(fga)).toBe(eg.find(fgb));
    });
  });

  describe('invariants', () => {
    it('should always maintain invariants', () => {
      const a = eg.add({ op: 'a', args: [] });
      const b = eg.add({ op: 'b', args: [] });
      const fa = eg.add({ op: 'f', args: [a] });
      const fb = eg.add({ op: 'f', args: [b] });

      expect(eg.invariantsValid).toBe(true);
      expect(eg.worklist.size).toBe(0);

      eg.merge(a, b);

      // Should still be valid immediately
      expect(eg.invariantsValid).toBe(true);
      expect(eg.worklist.size).toBe(0);

      // Should have no congruence violations
      const violations = eg.checkCongruenceInvariant();
      expect(violations).toHaveLength(0);
    });

    it('should maintain hashcons invariant', () => {
      const a = eg.add({ op: 'a', args: [] });
      const b = eg.add({ op: 'b', args: [] });
      const fa = eg.add({ op: 'f', args: [a] });

      eg.merge(a, b);

      expect(eg.checkHashconsInvariant()).toBe(true);
    });
  });

  describe('example from egg paper', () => {
    it('should handle (a × 2) / 2 example', () => {
      // Build: (a * 2) / 2
      const a = eg.add({ op: 'a', args: [] });
      const two = eg.add({ op: '2', args: [] });
      const mul = eg.add({ op: '*', args: [a, two] });
      const div = eg.add({ op: '/', args: [mul, two] });

      // Apply rewrite: x * 2 -> x << 1
      const one = eg.add({ op: '1', args: [] });
      const shl = eg.add({ op: '<<', args: [a, one] });
      eg.merge(mul, shl);

      // (a * 2) and (a << 1) should be in same class
      expect(eg.find(mul)).toBe(eg.find(shl));

      // Invariants should be maintained
      expect(eg.invariantsValid).toBe(true);
      expect(eg.checkCongruenceInvariant()).toHaveLength(0);
    });
  });

  describe('rebuild', () => {
    it('should be a no-op', () => {
      const a = eg.add({ op: 'a', args: [] });
      const b = eg.add({ op: 'b', args: [] });

      const statsBefore = eg.stats;
      eg.rebuild();
      const statsAfter = eg.stats;

      expect(statsBefore).toEqual(statsAfter);
    });
  });

  describe('stats and utilities', () => {
    it('should provide accurate stats', () => {
      const a = eg.add({ op: 'a', args: [] });
      const b = eg.add({ op: 'b', args: [] });
      const add = eg.add({ op: '+', args: [a, b] });

      const stats = eg.stats;
      expect(stats.eclassCount).toBe(3);
      expect(stats.totalNodes).toBe(3);
      expect(stats.invariantsValid).toBe(true);
    });

    it('should convert to string for debugging', () => {
      const a = eg.add({ op: 'a', args: [] });
      const str = eg.toString();

      expect(str).toContain('E-Graph');
      expect(str).toContain('a');
    });

    it('should support clear', () => {
      eg.add({ op: 'a', args: [] });
      eg.add({ op: 'b', args: [] });

      eg.clear();

      expect(eg.allEClasses).toHaveLength(0);
      expect(eg.stats.totalNodes).toBe(0);
    });
  });
});
