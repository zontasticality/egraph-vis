import { describe, it, expect } from 'vitest';
import { computeVisualStates } from './visual';
import { NodeStyleClass as N, EClassStyleClass as E } from './types';
import type { EGraphState, StepMetadata } from './types';
import { PRESETS } from '../presets';
import { run } from '../test/helpers';

function meta(extra: Partial<StepMetadata> = {}): StepMetadata {
    return {
        iteration: 0, diffs: [], matches: [], selectionHints: [],
        invariants: { congruenceValid: true, hashconsValid: true }, ...extra
    };
}

// a(0), b(1), f(0) = 2, f(1) = 3; 1 merged into 0 but not yet compacted
const base: Pick<EGraphState, 'eclasses' | 'unionFind' | 'worklist'> = {
    eclasses: [
        { id: 0, nodes: [{ id: 0, op: 'a', args: [] }] },
        { id: 1, nodes: [{ id: 1, op: 'b', args: [] }] },
        { id: 2, nodes: [{ id: 2, op: 'f', args: [0] }] },
        { id: 3, nodes: [{ id: 3, op: 'f', args: [1] }] }
    ],
    unionFind: [
        { id: 0, canonical: 0, isCanonical: true },
        { id: 1, canonical: 0, isCanonical: false },
        { id: 2, canonical: 2, isCanonical: true },
        { id: 3, canonical: 3, isCanonical: true }
    ],
    worklist: [0]
};

describe('computeVisualStates', () => {
    it('marks merged classes, worklist classes and stale e-nodes', () => {
        const v = computeVisualStates({ ...base, phase: 'write', metadata: meta() });
        expect(v.eclasses.get(1)).toEqual({ styleClass: E.Merged, isCanonical: false });
        expect(v.eclasses.get(0)).toEqual({ styleClass: E.InWorklist, isCanonical: true });
        expect(v.eclasses.get(2)!.styleClass).toBe(E.Default);
        expect(v.nodes.get(3)).toEqual({ styleClass: N.NonCanonical });
        expect(v.nodes.has(2)).toBe(false); // sparse
    });

    it('highlights matches during read phases', () => {
        const v = computeVisualStates({
            ...base, phase: 'read-batch',
            metadata: meta({ matches: [{ rule: 'r', eclassId: 2, nodes: [2, 0] }] })
        });
        expect(v.nodes.get(2)!.styleClass).toBe(N.MatchedLHS);
        expect(v.nodes.get(0)!.styleClass).toBe(N.MatchedLHS);
    });

    it('prioritizes new nodes over matched nodes while writing', () => {
        const v = computeVisualStates({
            ...base, phase: 'write',
            metadata: meta({ applied: { rule: 'r', targetClass: 2, createdId: 3, newNodes: [3], lhsNodes: [2, 3] } })
        });
        expect(v.nodes.get(3)!.styleClass).toBe(N.NewNode);
        expect(v.nodes.get(2)!.styleClass).toBe(N.MatchedLHS);
    });

    it('highlights the active class and repaired parents', () => {
        const v = computeVisualStates({
            ...base, phase: 'repair', worklist: [],
            metadata: meta({ activeId: 0, repairedNodes: [2, 3] })
        });
        expect(v.eclasses.get(0)!.styleClass).toBe(E.Active);
        expect(v.nodes.get(2)!.styleClass).toBe(N.ParentNode);
        expect(v.nodes.get(3)!.styleClass).toBe(N.ParentNode);
    });

    it('matches what the engine records for every snapshot', () => {
        for (const p of PRESETS.slice(0, 4)) {
            const { timeline } = run(p, { implementation: 'deferred' });
            for (const s of timeline.states) {
                expect(s.visualStates).toEqual(computeVisualStates(s));
            }
        }
    });
});
