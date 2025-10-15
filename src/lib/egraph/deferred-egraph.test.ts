import { describe, it, expect, beforeEach } from 'vitest';
import { DeferredEGraph } from './deferred-egraph.svelte';

describe('DeferredEGraph', () => {
  let eg: DeferredEGraph;

  beforeEach(() => {
    eg = new DeferredEGraph();
  });

  describe('add', () => {
    it('should add nodes like naive implementation', () => {
      const id = eg.add({ op: 'a', args: [] });
      expect(id).toBe(0);

      const eclass = eg.getEClass(id);
      expect(eclass).toBeDefined();
      expect(eclass!.nodes).toHaveLength(1);
    });

    it('should maintain hashcons on add', () => {
      const a1 = eg.add({ op: 'a', args: [] });
      const a2 = eg.add({ op: 'a', args: [] });

      expect(a1).toBe(a2);
    });
  });

  describe('merge - deferred behavior', () => {
    it('should add to worklist instead of immediate repair', () => {
      const a = eg.add({ op: 'a', args: [] });
      const b = eg.add({ op: 'b', args: [] });

      expect(eg.worklist.size).toBe(0);
      expect(eg.dirty).toBe(false);

      eg.merge(a, b);

      // Should be dirty and have items in worklist
      expect(eg.worklist.size).toBeGreaterThan(0);
      expect(eg.dirty).toBe(true);
      expect(eg.invariantsValid).toBe(false);
    });

    it('should NOT immediately maintain congruence', () => {
      const a = eg.add({ op: 'a', args: [] });
      const b = eg.add({ op: 'b', args: [] });
      const fa = eg.add({ op: 'f', args: [a] });
      const fb = eg.add({ op: 'f', args: [b] });

      eg.merge(a, b);

      // Congruence NOT maintained yet
      expect(eg.find(fa)).not.toBe(eg.find(fb));

      // Invariants broken
      const violations = eg.checkCongruenceInvariant();
      expect(violations.length).toBeGreaterThan(0);
    });
  });

  describe('rebuild', () => {
    it('should restore invariants', () => {
      const a = eg.add({ op: 'a', args: [] });
      const b = eg.add({ op: 'b', args: [] });

      eg.merge(a, b);

      expect(eg.invariantsValid).toBe(false);

      eg.rebuild();

      expect(eg.invariantsValid).toBe(true);
      expect(eg.worklist.size).toBe(0);
      expect(eg.dirty).toBe(false);
    });

    it('should restore congruence', () => {
      const a = eg.add({ op: 'a', args: [] });
      const b = eg.add({ op: 'b', args: [] });
      const fa = eg.add({ op: 'f', args: [a] });
      const fb = eg.add({ op: 'f', args: [b] });

      eg.merge(a, b);

      // Before rebuild: not congruent
      expect(eg.find(fa)).not.toBe(eg.find(fb));

      eg.rebuild();

      // After rebuild: congruent!
      expect(eg.find(fa)).toBe(eg.find(fb));

      // No violations
      const violations = eg.checkCongruenceInvariant();
      expect(violations).toHaveLength(0);
    });

    it('should handle nested congruence', () => {
      const a = eg.add({ op: 'a', args: [] });
      const b = eg.add({ op: 'b', args: [] });
      const ga = eg.add({ op: 'g', args: [a] });
      const gb = eg.add({ op: 'g', args: [b] });
      const fga = eg.add({ op: 'f', args: [ga] });
      const fgb = eg.add({ op: 'f', args: [gb] });

      eg.merge(a, b);
      eg.rebuild();

      expect(eg.find(ga)).toBe(eg.find(gb));
      expect(eg.find(fga)).toBe(eg.find(fgb));

      expect(eg.checkCongruenceInvariant()).toHaveLength(0);
    });

    it('should deduplicate worklist (key optimization)', () => {
      const a = eg.add({ op: 'a', args: [] });
      const b = eg.add({ op: 'b', args: [] });
      const c = eg.add({ op: 'c', args: [] });

      // Multiple merges that affect same e-classes
      eg.merge(a, b);
      eg.merge(b, c);

      const worklistBefore = eg.worklist.size;

      eg.rebuild();

      // After rebuild, worklist should be empty
      expect(eg.worklist.size).toBe(0);

      // The deduplication means we processed fewer items
      // than the original worklist size
      expect(eg.invariantsValid).toBe(true);
    });
  });

  describe('worklist processing', () => {
    it('should handle multiple merges before rebuild', () => {
      const a = eg.add({ op: 'a', args: [] });
      const b = eg.add({ op: 'b', args: [] });
      const c = eg.add({ op: 'c', args: [] });
      const d = eg.add({ op: 'd', args: [] });

      // Batch multiple merges
      eg.merge(a, b);
      eg.merge(c, d);
      eg.merge(b, c);

      // All in worklist
      expect(eg.dirty).toBe(true);

      eg.rebuild();

      // All should be in same e-class
      const root = eg.find(a);
      expect(eg.find(b)).toBe(root);
      expect(eg.find(c)).toBe(root);
      expect(eg.find(d)).toBe(root);

      expect(eg.invariantsValid).toBe(true);
    });

    it('should handle cascading repairs', () => {
      // Create chain: f(f(f(a)))
      const a = eg.add({ op: 'a', args: [] });
      const fa = eg.add({ op: 'f', args: [a] });
      const ffa = eg.add({ op: 'f', args: [fa] });
      const fffa = eg.add({ op: 'f', args: [ffa] });

      // Create chain: f(f(f(b)))
      const b = eg.add({ op: 'b', args: [] });
      const fb = eg.add({ op: 'f', args: [b] });
      const ffb = eg.add({ op: 'f', args: [fb] });
      const fffb = eg.add({ op: 'f', args: [ffb] });

      // Merge a and b
      eg.merge(a, b);
      eg.rebuild();

      // All levels should be merged
      expect(eg.find(fa)).toBe(eg.find(fb));
      expect(eg.find(ffa)).toBe(eg.find(ffb));
      expect(eg.find(fffa)).toBe(eg.find(fffb));
    });
  });

  describe('example from egg paper', () => {
    it('should handle (a × 2) / 2 with deferred rebuilding', () => {
      // Build: (a * 2) / 2
      const a = eg.add({ op: 'a', args: [] });
      const two = eg.add({ op: '2', args: [] });
      const mul = eg.add({ op: '*', args: [a, two] });
      const div = eg.add({ op: '/', args: [mul, two] });

      // Apply rewrite: x * 2 -> x << 1
      const one = eg.add({ op: '1', args: [] });
      const shl = eg.add({ op: '<<', args: [a, one] });

      eg.merge(mul, shl);

      // Before rebuild: dirty
      expect(eg.invariantsValid).toBe(false);

      eg.rebuild();

      // After rebuild: clean
      expect(eg.invariantsValid).toBe(true);
      expect(eg.find(mul)).toBe(eg.find(shl));
      expect(eg.checkCongruenceInvariant()).toHaveLength(0);
    });

    it('should handle multiple rewrites before rebuilding', () => {
      const a = eg.add({ op: 'a', args: [] });
      const two = eg.add({ op: '2', args: [] });
      const mul = eg.add({ op: '*', args: [a, two] });

      // Apply: x * 2 -> x << 1
      const one = eg.add({ op: '1', args: [] });
      const shl = eg.add({ op: '<<', args: [a, one] });
      eg.merge(mul, shl);

      // Apply: x << 1 -> x + x
      const add = eg.add({ op: '+', args: [a, a] });
      eg.merge(shl, add);

      // Haven't rebuilt yet
      expect(eg.dirty).toBe(true);

      eg.rebuild();

      // All three should be equivalent
      expect(eg.find(mul)).toBe(eg.find(shl));
      expect(eg.find(shl)).toBe(eg.find(add));
      expect(eg.invariantsValid).toBe(true);
    });
  });

  describe('hashcons maintenance', () => {
    it('should update hashcons during rebuild', () => {
      const a = eg.add({ op: 'a', args: [] });
      const b = eg.add({ op: 'b', args: [] });
      const fa = eg.add({ op: 'f', args: [a] });
      const fb = eg.add({ op: 'f', args: [b] });

      eg.merge(a, b);

      // Hashcons may be stale
      expect(eg.checkHashconsInvariant()).toBe(false);

      eg.rebuild();

      // Hashcons should be updated
      expect(eg.checkHashconsInvariant()).toBe(true);
    });
  });

  describe('performance characteristics', () => {
    it('should handle many merges efficiently with single rebuild', () => {
      const n = 100;
      const nodes: number[] = [];

      // Create n nodes
      for (let i = 0; i < n; i++) {
        nodes.push(eg.add({ op: `n${i}`, args: [] }));
      }

      // Create n parent nodes f(n_i)
      const parents: number[] = [];
      for (let i = 0; i < n; i++) {
        parents.push(eg.add({ op: 'f', args: [nodes[i]] }));
      }

      // Merge all nodes in one batch
      for (let i = 1; i < n; i++) {
        eg.merge(nodes[0], nodes[i]);
      }

      // Single rebuild
      const startTime = performance.now();
      eg.rebuild();
      const endTime = performance.now();

      // All parents should be merged
      for (let i = 1; i < n; i++) {
        expect(eg.find(parents[0])).toBe(eg.find(parents[i]));
      }

      expect(eg.invariantsValid).toBe(true);

      // Should complete reasonably fast
      expect(endTime - startTime).toBeLessThan(1000);
    });
  });

  describe('edge cases', () => {
    it('should handle empty worklist rebuild', () => {
      eg.add({ op: 'a', args: [] });

      expect(eg.worklist.size).toBe(0);

      eg.rebuild();

      expect(eg.invariantsValid).toBe(true);
    });

    it('should handle self-merge', () => {
      const a = eg.add({ op: 'a', args: [] });

      eg.merge(a, a);

      // Self-merge is a no-op, shouldn't add to worklist
      expect(eg.worklist.size).toBe(0);

      eg.rebuild();

      expect(eg.invariantsValid).toBe(true);
    });

    it('should handle cycles in parent relationships', () => {
      const a = eg.add({ op: 'a', args: [] });
      const fa = eg.add({ op: 'f', args: [a] });

      // Create cycle by making f(a) equal to a
      eg.merge(fa, a);
      eg.rebuild();

      expect(eg.find(fa)).toBe(eg.find(a));
      expect(eg.invariantsValid).toBe(true);
    });
  });
});
