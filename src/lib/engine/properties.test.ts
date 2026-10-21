/**
 * Property-based tests: random ground terms + random rewrite rules, run through
 * both engine implementations.
 */
import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { checkInvariants } from './invariants';
import { preset, run, isSaturated, partitionSignature, termArb, rulesArb } from '../test/helpers';
import type { EGraphState } from './types';

const LIMITS = { iterationCap: 6, maxNodes: 150, maxSteps: 3000 };
const NUM_RUNS = Number((globalThis as any).process?.env?.FC_RUNS ?? 150);

function stateInvariants(s: EGraphState): string[] {
    const errors: string[] = [];
    const nodeCount = s.nodeChunks.reduce((n, c) => n + c.length, 0);
    const seen = new Set<number>();
    for (const c of s.eclasses) {
        if (s.unionFind[c.id] === undefined) errors.push(`class ${c.id} missing from union-find`);
        for (const n of c.nodes) {
            if (seen.has(n.id)) errors.push(`node ${n.id} in two classes`);
            seen.add(n.id);
            if (n.id >= nodeCount) errors.push(`node ${n.id} missing from registry`);
            if (s.unionFind[n.id].canonical !== s.unionFind[c.id].canonical) {
                errors.push(`node ${n.id} in class ${c.id} but in a different union-find set`);
            }
            for (const a of n.args) if (a >= nodeCount) errors.push(`node ${n.id} has unknown arg ${a}`);
        }
    }
    for (const id of s.worklist) if (s.unionFind[id] === undefined) errors.push(`worklist id ${id} unknown`);
    for (const [id] of s.visualStates.nodes) if (!seen.has(id)) errors.push(`visual state for absent node ${id}`);
    return errors;
}

describe('engine properties (random terms × random rules)', () => {
    it('maintains invariants after every rebuild and only halts when saturated or limited', () => {
        fc.assert(
            fc.property(termArb, rulesArb, fc.constantFrom('naive', 'deferred'), fc.integer({ min: 1, max: 4 }),
                (root, rules, implementation, parallelism) => {
                    const p = preset(root, rules);
                    const { engine, timeline } = run(p, { ...LIMITS, implementation, parallelism, debugInvariants: true });
                    const rt = engine.getRuntime();

                    expect(checkInvariants(rt)).toEqual([]);
                    if (timeline.haltedReason === 'saturated') {
                        expect(isSaturated(rt, rules)).toBe(true);
                    } else {
                        expect(['iteration-cap', 'node-limit', 'step-limit']).toContain(timeline.haltedReason);
                    }

                    for (const s of timeline.states) {
                        expect(stateInvariants(s)).toEqual([]);
                    }
                }),
            { numRuns: NUM_RUNS }
        );
    });

    it('naive and deferred reach the same saturated e-graph', () => {
        fc.assert(
            fc.property(termArb, rulesArb, (root, rules) => {
                const p = preset(root, rules);
                const naive = run(p, { ...LIMITS, implementation: 'naive' });
                const deferred = run(p, { ...LIMITS, implementation: 'deferred', parallelism: 3 });
                fc.pre(naive.timeline.haltedReason === 'saturated' && deferred.timeline.haltedReason === 'saturated');

                const a = naive.engine.getRuntime();
                const b = deferred.engine.getRuntime();
                // Same number of e-classes and (deduplicated) e-nodes
                expect(a.eclasses.size).toBe(b.eclasses.size);
                expect(a.liveNodeIds().length).toBe(b.liveNodeIds().length);
                // The initial term gets identical IDs in both modes; it must be partitioned identically
                const n = naive.timeline.states[0].nodeChunks.reduce((k, c) => k + c.length, 0);
                expect(partitionSignature(a, n)).toBe(partitionSignature(b, n));
            }),
            { numRuns: NUM_RUNS }
        );
    });

    it('is deterministic for a fixed seed', () => {
        fc.assert(
            fc.property(termArb, rulesArb, fc.integer({ min: 0, max: 1000 }), (root, rules, seed) => {
                const p = preset(root, rules);
                const strip = (states: EGraphState[]) =>
                    states.map(s => [s.phase, s.eclasses, s.worklist, s.metadata.activeId]);
                const one = run(p, { ...LIMITS, seed });
                const two = run(p, { ...LIMITS, seed });
                expect(strip(two.timeline.states)).toEqual(strip(one.timeline.states));
            }),
            { numRuns: 40 }
        );
    });

    it('leaves a fully rebuilt e-graph when stopped by a node or step limit', () => {
        fc.assert(
            fc.property(
                termArb, rulesArb, fc.constantFrom('naive', 'deferred'),
                fc.integer({ min: 8, max: 60 }), fc.integer({ min: 5, max: 200 }),
                (root, rules, implementation, maxNodes, maxSteps) => {
                    const { engine, timeline } = run(preset(root, rules), {
                        implementation, maxNodes, maxSteps, iterationCap: 50, parallelism: 2
                    });
                    expect(checkInvariants(engine.getRuntime())).toEqual([]);
                    const last = timeline.states[timeline.states.length - 1];
                    expect(last.phase).toBe('done');
                    expect(last.worklist).toEqual([]);
                }
            ),
            { numRuns: NUM_RUNS }
        );
    });

    it('never fires disabled rules', () => {
        fc.assert(
            fc.property(termArb, rulesArb, fc.constantFrom('naive', 'deferred'), (root, rules, implementation) => {
                const disabled = rules.map(r => ({ ...r, enabled: false }));
                const { timeline } = run(preset(root, disabled), { ...LIMITS, implementation });
                expect(timeline.haltedReason).toBe('saturated');
                expect(timeline.states.some(s => s.phase === 'write')).toBe(false);
                for (const s of timeline.states) expect(s.metadata.matches).toEqual([]);
            }),
            { numRuns: 40 }
        );
    });
});
