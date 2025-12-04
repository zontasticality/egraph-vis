import { describe, it, expect } from 'vitest';
import { TimelineEngine } from './timeline';
import type { PresetConfig } from './types';

describe('TimelineEngine - Recursive and Constant Rules', () => {
    it('should handle commutativity without infinite loops', async () => {
        const engine = new TimelineEngine();
        const preset: PresetConfig = {
            id: 'test-comm-mult',
            label: 'Commutativity Multiply',
            description: 'Test *(?x, ?y) -> *(?y, ?x)',
            root: { op: '*', args: ['a', 'b'] },
            rewrites: [{
                name: 'comm-mult',
                lhs: { op: '*', args: ['?x', '?y'] },
                rhs: { op: '*', args: ['?y', '?x'] },
                enabled: true
            }]
        };

        engine.loadPreset(preset, { iterationCap: 10, implementation: 'deferred' });
        const timeline = await engine.runUntilHalt();

        // Should saturate without hitting iteration cap
        expect(timeline.haltedReason).toBe('saturated');

        const finalState = timeline.states[timeline.states.length - 1];

        // Root class should contain both (a*b) and (b*a)
        const classA = finalState.eclasses.find(c => c.nodes.some(n => n.op === 'a'))!;
        const classB = finalState.eclasses.find(c => c.nodes.some(n => n.op === 'b'))!;
        const rootClass = finalState.eclasses.find(c => c.nodes.some(n => n.op === '*'))!;

        const hasAB = rootClass.nodes.some(n => n.args[0] === classA.id && n.args[1] === classB.id);
        const hasBA = rootClass.nodes.some(n => n.args[0] === classB.id && n.args[1] === classA.id);

        expect(hasAB).toBe(true);
        expect(hasBA).toBe(true);
    });

    it('should handle constant rewrites (1 -> 2)', async () => {
        const engine = new TimelineEngine();
        const preset: PresetConfig = {
            id: 'test-const',
            label: 'Constant Rewrite',
            description: 'Test 1 -> 2',
            root: { op: '+', args: [{ op: '1', args: [] }, { op: 'a', args: [] }] },
            rewrites: [{
                name: 'one-to-two',
                lhs: '1',
                rhs: '2',
                enabled: true
            }]
        };

        engine.loadPreset(preset, { iterationCap: 10, implementation: 'deferred' });
        const timeline = await engine.runUntilHalt();

        const finalState = timeline.states[timeline.states.length - 1];

        // Find the class for '1' - it should also contain '2'
        const const1Class = finalState.eclasses.find(c => c.nodes.some(n => n.op === '1'));
        expect(const1Class).toBeDefined();
        expect(const1Class!.nodes.some(n => n.op === '2')).toBe(true);

        // Verify the merge happened
        expect(finalState.eclasses.some(c =>
            c.nodes.some(n => n.op === '1') && c.nodes.some(n => n.op === '2')
        )).toBe(true);
    });

    it('should saturate for cycle-creating rules (not expand infinitely)', async () => {
        const engine = new TimelineEngine();
        const preset: PresetConfig = {
            id: 'test-cycle',
            label: 'Cycle Creation',
            description: 'Test ?x -> f(?x) creates a = f(a) cycle',
            root: 'a',
            rewrites: [{
                name: 'wrap',
                lhs: '?x',
                rhs: { op: 'f', args: ['?x'] },
                enabled: true
            }]
        };

        engine.loadPreset(preset, { iterationCap: 5, implementation: 'deferred' });
        const timeline = await engine.runUntilHalt();

        // Should saturate because hash-consing prevents duplicate f(class_a)
        // After first iteration: a = f(a), then f(class_a) already exists
        expect(timeline.haltedReason).toBe('saturated');

        const finalState = timeline.states[timeline.states.length - 1];

        // Verify 'a' and 'f' are in the same class (cycle)
        const aClass = finalState.eclasses.find(c => c.nodes.some(n => n.op === 'a'));
        expect(aClass).toBeDefined();
        expect(aClass!.nodes.some(n => n.op === 'f')).toBe(true);
    });

    it('should handle nested term like /(*(*(a, b), 2), 2)', async () => {
        const engine = new TimelineEngine();
        const preset: PresetConfig = {
            id: 'test-nested',
            label: 'Nested Term',
            description: 'Test /(*(*(a, b), 2), 2) with mul-div cancel',
            root: {
                op: '/',
                args: [
                    {
                        op: '*',
                        args: [
                            { op: '*', args: ['a', 'b'] },
                            '2'
                        ]
                    },
                    '2'
                ]
            },
            rewrites: [
                {
                    name: 'div-mul-cancel',
                    lhs: { op: '/', args: [{ op: '*', args: ['?x', '?y'] }, '?y'] },
                    rhs: '?x',
                    enabled: true
                },
                {
                    name: 'mul-assoc',
                    lhs: { op: '*', args: [{ op: '*', args: ['?a', '?b'] }, '?c'] },
                    rhs: { op: '*', args: ['?a', { op: '*', args: ['?b', '?c'] }] },
                    enabled: true
                }
            ]
        };

        engine.loadPreset(preset, { iterationCap: 20, implementation: 'deferred' });
        const timeline = await engine.runUntilHalt();

        const finalState = timeline.states[timeline.states.length - 1];

        // Should successfully parse and run without errors
        expect(finalState.eclasses.length).toBeGreaterThan(0);

        // Should have created the nested structure
        expect(finalState.eclasses.some(c => c.nodes.some(n => n.op === '/'))).toBe(true);
        expect(finalState.eclasses.some(c => c.nodes.some(n => n.op === '*'))).toBe(true);
    });
});
