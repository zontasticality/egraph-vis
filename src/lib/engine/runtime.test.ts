import { describe, it, expect, beforeEach } from 'vitest';
import { EGraphRuntime, UnionFind, SeededRandom } from './runtime';
import { rebuild } from './algorithms';
import { checkInvariants } from './invariants';

describe('UnionFind', () => {
    it('creates singleton sets and finds them', () => {
        const uf = new UnionFind();
        for (let i = 0; i < 5; i++) uf.makeSet(i);
        expect(uf.size).toBe(5);
        for (let i = 0; i < 5; i++) expect(uf.find(i)).toBe(i);
    });

    it('throws on unknown ids', () => {
        const uf = new UnionFind();
        uf.makeSet(0);
        expect(() => uf.find(1)).toThrow(/Unknown ENodeId/);
        expect(() => uf.find(-1)).toThrow(/Unknown ENodeId/);
    });

    it('unions to the smaller id without an rng', () => {
        const uf = new UnionFind();
        for (let i = 0; i < 4; i++) uf.makeSet(i);
        expect(uf.union(3, 1)).toBe(1);
        expect(uf.union(2, 3)).toBe(1);
        expect([0, 1, 2, 3].map(i => uf.find(i))).toEqual([0, 1, 1, 1]);
        expect(uf.union(1, 2)).toBe(1); // already merged
    });

    it('is deterministic for a given seed', () => {
        const winners = (seed: number) => {
            const uf = new UnionFind();
            const rng = new SeededRandom(seed);
            for (let i = 0; i < 16; i++) uf.makeSet(i);
            const out: number[] = [];
            for (let i = 0; i < 15; i += 2) out.push(uf.union(i, i + 1, rng));
            return out;
        };
        expect(winners(7)).toEqual(winners(7));
        // A random union picks either root
        const w = winners(7);
        w.forEach((winner, k) => expect([2 * k, 2 * k + 1]).toContain(winner));
    });

    it('handles long chains without recursion limits', () => {
        const uf = new UnionFind();
        const n = 200_000;
        for (let i = 0; i < n; i++) uf.makeSet(i);
        // Build a worst-case chain by always attaching the root of the chain under a new node
        for (let i = 1; i < n; i++) (uf as any).parent[i - 1] = i;
        expect(uf.find(0)).toBe(n - 1);
        expect(uf.find(0)).toBe(n - 1); // path compressed
    });

    it('exports canonical entries', () => {
        const uf = new UnionFind();
        for (let i = 0; i < 3; i++) uf.makeSet(i);
        uf.union(0, 2);
        expect(uf.toArray()).toEqual([
            { id: 0, canonical: 0, isCanonical: true },
            { id: 1, canonical: 1, isCanonical: true },
            { id: 2, canonical: 0, isCanonical: false }
        ]);
    });
});

describe('EGraphRuntime', () => {
    let rt: EGraphRuntime;
    beforeEach(() => {
        rt = new EGraphRuntime();
    });

    describe('addEnode / hashcons', () => {
        it('hashconses identical e-nodes', () => {
            const a = rt.addEnode({ op: 'a', args: [] });
            const fa1 = rt.addEnode({ op: 'f', args: [a] });
            const fa2 = rt.addEnode({ op: 'f', args: [a] });
            expect(fa1).toBe(fa2);
            expect(rt.nextId).toBe(2);
            expect(rt.hashcons.get('f(0)')).toBe(fa1);
        });

        it('registers new e-nodes as parents of their children once', () => {
            const a = rt.addEnode({ op: 'a', args: [] });
            const aa = rt.addEnode({ op: '+', args: [a, a] });
            const parents = rt.getParents(a);
            expect(parents.map(p => p.parentId)).toEqual([aa]);
        });

        it('records add diffs', () => {
            rt.addEnode({ op: 'a', args: [] });
            expect(rt.diffs).toEqual([{ type: 'add', nodeId: 0, enode: { op: 'a', args: [] } }]);
        });

        it('canonicalizes children before hashconsing', () => {
            const a = rt.addEnode({ op: 'a', args: [] });
            const b = rt.addEnode({ op: 'b', args: [] });
            const fa = rt.addEnode({ op: 'f', args: [a] });
            rt.merge(a, b);
            rebuild(rt);
            // f(b) is now the same e-node as f(a)
            expect(rt.addEnode({ op: 'f', args: [b] })).toBe(rt.find(fa));
        });
    });

    describe('merge', () => {
        it('naive: moves nodes, deletes the loser and queues the winner', () => {
            const a = rt.addEnode({ op: 'a', args: [] });
            const b = rt.addEnode({ op: 'b', args: [] });
            rt.diffs = [];
            const w = rt.merge(a, b, 'naive');
            expect(w).toBe(0);
            expect(rt.eclasses.has(1)).toBe(false);
            expect(rt.eclasses.get(0)!.nodes.sort()).toEqual([0, 1]);
            expect(Array.from(rt.worklist)).toEqual([0]);
            expect(rt.diffs).toEqual([{ type: 'merge', winner: 0, losers: [1] }]);
            expect(rt.unionCount).toBe(1);
        });

        it('deferred: keeps the loser class around until compaction', () => {
            const a = rt.addEnode({ op: 'a', args: [] });
            const b = rt.addEnode({ op: 'b', args: [] });
            rt.diffs = [];
            rt.merge(a, b, 'deferred');
            expect(rt.find(b)).toBe(a);
            expect(rt.eclasses.get(1)!.nodes).toEqual([1]);
            expect(rt.eclasses.get(0)!.nodes).toEqual([0]);
            expect(rt.diffs).toEqual([{ type: 'merge', winner: 0, losers: [1] }]);
            rebuild(rt);
            expect(rt.eclasses.has(1)).toBe(false);
            expect(rt.eclasses.get(0)!.nodes.sort()).toEqual([0, 1]);
            expect(checkInvariants(rt)).toEqual([]);
        });

        it('is a no-op for already equivalent classes', () => {
            const a = rt.addEnode({ op: 'a', args: [] });
            rt.diffs = [];
            expect(rt.merge(a, a)).toBe(a);
            expect(rt.diffs).toEqual([]);
            expect(rt.worklist.size).toBe(0);
        });

        it('winner inherits the parents of the loser', () => {
            const a = rt.addEnode({ op: 'a', args: [] });
            const b = rt.addEnode({ op: 'b', args: [] });
            const fb = rt.addEnode({ op: 'f', args: [b] });
            rt.merge(a, b, 'deferred');
            expect(rt.getParents(a).map(p => p.parentId)).toContain(fb);
        });
    });

    describe('repairClass / rebuild', () => {
        it('merges congruent parents and removes the duplicate e-node', () => {
            const a = rt.addEnode({ op: 'a', args: [] });
            const b = rt.addEnode({ op: 'b', args: [] });
            const fa = rt.addEnode({ op: 'f', args: [a] });
            const fb = rt.addEnode({ op: 'f', args: [b] });
            rt.merge(a, b, 'deferred');
            rt.diffs = [];
            rebuild(rt);

            expect(rt.find(fa)).toBe(rt.find(fb));
            const fClass = rt.eclasses.get(rt.find(fa))!;
            expect(fClass.nodes).toEqual([fa]);
            expect(rt.removedNodes.has(fb)).toBe(true);
            expect(rt.diffs).toContainEqual({ type: 'remove', nodeId: fb, duplicateOf: fa });
            expect(checkInvariants(rt)).toEqual([]);
        });

        it('re-canonicalizes stored children and fixes the hashcons', () => {
            const a = rt.addEnode({ op: 'a', args: [] });
            const b = rt.addEnode({ op: 'b', args: [] });
            const gb = rt.addEnode({ op: 'g', args: [b] });
            rt.merge(a, b, 'deferred');
            expect(rt.nodes[gb].args).toEqual([b]); // stale until repaired
            expect(checkInvariants(rt).length).toBeGreaterThan(0);

            rebuild(rt);
            expect(rt.nodes[gb].args).toEqual([a]);
            expect(rt.hashcons.has('g(1)')).toBe(false);
            expect(rt.hashcons.get('g(0)')).toBe(gb);
            expect(checkInvariants(rt)).toEqual([]);
        });

        it('cascades congruence upwards (f(g(a)) = f(g(b)))', () => {
            const a = rt.addEnode({ op: 'a', args: [] });
            const b = rt.addEnode({ op: 'b', args: [] });
            const ga = rt.addEnode({ op: 'g', args: [a] });
            const gb = rt.addEnode({ op: 'g', args: [b] });
            const fga = rt.addEnode({ op: 'f', args: [ga] });
            const fgb = rt.addEnode({ op: 'f', args: [gb] });
            rt.merge(a, b);
            rebuild(rt);
            expect(rt.find(ga)).toBe(rt.find(gb));
            expect(rt.find(fga)).toBe(rt.find(fgb));
            expect(rt.eclasses.size).toBe(3);
            expect(checkInvariants(rt)).toEqual([]);
        });

        it('handles congruence on multi-argument nodes', () => {
            const a = rt.addEnode({ op: 'a', args: [] });
            const b = rt.addEnode({ op: 'b', args: [] });
            const c = rt.addEnode({ op: 'c', args: [] });
            const pab = rt.addEnode({ op: '+', args: [a, c] });
            const pbc = rt.addEnode({ op: '+', args: [b, c] });
            const pca = rt.addEnode({ op: '+', args: [c, a] });
            rt.merge(a, b, 'deferred');
            rebuild(rt);
            expect(rt.find(pab)).toBe(rt.find(pbc));
            expect(rt.find(pca)).not.toBe(rt.find(pab));
            expect(checkInvariants(rt)).toEqual([]);
        });

        it('handles cycles (a = f(a))', () => {
            const a = rt.addEnode({ op: 'a', args: [] });
            const fa = rt.addEnode({ op: 'f', args: [a] });
            const ffa = rt.addEnode({ op: 'f', args: [fa] });
            rt.merge(a, fa);
            rebuild(rt);
            // f(a) = a, so f(f(a)) = f(a) = a
            expect(rt.find(ffa)).toBe(rt.find(a));
            expect(rt.eclasses.size).toBe(1);
            const cls = rt.eclasses.get(rt.find(a))!;
            expect(cls.nodes.map(n => rt.nodes[n].op).sort()).toEqual(['a', 'f']);
            expect(checkInvariants(rt)).toEqual([]);
        });

        it('keeps parents of merged classes when congruent merges happen mid-repair', () => {
            // Regression: assigning the deduplicated parent list *after* merging
            // would drop parents appended by those merges.
            const x = rt.addEnode({ op: 'x', args: [] });
            const y = rt.addEnode({ op: 'y', args: [] });
            const fx = rt.addEnode({ op: 'f', args: [x] });
            const fy = rt.addEnode({ op: 'f', args: [y] });
            const hfx = rt.addEnode({ op: 'h', args: [fx] });
            const hfy = rt.addEnode({ op: 'h', args: [fy] });
            const gfy = rt.addEnode({ op: 'g', args: [fy] });
            rt.merge(x, y, 'deferred');
            rebuild(rt);
            expect(rt.find(hfx)).toBe(rt.find(hfy));
            expect(rt.getParents(fx).map(p => p.parentId)).toContain(gfy);
            expect(checkInvariants(rt)).toEqual([]);
        });
    });
});
