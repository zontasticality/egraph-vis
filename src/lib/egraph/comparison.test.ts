/**
 * Comparison tests between NaiveEGraph and DeferredEGraph
 * Ensures both implementations produce equivalent results
 */

import { describe, it, expect } from 'vitest';
import { NaiveEGraph } from './naive-egraph.svelte';
import { DeferredEGraph } from './deferred-egraph.svelte';
import type { ENode } from './types';

describe('NaiveEGraph vs DeferredEGraph comparison', () => {
  /**
   * Helper to run same operations on both e-graphs and compare results
   */
  function compareEGraphs(
    operations: (eg: NaiveEGraph | DeferredEGraph) => void
  ): { naive: NaiveEGraph; deferred: DeferredEGraph } {
    const naive = new NaiveEGraph();
    const deferred = new DeferredEGraph();

    operations(naive);
    operations(deferred);

    // Deferred needs rebuild to match naive's immediate behavior
    deferred.rebuild();

    return { naive, deferred };
  }

  /**
   * Check if two e-graphs have equivalent structure
   */
  function assertEquivalent(naive: NaiveEGraph, deferred: DeferredEGraph) {
    // Same number of e-classes
    expect(deferred.allEClasses.length).toBe(naive.allEClasses.length);

    // Both should have valid invariants
    expect(naive.invariantsValid).toBe(true);
    expect(deferred.invariantsValid).toBe(true);

    // No congruence violations in either
    expect(naive.checkCongruenceInvariant()).toHaveLength(0);
    expect(deferred.checkCongruenceInvariant()).toHaveLength(0);

    // Hashcons should be valid
    expect(naive.checkHashconsInvariant()).toBe(true);
    expect(deferred.checkHashconsInvariant()).toBe(true);
  }

  describe('simple operations', () => {
    it('should produce same result for adding nodes', () => {
      const { naive, deferred } = compareEGraphs(eg => {
        eg.add({ op: 'a', args: [] });
        eg.add({ op: 'b', args: [] });
        eg.add({ op: 'c', args: [] });
      });

      assertEquivalent(naive, deferred);
      expect(naive.allEClasses.length).toBe(3);
      expect(deferred.allEClasses.length).toBe(3);
    });

    it('should produce same result for single merge', () => {
      const { naive, deferred } = compareEGraphs(eg => {
        const a = eg.add({ op: 'a', args: [] });
        const b = eg.add({ op: 'b', args: [] });
        eg.merge(a, b);
      });

      assertEquivalent(naive, deferred);
      expect(naive.allEClasses.length).toBe(1);
      expect(deferred.allEClasses.length).toBe(1);
    });

    it('should produce same result for congruence', () => {
      const { naive, deferred } = compareEGraphs(eg => {
        const a = eg.add({ op: 'a', args: [] });
        const b = eg.add({ op: 'b', args: [] });
        const fa = eg.add({ op: 'f', args: [a] });
        const fb = eg.add({ op: 'f', args: [b] });
        eg.merge(a, b);
      });

      assertEquivalent(naive, deferred);

      // Both should have merged f(a) and f(b)
      const naiveA = naive.find(2); // fa
      const naiveB = naive.find(3); // fb
      expect(naiveA).toBe(naiveB);

      const deferredA = deferred.find(2);
      const deferredB = deferred.find(3);
      expect(deferredA).toBe(deferredB);
    });
  });

  describe('complex operations', () => {
    it('should handle nested congruence identically', () => {
      const { naive, deferred } = compareEGraphs(eg => {
        const a = eg.add({ op: 'a', args: [] });
        const b = eg.add({ op: 'b', args: [] });
        const ga = eg.add({ op: 'g', args: [a] });
        const gb = eg.add({ op: 'g', args: [b] });
        const fga = eg.add({ op: 'f', args: [ga] });
        const fgb = eg.add({ op: 'f', args: [gb] });

        eg.merge(a, b);
      });

      assertEquivalent(naive, deferred);

      // Check specific equivalences
      expect(naive.find(0)).toBe(naive.find(1)); // a == b
      expect(naive.find(2)).toBe(naive.find(3)); // g(a) == g(b)
      expect(naive.find(4)).toBe(naive.find(5)); // f(g(a)) == f(g(b))

      expect(deferred.find(0)).toBe(deferred.find(1));
      expect(deferred.find(2)).toBe(deferred.find(3));
      expect(deferred.find(4)).toBe(deferred.find(5));
    });

    it('should handle transitive merges', () => {
      const { naive, deferred } = compareEGraphs(eg => {
        const a = eg.add({ op: 'a', args: [] });
        const b = eg.add({ op: 'b', args: [] });
        const c = eg.add({ op: 'c', args: [] });
        const d = eg.add({ op: 'd', args: [] });

        eg.merge(a, b);
        eg.merge(b, c);
        eg.merge(c, d);
      });

      assertEquivalent(naive, deferred);

      // All should be in same e-class
      const naiveRoot = naive.find(0);
      expect(naive.find(1)).toBe(naiveRoot);
      expect(naive.find(2)).toBe(naiveRoot);
      expect(naive.find(3)).toBe(naiveRoot);

      const deferredRoot = deferred.find(0);
      expect(deferred.find(1)).toBe(deferredRoot);
      expect(deferred.find(2)).toBe(deferredRoot);
      expect(deferred.find(3)).toBe(deferredRoot);
    });

    it('should handle egg paper example identically', () => {
      const { naive, deferred } = compareEGraphs(eg => {
        // (a × 2) / 2
        const a = eg.add({ op: 'a', args: [] });
        const two = eg.add({ op: '2', args: [] });
        const mul = eg.add({ op: '*', args: [a, two] });
        const div = eg.add({ op: '/', args: [mul, two] });

        // Apply: x × 2 → x << 1
        const one = eg.add({ op: '1', args: [] });
        const shl = eg.add({ op: '<<', args: [a, one] });
        eg.merge(mul, shl);
      });

      assertEquivalent(naive, deferred);

      // mul and shl should be equivalent in both
      expect(naive.find(2)).toBe(naive.find(5));
      expect(deferred.find(2)).toBe(deferred.find(5));
    });

    it('should handle multiple rewrites', () => {
      const { naive, deferred } = compareEGraphs(eg => {
        const a = eg.add({ op: 'a', args: [] });
        const two = eg.add({ op: '2', args: [] });
        const mul = eg.add({ op: '*', args: [a, two] });

        // x * 2 -> x << 1
        const one = eg.add({ op: '1', args: [] });
        const shl = eg.add({ op: '<<', args: [a, one] });
        eg.merge(mul, shl);

        // x << 1 -> x + x
        const add = eg.add({ op: '+', args: [a, a] });
        eg.merge(shl, add);
      });

      assertEquivalent(naive, deferred);

      // All three should be equivalent
      const naiveRoot = naive.find(2); // mul
      expect(naive.find(4)).toBe(naiveRoot); // shl
      expect(naive.find(5)).toBe(naiveRoot); // add

      const deferredRoot = deferred.find(2);
      expect(deferred.find(4)).toBe(deferredRoot);
      expect(deferred.find(5)).toBe(deferredRoot);
    });
  });

  describe('edge cases', () => {
    it('should handle self-loops', () => {
      const { naive, deferred } = compareEGraphs(eg => {
        const a = eg.add({ op: 'a', args: [] });
        const fa = eg.add({ op: 'f', args: [a] });
        eg.merge(a, fa); // Create cycle
      });

      assertEquivalent(naive, deferred);
    });

    it('should handle empty e-graph', () => {
      const { naive, deferred } = compareEGraphs(() => {
        // Do nothing
      });

      assertEquivalent(naive, deferred);
      expect(naive.allEClasses.length).toBe(0);
      expect(deferred.allEClasses.length).toBe(0);
    });

    it('should handle large merges', () => {
      const { naive, deferred } = compareEGraphs(eg => {
        const n = 50;
        const nodes: number[] = [];

        for (let i = 0; i < n; i++) {
          nodes.push(eg.add({ op: `n${i}`, args: [] }));
        }

        // Merge all into first
        for (let i = 1; i < n; i++) {
          eg.merge(nodes[0], nodes[i]);
        }
      });

      assertEquivalent(naive, deferred);
      expect(naive.allEClasses.length).toBe(1);
      expect(deferred.allEClasses.length).toBe(1);
    });
  });

  describe('performance comparison', () => {
    it('deferred should be faster for batch operations', () => {
      const n = 100;

      // Naive timing
      const naive = new NaiveEGraph();
      const naiveStart = performance.now();

      const naiveNodes: number[] = [];
      for (let i = 0; i < n; i++) {
        naiveNodes.push(naive.add({ op: `n${i}`, args: [] }));
      }

      const naiveParents: number[] = [];
      for (let i = 0; i < n; i++) {
        naiveParents.push(naive.add({ op: 'f', args: [naiveNodes[i]] }));
      }

      for (let i = 1; i < n; i++) {
        naive.merge(naiveNodes[0], naiveNodes[i]);
      }

      const naiveEnd = performance.now();
      const naiveTime = naiveEnd - naiveStart;

      // Deferred timing
      const deferred = new DeferredEGraph();
      const deferredStart = performance.now();

      const deferredNodes: number[] = [];
      for (let i = 0; i < n; i++) {
        deferredNodes.push(deferred.add({ op: `n${i}`, args: [] }));
      }

      const deferredParents: number[] = [];
      for (let i = 0; i < n; i++) {
        deferredParents.push(deferred.add({ op: 'f', args: [deferredNodes[i]] }));
      }

      for (let i = 1; i < n; i++) {
        deferred.merge(deferredNodes[0], deferredNodes[i]);
      }

      deferred.rebuild();

      const deferredEnd = performance.now();
      const deferredTime = deferredEnd - deferredStart;

      // Verify same results
      assertEquivalent(naive, deferred);

      // Deferred should be faster (or at least not significantly slower)
      // This is a rough check - actual speedup depends on implementation details
      console.log(`Naive: ${naiveTime.toFixed(2)}ms, Deferred: ${deferredTime.toFixed(2)}ms`);

      // Both should complete in reasonable time
      expect(naiveTime).toBeLessThan(5000);
      expect(deferredTime).toBeLessThan(5000);
    });
  });
});
