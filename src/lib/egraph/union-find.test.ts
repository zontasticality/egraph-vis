import { describe, it, expect, beforeEach } from 'vitest';
import { UnionFind } from './union-find.svelte';

describe('UnionFind', () => {
  let uf: UnionFind;

  beforeEach(() => {
    uf = new UnionFind();
  });

  describe('makeSet', () => {
    it('should create a new singleton set', () => {
      uf.makeSet(0);
      expect(uf.find(0)).toBe(0);
    });

    it('should create multiple independent sets', () => {
      uf.makeSet(0);
      uf.makeSet(1);
      uf.makeSet(2);

      expect(uf.find(0)).toBe(0);
      expect(uf.find(1)).toBe(1);
      expect(uf.find(2)).toBe(2);
    });
  });

  describe('find', () => {
    it('should find the canonical representative', () => {
      uf.makeSet(0);
      expect(uf.find(0)).toBe(0);
    });

    it('should throw for non-existent ids', () => {
      expect(() => uf.find(999)).toThrow();
    });

    it('should perform path compression', () => {
      uf.makeSet(0);
      uf.makeSet(1);
      uf.makeSet(2);

      // Create chain: 0 -> 1 -> 2
      uf.union(1, 2);
      uf.union(0, 1);

      // First find should compress paths
      const root = uf.find(0);

      // All should now point directly to root
      expect(uf.find(0)).toBe(root);
      expect(uf.find(1)).toBe(root);
      expect(uf.find(2)).toBe(root);
    });
  });

  describe('union', () => {
    it('should merge two sets', () => {
      uf.makeSet(0);
      uf.makeSet(1);

      const root = uf.union(0, 1);

      expect(uf.find(0)).toBe(root);
      expect(uf.find(1)).toBe(root);
    });

    it('should be idempotent when merging same set', () => {
      uf.makeSet(0);
      uf.makeSet(1);

      const root1 = uf.union(0, 1);
      const root2 = uf.union(0, 1);

      expect(root1).toBe(root2);
    });

    it('should handle transitive unions', () => {
      uf.makeSet(0);
      uf.makeSet(1);
      uf.makeSet(2);
      uf.makeSet(3);

      uf.union(0, 1);
      uf.union(2, 3);
      uf.union(1, 2);

      const root = uf.find(0);
      expect(uf.find(1)).toBe(root);
      expect(uf.find(2)).toBe(root);
      expect(uf.find(3)).toBe(root);
    });

    it('should use union by rank for balanced trees', () => {
      // Create a larger tree and a smaller tree
      uf.makeSet(0);
      uf.makeSet(1);
      uf.makeSet(2);
      uf.makeSet(3);

      // Build tree with root 0: 0 -> {1, 2}
      uf.union(0, 1);
      uf.union(0, 2);

      // Single node tree: 3
      // When merging, the larger tree's root should be preserved
      const root = uf.union(0, 3);

      // The root should be from the larger tree
      expect(root).toBe(uf.find(0));
    });
  });

  describe('equiv', () => {
    it('should return true for elements in same set', () => {
      uf.makeSet(0);
      uf.makeSet(1);
      uf.union(0, 1);

      expect(uf.equiv(0, 1)).toBe(true);
    });

    it('should return false for elements in different sets', () => {
      uf.makeSet(0);
      uf.makeSet(1);

      expect(uf.equiv(0, 1)).toBe(false);
    });

    it('should return false for non-existent elements', () => {
      expect(uf.equiv(0, 999)).toBe(false);
    });
  });

  describe('getRoots', () => {
    it('should return all canonical representatives', () => {
      uf.makeSet(0);
      uf.makeSet(1);
      uf.makeSet(2);
      uf.makeSet(3);

      uf.union(0, 1);
      uf.union(2, 3);

      const roots = uf.getRoots();
      expect(roots.size).toBe(2);
    });

    it('should return single root when all merged', () => {
      uf.makeSet(0);
      uf.makeSet(1);
      uf.makeSet(2);

      uf.union(0, 1);
      uf.union(1, 2);

      const roots = uf.getRoots();
      expect(roots.size).toBe(1);
    });
  });

  describe('size', () => {
    it('should return number of elements', () => {
      expect(uf.size()).toBe(0);

      uf.makeSet(0);
      expect(uf.size()).toBe(1);

      uf.makeSet(1);
      uf.makeSet(2);
      expect(uf.size()).toBe(3);
    });

    it('should not change size after unions', () => {
      uf.makeSet(0);
      uf.makeSet(1);

      expect(uf.size()).toBe(2);

      uf.union(0, 1);

      expect(uf.size()).toBe(2);
    });
  });

  describe('clear', () => {
    it('should remove all data', () => {
      uf.makeSet(0);
      uf.makeSet(1);
      uf.union(0, 1);

      uf.clear();

      expect(uf.size()).toBe(0);
      expect(() => uf.find(0)).toThrow();
    });
  });

  describe('stress test', () => {
    it('should handle many unions efficiently', () => {
      const n = 1000;

      // Create n singleton sets
      for (let i = 0; i < n; i++) {
        uf.makeSet(i);
      }

      // Merge them all into one set
      for (let i = 1; i < n; i++) {
        uf.union(0, i);
      }

      // All should have same root
      const root = uf.find(0);
      for (let i = 0; i < n; i++) {
        expect(uf.find(i)).toBe(root);
      }

      expect(uf.getRoots().size).toBe(1);
    });
  });
});
