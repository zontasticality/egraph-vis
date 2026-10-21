import { describe, it, expect } from 'vitest';
import { PRESETS } from './index';
import { collectVariables, parsePattern, stringifyPattern } from '../engine/parser';
import { checkInvariants } from '../engine/invariants';
import { run, lastState, isSaturated, lookupPattern } from '../test/helpers';
import { isVariablePattern } from '../utils/typeGuards';
import type { Implementation } from '../engine/types';

const MODES: Implementation[] = ['naive', 'deferred'];

describe('built-in presets', () => {
    it('parallel-matching gives several workers a match in the same batch', () => {
        const pm = PRESETS.find(p => p.id === 'parallel-matching')!;
        const parallelism = pm.implementationHints!.parallelism!;
        const { timeline } = run(pm, { implementation: 'deferred', parallelism });
        const busiest = Math.max(...timeline.states
            .filter(s => s.phase === 'read-batch')
            .map(s => new Set(s.metadata.matches.map(m => m.eclassId)).size));
        expect(busiest).toBeGreaterThanOrEqual(3);
    });

    it('have unique ids and labels', () => {
        expect(new Set(PRESETS.map(p => p.id)).size).toBe(PRESETS.length);
        expect(new Set(PRESETS.map(p => p.label)).size).toBe(PRESETS.length);
    });

    describe.each(PRESETS.map(p => [p.id, p] as const))('%s', (_id, preset) => {
        it('has well-formed rules', () => {
            const names = new Set<string>();
            for (const r of preset.rewrites) {
                expect(names.has(r.name), `duplicate rule name ${r.name}`).toBe(false);
                names.add(r.name);
                expect(isVariablePattern(r.lhs)).toBe(false);
                const bound = collectVariables(r.lhs);
                for (const v of collectVariables(r.rhs)) expect(bound.has(v), `${r.name}: ${v} unbound`).toBe(true);
                expect(parsePattern(stringifyPattern(r.lhs))).toEqual(r.lhs);
                expect(parsePattern(stringifyPattern(r.rhs))).toEqual(r.rhs);
            }
            expect(parsePattern(stringifyPattern(preset.root))).toEqual(preset.root);
        });

        it.each(MODES)('runs in %s mode with valid invariants', impl => {
            const { engine, timeline } = run(preset, { implementation: impl, parallelism: 2, debugInvariants: true });
            const rt = engine.getRuntime();
            expect(checkInvariants(rt)).toEqual([]);
            expect(lastState(timeline).phase).toBe('done');
            expect(lastState(timeline).metadata.haltedReason).toBe(timeline.haltedReason);
            if (timeline.haltedReason === 'saturated') {
                expect(isSaturated(rt, preset.rewrites)).toBe(true);
            }
            // Keep presets snappy to play back
            expect(timeline.states.length).toBeLessThan(5000);
        });
    });
});

describe('preset semantics', () => {
    const byId = (id: string) => PRESETS.find(p => p.id === id)!;

    it.each(MODES)('paper example: (a * 2) / 2 = a (%s)', impl => {
        const { engine, timeline } = run(byId('paper-example'), { implementation: impl });
        expect(timeline.haltedReason).toBe('saturated');
        const rt = engine.getRuntime();
        const root = lookupPattern(rt, parsePattern('/(*(a, 2), 2)'), new Map());
        expect(root).toBeDefined();
        expect(root).toBe(lookupPattern(rt, 'a', new Map()));
        expect(lookupPattern(rt, parsePattern('<<(a, 1)'), new Map())).toBe(lookupPattern(rt, parsePattern('*(a, 2)'), new Map()));
        // Same final e-graph as egg's Figure 2: {a, a*1, (a<<1)/2}, {1, 2/2}, {a*2, a<<1}, {2}
        expect(rt.eclasses.size).toBe(4);
        expect(rt.liveNodeIds().length).toBe(8);
    });

    it.each(MODES)('nested functions collapse by congruence (%s)', impl => {
        const { engine, timeline } = run(byId('nested-functions'), { implementation: impl, parallelism: 5 });
        expect(timeline.haltedReason).toBe('saturated');
        const rt = engine.getRuntime();
        // a,b,c,d,e all equal => i(..), h(..), g(..), f(..) each collapse to a single e-node
        expect(rt.eclasses.size).toBe(6);
        expect(rt.liveNodeIds().length).toBe(10); // a,b,c,d,e + i,h,g,f + x
    });

    it.each(MODES)('associativity explosion saturates with every bracketing (%s)', impl => {
        const { engine, timeline } = run(byId('assoc-explosion'), { implementation: impl });
        expect(timeline.haltedReason).toBe('saturated');
        const rt = engine.getRuntime();
        // One e-class per contiguous range of a..f, one e-node per split point
        expect(rt.eclasses.size).toBe(21);
        expect(rt.liveNodeIds().length).toBe(6 + 35);
    });

    it.each(MODES)('non-terminating growth never saturates (%s)', impl => {
        const { timeline } = run(byId('non-terminating'), { implementation: impl });
        expect(timeline.haltedReason).toBe('iteration-cap');
    });

    it.each(MODES)('double distributivity is stopped by the node limit (%s)', impl => {
        const { timeline, engine } = run(byId('double-distributivity'), { implementation: impl, maxNodes: 300 });
        expect(timeline.haltedReason).toBe('node-limit');
        expect(engine.getRuntime().worklist.size).toBe(0); // rebuilt before halting
    });

    it.each(MODES)('transitive chain merges every leaf (%s)', impl => {
        const { engine } = run(byId('transitive-chain'), { implementation: impl });
        const rt = engine.getRuntime();
        const ids = ['a', 'b', 'c', 'd', 'e'].map(c => lookupPattern(rt, c, new Map()));
        expect(new Set(ids).size).toBe(1);
    });
});
