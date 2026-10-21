import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { PRESETS } from '../presets';
import { getSnapshotNode } from './timeline';
import { preset, rule, run, lastState, termArb, rulesArb } from '../test/helpers';
import type { EGraphState, EGraphTimeline, Implementation } from './types';

const PHASE_CODES: Record<EGraphState['phase'], string> = {
    init: 'I', read: 'R', 'read-batch': 'B', write: 'W', compact: 'C', repair: 'P', done: 'D'
};
const phaseString = (t: EGraphTimeline) => t.states.map(s => PHASE_CODES[s.phase]).join('');

// One iteration: deferred = batches, writes, compaction, repairs; naive = read, then (write, repairs)*
const GRAMMAR: Record<Implementation, RegExp> = {
    deferred: /^I(B+(W+C*P*)?)*D$/,
    naive: /^I(R(WP*)*)*D$/
};

const limits = { iterationCap: 5, maxNodes: 120 };

function nodeCount(s: EGraphState) {
    return s.nodeChunks.reduce((n, c) => n + c.length, 0);
}

describe('timeline structure', () => {
    it.each(['naive', 'deferred'] as const)('follows the %s phase grammar (presets)', impl => {
        for (const p of PRESETS) {
            const { timeline } = run(p, { implementation: impl, parallelism: 3 });
            expect(phaseString(timeline), p.id).toMatch(GRAMMAR[impl]);
        }
    });

    it('follows the phase grammar (random inputs)', () => {
        fc.assert(
            fc.property(termArb, rulesArb, fc.constantFrom('naive', 'deferred'), (root, rules, impl) => {
                const { timeline } = run(preset(root, rules), { ...limits, implementation: impl });
                expect(phaseString(timeline)).toMatch(GRAMMAR[impl]);
            }),
            { numRuns: 100 }
        );
    });

    it('numbers snapshots consecutively with stable ids', () => {
        const { timeline } = run(PRESETS[0]);
        timeline.states.forEach((s, i) => {
            expect(s.stepIndex).toBe(i);
            expect(s.id).toBe(`${PRESETS[0].id}:${i}`);
            expect(s.presetId).toBe(PRESETS[0].id);
            expect(s.implementation).toBe('deferred');
        });
    });

    it('only references ids that exist in the snapshot', () => {
        fc.assert(
            fc.property(termArb, rulesArb, fc.constantFrom('naive', 'deferred'), (root, rules, impl) => {
                const { timeline } = run(preset(root, rules), { ...limits, implementation: impl });
                for (const s of timeline.states) {
                    const n = nodeCount(s);
                    expect(s.unionFind.length).toBe(n);
                    const live = new Set(s.eclasses.flatMap(c => c.nodes.map(x => x.id)));
                    for (const d of s.metadata.diffs) {
                        if (d.type === 'add') expect(d.nodeId).toBeLessThan(n);
                        if (d.type === 'merge') [d.winner, ...d.losers].forEach(id => expect(id).toBeLessThan(n));
                        if (d.type === 'remove') expect(live.has(d.nodeId)).toBe(false);
                    }
                    for (const m of s.metadata.matches) m.nodes.forEach(id => expect(id).toBeLessThan(n));
                    if (s.phase === 'read' || s.phase === 'read-batch') {
                        // matched e-nodes are visible in the snapshot that reports them
                        for (const m of s.metadata.matches) m.nodes.forEach(id => expect(live.has(id)).toBe(true));
                    }
                    s.metadata.applied?.forEach(a => a.newNodes.forEach(id => expect(live.has(id)).toBe(true)));
                    for (const h of s.hashcons) expect(s.unionFind[h.eclass].isCanonical).toBe(true);
                    for (const id of s.nodeChunks.flat().keys()) expect(getSnapshotNode(s, id)).toBeDefined();
                }
            }),
            { numRuns: 60 }
        );
    });
});

describe('structural sharing', () => {
    const { timeline } = run(PRESETS.find(p => p.id === 'nested-functions')!, { parallelism: 1 });
    const states = timeline.states;

    it('reuses the union-find array when nothing was merged', () => {
        const batches = states.filter(s => s.phase === 'read-batch');
        expect(batches[1].unionFind).toBe(batches[0].unionFind);
    });

    it('reuses e-class view models for untouched classes', () => {
        const [a, b] = states.filter(s => s.phase === 'read-batch');
        a.eclasses.forEach((c, i) => expect(b.eclasses[i]).toBe(c));
    });

    it('reuses node chunks and hashcons until they change', () => {
        const [a, b] = states.filter(s => s.phase === 'read-batch');
        expect(b.nodeChunks).toBe(a.nodeChunks);
        expect(b.hashcons).toBe(a.hashcons);
        const writes = states.filter(s => s.phase === 'write');
        expect(writes.length).toBeGreaterThan(0);
    });

    it('shares one writelist entry array per iteration', () => {
        const firstIteration = states.filter(s => s.metadata.iteration === 0 && s.metadata.writelist);
        const arrays = new Set(firstIteration.map(s => s.metadata.writelist!.entries));
        expect(arrays.size).toBe(1);

        const batches = firstIteration.filter(s => s.phase === 'read-batch');
        for (let i = 1; i < batches.length; i++) {
            expect(batches[i].metadata.writelist!.count).toBeGreaterThanOrEqual(batches[i - 1].metadata.writelist!.count);
            expect(batches[i].metadata.writelist!.nextIndex).toBe(0);
        }
        const writes = firstIteration.filter(s => s.phase === 'write');
        for (let i = 1; i < writes.length; i++) {
            expect(writes[i].metadata.writelist!.nextIndex).toBeGreaterThan(writes[i - 1].metadata.writelist!.nextIndex);
        }
    });

    it('does not mutate earlier snapshots', () => {
        const frozen = JSON.stringify(states.map(s => [s.eclasses, s.unionFind, s.worklist, s.hashcons]));
        // Running another engine must not affect this timeline
        run(PRESETS.find(p => p.id === 'nested-functions')!, { parallelism: 1 });
        expect(JSON.stringify(states.map(s => [s.eclasses, s.unionFind, s.worklist, s.hashcons]))).toBe(frozen);
    });
});

describe('metadata', () => {
    it('describes each read batch', () => {
        const { timeline } = run(PRESETS.find(p => p.id === 'nested-functions')!, { parallelism: 4 });
        const batches = timeline.states.filter(s => s.phase === 'read-batch' && s.metadata.iteration === 0);
        const total = batches[0].metadata.batch!.total;
        expect(batches.length).toBe(total);
        const order = batches[0].metadata.batch!.order;
        batches.forEach((s, i) => {
            const b = s.metadata.batch!;
            expect(b.index).toBe(i);
            expect(b.size).toBe(4);
            expect(b.order).toBe(order); // one shared array per read phase
            expect(b.classIds).toEqual(order.slice(i * 4, (i + 1) * 4));
        });
        expect([...order].sort((a, b) => a - b)).toEqual(batches[0].eclasses.map(c => c.id));
        const searched = batches.flatMap(s => s.metadata.batch!.classIds);
        expect(new Set(searched).size).toBe(batches[0].eclasses.length);
    });

    it('describes each applied rewrite', () => {
        const p = preset({ op: '*', args: ['a', '2'] }, [rule('shift', { op: '*', args: ['?x', '2'] }, { op: '<<', args: ['?x', '1'] })]);
        for (const impl of ['naive', 'deferred'] as const) {
            const { timeline } = run(p, { implementation: impl });
            const write = timeline.states.find(s => s.phase === 'write')!;
            expect(write.metadata.applied).toEqual([{
                rule: 'shift', targetClass: 2, createdId: 4, newNodes: [3, 4], lhsNodes: [2, 1], worker: 0,
                ...(impl === 'deferred' ? { entry: 0 } : {})
            }]);
            expect(write.metadata.diffs.map(d => d.type)).toEqual(['add', 'add', 'merge', 'rewrite']);
        }
    });

    it('records compaction and repair targets', () => {
        const p = preset({ op: 'f', args: ['a', 'b'] }, [rule('ab', 'a', 'b')]);
        const { timeline } = run(p, { implementation: 'deferred' });
        const compact = timeline.states.find(s => s.phase === 'compact')!;
        const winner = compact.unionFind[0].canonical; // union winner is chosen by the seeded rng
        expect(compact.metadata.activeId).toBe(winner);
        expect(compact.metadata.compactedId).toBe(1 - winner);
        const repair = timeline.states.find(s => s.phase === 'repair')!;
        expect(repair.metadata.activeId).toBe(winner);
        expect(repair.metadata.repairedNodes).toEqual([2]);
    });

    it('reports the halt reason on the final snapshot', () => {
        const grow = preset({ op: 'f', args: ['a'] }, [rule('g', { op: 'f', args: ['?x'] }, { op: 'f', args: [{ op: 'g', args: ['?x'] }] })]);
        expect(lastState(run(grow, { iterationCap: 3 }).timeline).metadata.haltedReason).toBe('iteration-cap');
        expect(run(grow, { maxNodes: 10, iterationCap: 100 }).timeline.haltedReason).toBe('node-limit');
        expect(run(grow, { maxSteps: 25, iterationCap: 100 }).timeline.haltedReason).toBe('step-limit');
        const sat = run(preset('a', [rule('noop', 'b', 'c')])).timeline;
        expect(sat.haltedReason).toBe('saturated');
    });

    it('respects iteration caps from preset hints unless overridden', () => {
        const grow = { ...preset({ op: 'f', args: ['a'] }, [rule('g', { op: 'f', args: ['?x'] }, { op: 'f', args: [{ op: 'g', args: ['?x'] }] })]), implementationHints: { iterationCap: 2 } };
        expect(lastState(run(grow).timeline).metadata.iteration).toBe(2);
        expect(lastState(run(grow, { iterationCap: 4 }).timeline).metadata.iteration).toBe(4);
    });
});
