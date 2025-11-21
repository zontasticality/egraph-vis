import { describe, it, expect } from 'vitest';
import { TimelineEngine } from './timeline';
import type { PresetConfig } from './types';

describe('TimelineEngine', () => {
    it('should initialize and run a simple preset', () => {
        const engine = new TimelineEngine();
        const preset: PresetConfig = {
            id: 'test-simple',
            name: 'Test Simple',
            description: 'Simple test',
            root: { op: 'f', args: ['a'] },
            rewrites: []
        };

        engine.loadPreset(preset, { iterationCap: 10, implementation: 'naive' });
        const timeline = engine.runUntilHalt();

        expect(timeline.states.length).toBeGreaterThan(0);
        expect(timeline.haltedReason).toBe('saturated');
    });

    it('should apply rewrites and merge', () => {
        const engine = new TimelineEngine();
        const preset: PresetConfig = {
            id: 'test-rewrite',
            name: 'Test Rewrite',
            description: 'Test rewrite application',
            root: { op: '*', args: ['a', { op: '1', args: [] }] },
            rewrites: [{
                name: 'mul-one',
                lhs: { op: '*', args: ['?x', { op: '1', args: [] }] },
                rhs: '?x',
                enabled: true
            }]
        };

        engine.loadPreset(preset, { iterationCap: 10, implementation: 'naive' });
        const timeline = engine.runUntilHalt();
        const finalState = timeline.states[timeline.states.length - 1];

        // Expected: (* a 1) merges with a
        // E-classes:
        // 0: {a}
        // 1: {1}
        // 2: {(* 0 1)} -> merged with 0
        // Total canonical e-classes should be 2 (a and 1).
        // Wait, (* a 1) is in class 2. Rule says class 2 merges with class 0.
        // So class 2 disappears.
        // Remaining classes: 0 (contains a, (* 0 1)) and 1 (contains 1).

        expect(finalState.eclasses.length).toBe(2);

        // Verify that class 0 contains both 'a' and '*'
        const class0 = finalState.eclasses.find(c => c.nodes.some(n => n.op === 'a'));
        expect(class0).toBeDefined();
        expect(class0!.nodes.some(n => n.op === '*')).toBe(true);
    });

    it('should handle deferred rebuild (congruence)', () => {
        const engine = new TimelineEngine();
        const preset: PresetConfig = {
            id: 'test-rebuild',
            name: 'Test Rebuild',
            description: 'Test deferred rebuild',
            // Better to start with f(a) and f(b) and merge a=b
            // But we can only define one root.
            // Let's define root as list(f(a), f(b))
            root: {
                op: 'list',
                args: [
                    { op: 'f', args: [{ op: 'a', args: [] }] },
                    { op: 'f', args: [{ op: 'b', args: [] }] }
                ]
            },
            rewrites: [{
                name: 'a-is-b',
                lhs: 'a',
                rhs: 'b',
                enabled: true
            }]
        };

        engine.loadPreset(preset, { iterationCap: 10, implementation: 'naive' });
        const timeline = engine.runUntilHalt();
        const finalState = timeline.states[timeline.states.length - 1];

        // 1. a merges with b.
        // 2. f(a) and f(b) should become congruent and merge.
        // 3. list(f(a), f(b)) should have args pointing to same class.

        // Find class for 'a'
        const classA = finalState.eclasses.find(c => c.nodes.some(n => n.op === 'a'));
        expect(classA).toBeDefined();
        // It should also contain 'b'
        expect(classA!.nodes.some(n => n.op === 'b')).toBe(true);

        // Find class for 'f'
        // There should be only ONE class for f(...) because f(a) and f(b) merged
        const fClasses = finalState.eclasses.filter(c => c.nodes.some(n => n.op === 'f'));
        expect(fClasses.length).toBe(1);

        const classF = fClasses[0];
        // It should contain 2 nodes: f(classA) and f(classA) (canonicalized)
        // Actually, deduplication might reduce it to 1 node if they are identical?
        // Runtime canonicalization: f(a) -> f(idA), f(b) -> f(idA).
        // They become identical.
        // So classF might have 1 or 2 nodes depending on implementation details of 'nodes' array.
        // My runtime pushes to array on merge. It doesn't dedupe the array itself aggressively, 
        // but the UI view model might?
        // Let's check if they are in the same class.
        expect(classF.nodes.length).toBeGreaterThanOrEqual(1);
    });

    it('should handle associativity', () => {
        const engine = new TimelineEngine();
        // (a + b) + c -> a + (b + c)
        const preset: PresetConfig = {
            id: 'test-assoc',
            name: 'Associativity',
            description: 'Test associativity',
            root: {
                op: '+',
                args: [
                    { op: '+', args: ['a', 'b'] },
                    'c'
                ]
            },
            rewrites: [{
                name: 'assoc',
                lhs: { op: '+', args: [{ op: '+', args: ['?a', '?b'] }, '?c'] },
                rhs: { op: '+', args: ['?a', { op: '+', args: ['?b', '?c'] }] },
                enabled: true
            }]
        };

        engine.loadPreset(preset, { iterationCap: 10, implementation: 'naive' });
        const timeline = engine.runUntilHalt();
        const finalState = timeline.states[timeline.states.length - 1];

        // We expect the root class to contain both ((a+b)+c) and (a+(b+c))
        // Root class is the one containing the initial structure.
        // We can find it by looking for the class that has '+' with args (classA+B, classC).

        // Let's just verify that we have the expected number of classes or that the new structure exists.
        // New structure: (+ a (+ b c))

        // Find class containing 'a'
        const classA = finalState.eclasses.find(c => c.nodes.some(n => n.op === 'a'))!;
        const classB = finalState.eclasses.find(c => c.nodes.some(n => n.op === 'b'))!;
        const classC = finalState.eclasses.find(c => c.nodes.some(n => n.op === 'c'))!;

        // Find class for (+ b c)
        const classBC = finalState.eclasses.find(c => c.nodes.some(n =>
            n.op === '+' &&
            n.args[0] === classB.id &&
            n.args[1] === classC.id
        ));
        expect(classBC).toBeDefined();

        // Find class for (+ a (+ b c))
        const classABC_right = finalState.eclasses.find(c => c.nodes.some(n =>
            n.op === '+' &&
            n.args[0] === classA.id &&
            n.args[1] === classBC!.id
        ));
        expect(classABC_right).toBeDefined();
    });

    it('should handle commutativity', () => {
        const engine = new TimelineEngine();
        // a + b -> b + a
        const preset: PresetConfig = {
            id: 'test-comm',
            name: 'Commutativity',
            description: 'Test commutativity',
            root: { op: '+', args: ['a', 'b'] },
            rewrites: [{
                name: 'comm',
                lhs: { op: '+', args: ['?a', '?b'] },
                rhs: { op: '+', args: ['?b', '?a'] },
                enabled: true
            }]
        };

        engine.loadPreset(preset, { iterationCap: 10, implementation: 'naive' });
        const timeline = engine.runUntilHalt();
        const finalState = timeline.states[timeline.states.length - 1];

        // Expect root class to contain both (a+b) and (b+a)
        const rootClass = finalState.eclasses.find(c => c.nodes.some(n =>
            n.op === '+' && n.args.length === 2
        ));
        expect(rootClass).toBeDefined();

        // Check for both variants
        // Note: args are canonical IDs.
        // classA and classB are distinct.
        const classA = finalState.eclasses.find(c => c.nodes.some(n => n.op === 'a'))!;
        const classB = finalState.eclasses.find(c => c.nodes.some(n => n.op === 'b'))!;

        const hasAB = rootClass!.nodes.some(n => n.args[0] === classA.id && n.args[1] === classB.id);
        const hasBA = rootClass!.nodes.some(n => n.args[0] === classB.id && n.args[1] === classA.id);

        expect(hasAB).toBe(true);
        expect(hasBA).toBe(true);
    });

    it('should handle arithmetic simplification (shift)', () => {
        const engine = new TimelineEngine();
        // x * 2 -> x << 1
        const preset: PresetConfig = {
            id: 'test-shift',
            name: 'Shift',
            description: 'Test shift simplification',
            root: { op: '*', args: ['x', { op: '2', args: [] }] },
            rewrites: [{
                name: 'shift',
                lhs: { op: '*', args: ['?x', { op: '2', args: [] }] },
                rhs: { op: '<<', args: ['?x', { op: '1', args: [] }] },
                enabled: true
            }]
        };

        engine.loadPreset(preset, { iterationCap: 10, implementation: 'naive' });
        const timeline = engine.runUntilHalt();
        const finalState = timeline.states[timeline.states.length - 1];

        const rootClass = finalState.eclasses.find(c => c.nodes.some(n => n.op === '*'));
        expect(rootClass).toBeDefined();

        // Should also contain '<<'
        expect(rootClass!.nodes.some(n => n.op === '<<')).toBe(true);
    });

    it('should handle complex identity', () => {
        const engine = new TimelineEngine();
        // (x * 2) / 2 -> x
        const preset: PresetConfig = {
            id: 'test-identity',
            name: 'Identity',
            description: 'Test complex identity',
            root: {
                op: '/',
                args: [
                    { op: '*', args: ['x', { op: '2', args: [] }] },
                    { op: '2', args: [] }
                ]
            },
            rewrites: [{
                name: 'div-mul-cancel',
                lhs: { op: '/', args: [{ op: '*', args: ['?x', '?y'] }, '?y'] },
                rhs: '?x',
                enabled: true
            }]
        };

        engine.loadPreset(preset, { iterationCap: 10, implementation: 'naive' });
        const timeline = engine.runUntilHalt();
        const finalState = timeline.states[timeline.states.length - 1];

        // The root class (containing /) should merge with class containing 'x'
        const classX = finalState.eclasses.find(c => c.nodes.some(n => n.op === 'x'))!;
        const classRoot = finalState.eclasses.find(c => c.nodes.some(n => n.op === '/'))!;

        expect(classX.id).toBe(classRoot.id);
    });
});
