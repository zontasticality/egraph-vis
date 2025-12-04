import { describe, it, expect } from 'vitest';
import { TimelineEngine } from './timeline';
import type { PresetConfig } from './types';

describe('TimelineEngine', () => {
    it('should initialize and run a simple preset', async () => {
        const engine = new TimelineEngine();
        const preset: PresetConfig = {
            id: 'simple',
            label: 'Simple Preset',
            description: 'A simple preset',
            root: { op: 'f', args: ['a'] },
            rewrites: []
        };

        engine.loadPreset(preset, { iterationCap: 10, implementation: 'naive' });
        const timeline = await engine.runUntilHalt();

        expect(timeline.states.length).toBeGreaterThan(0);
        expect(timeline.haltedReason).toBe('saturated');
    });

    it('should apply rewrites and merge', async () => {
        const engine = new TimelineEngine();
        const preset: PresetConfig = {
            id: 'rewrite-test',
            label: 'Rewrite Test',
            description: 'Test rewrites application',
            root: { op: '*', args: ['a', { op: '1', args: [] }] },
            rewrites: [{
                name: 'mul-one',
                lhs: { op: '*', args: ['?x', { op: '1', args: [] }] },
                rhs: '?x',
                enabled: true
            }]
        };

        engine.loadPreset(preset, { iterationCap: 10, implementation: 'naive' });
        const timeline = await engine.runUntilHalt();
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

    it('should handle deferred rebuild (congruence)', async () => {
        const engine = new TimelineEngine();
        const preset: PresetConfig = {
            id: 'test-rebuild',
            label: 'Test Rebuild',
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
        const timeline = await engine.runUntilHalt();
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

    it('should handle associativity', async () => {
        const engine = new TimelineEngine();
        // (a + b) + c -> a + (b + c)
        const preset: PresetConfig = {
            id: 'test-assoc',
            label: 'Test Associativity',
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
        const timeline = await engine.runUntilHalt();
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

    it('should handle commutativity', async () => {
        const engine = new TimelineEngine();
        // a + b -> b + a
        const preset: PresetConfig = {
            id: 'test-comm',
            label: 'Test Commutativity',
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
        const timeline = await engine.runUntilHalt();
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

    it('should handle arithmetic simplification (shift)', async () => {
        const engine = new TimelineEngine();
        // x * 2 -> x << 1
        const preset: PresetConfig = {
            id: 'test-shift',
            label: 'Test Shift',
            description: 'Test arithmetic simplification',
            root: { op: '*', args: ['x', { op: '2', args: [] }] },
            rewrites: [{
                name: 'shift',
                lhs: { op: '*', args: ['?x', { op: '2', args: [] }] },
                rhs: { op: '<<', args: ['?x', { op: '1', args: [] }] },
                enabled: true
            }]
        };

        engine.loadPreset(preset, { iterationCap: 10, implementation: 'naive' });
        const timeline = await engine.runUntilHalt();
        const finalState = timeline.states[timeline.states.length - 1];

        const rootClass = finalState.eclasses.find(c => c.nodes.some(n => n.op === '*'));
        expect(rootClass).toBeDefined();

        // Should also contain '<<'
        expect(rootClass!.nodes.some(n => n.op === '<<')).toBe(true);
    });

    it('should handle complex identity', async () => {
        const engine = new TimelineEngine();
        // (x * 2) / 2 -> x
        const preset: PresetConfig = {
            id: 'test-identity',
            label: 'Test Identity',
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
        const timeline = await engine.runUntilHalt();
        const finalState = timeline.states[timeline.states.length - 1];

        // The root class (containing /) should merge with class containing 'x'
        const classX = finalState.eclasses.find(c => c.nodes.some(n => n.op === 'x'))!;
        const classRoot = finalState.eclasses.find(c => c.nodes.some(n => n.op === '/'))!;

        expect(classX.id).toBe(classRoot.id);
    });

    describe('Comparison Tests (Naive vs Deferred)', () => {
        const bitvectorPreset: PresetConfig = {
            id: 'bitvector',
            label: 'Bitvector Opt',
            description: 'Standard reduction with cycles',
            root: {
                op: '/',
                args: [
                    { op: '*', args: [{ op: 'a', args: [] }, { op: '2', args: [] }] },
                    { op: '2', args: [] }
                ]
            },
            rewrites: [
                { name: 'shift', lhs: { op: '*', args: ['?x', '2'] }, rhs: { op: '<<', args: ['?x', '1'] }, enabled: true },
                { name: 'unshift', lhs: { op: '<<', args: ['?x', '1'] }, rhs: { op: '*', args: ['?x', '2'] }, enabled: true },
                { name: 'assoc-div', lhs: { op: '/', args: [{ op: '*', args: ['?x', '?y'] }, '?z'] }, rhs: { op: '*', args: ['?x', { op: '/', args: ['?y', '?z'] }] }, enabled: true },
                { name: 'div-self', lhs: { op: '/', args: ['?x', '?x'] }, rhs: '1', enabled: true },
                { name: 'mul-one', lhs: { op: '*', args: ['?x', '1'] }, rhs: '?x', enabled: true },
                { name: 'add-self', lhs: { op: '*', args: ['?x', '2'] }, rhs: { op: '+', args: ['?x', '?x'] }, enabled: true }
            ]
        };

        it('should reach the same conclusion (a) in both modes', async () => {
            const engineNaive = new TimelineEngine();
            engineNaive.loadPreset(bitvectorPreset, { iterationCap: 30, implementation: 'naive' });
            const timelineNaive = await engineNaive.runUntilHalt();
            const stateNaive = timelineNaive.states[timelineNaive.states.length - 1];

            const engineDeferred = new TimelineEngine();
            engineDeferred.loadPreset(bitvectorPreset, { iterationCap: 30, implementation: 'deferred' });
            const timelineDeferred = await engineDeferred.runUntilHalt();
            const stateDeferred = timelineDeferred.states[timelineDeferred.states.length - 1];

            // Helper to check if root is equivalent to 'a'
            const checkRootIsA = (state: any, mode: string) => {
                // Find class for 'a'
                const classA = state.eclasses.find((c: any) => c.nodes.some((n: any) => n.op === 'a'));
                expect(classA).toBeDefined();

                // Find root class (the one containing the initial expression)
                // We search for the class containing the '/' node.
                // Note: In a saturated graph, many things might merge.
                // But we expect the original '/' node to be present and merged into 'a'.
                const rootClass = state.eclasses.find((c: any) => c.nodes.some((n: any) => n.op === '/'));

                expect(rootClass).toBeDefined();
                expect(rootClass!.id).toBe(classA!.id);
            };

            checkRootIsA(stateNaive, 'naive');
            checkRootIsA(stateDeferred, 'deferred');
        });

        it('should demonstrate difference between naive and deferred in cascading merges', async () => {
            // Setup: a, b, c. f(a), f(b), f(c). g(f(a)), g(f(b)), g(f(c)).
            // Rules: a=b, b=c.
            // Expectation:
            // Naive: After 'write' phase, g(f(a)) and g(f(c)) should be merged.
            // Deferred: After 'write' phase, g(f(a)) and g(f(c)) should NOT be merged. After 'rebuild', they should be.

            const cascadePreset: PresetConfig = {
                id: 'cascade',
                label: 'Cascading Merge',
                description: 'Test cascading merges',
                root: {
                    op: 'list',
                    args: [
                        { op: 'g', args: [{ op: 'f', args: [{ op: 'a', args: [] }] }] },
                        { op: 'g', args: [{ op: 'f', args: [{ op: 'b', args: [] }] }] },
                        { op: 'g', args: [{ op: 'f', args: [{ op: 'c', args: [] }] }] }
                    ]
                },
                rewrites: [
                    { name: 'a-is-b', lhs: 'a', rhs: 'b', enabled: true },
                    { name: 'b-is-c', lhs: 'b', rhs: 'c', enabled: true }
                ]
            };

            // Run Naive
            const engineNaive = new TimelineEngine();
            engineNaive.loadPreset(cascadePreset, { iterationCap: 5, implementation: 'naive' });
            const timelineNaive = await engineNaive.runUntilHalt();

            // Find the 'write' snapshot of the first iteration (step 0)
            // Timeline states: init, read, write, rebuild, read...
            // Step 0 starts after init.
            const writeStateNaive = timelineNaive.states.find(s => s.phase === 'write');
            expect(writeStateNaive).toBeDefined();

            // Run Deferred
            const engineDeferred = new TimelineEngine();
            engineDeferred.loadPreset(cascadePreset, { iterationCap: 5, implementation: 'deferred' });
            const timelineDeferred = await engineDeferred.runUntilHalt();

            const writeStateDeferred = timelineDeferred.states.find(s => s.phase === 'write');
            expect(writeStateDeferred).toBeDefined();

            // Helper to count eclasses
            const countClasses = (state: any) => state.eclasses.length;

            // In Naive mode, 'write' state should have fewer classes because rebuild happened inline.
            // In Deferred mode, 'write' state should have more classes because f() and g() haven't merged yet.
            const countNaive = countClasses(writeStateNaive);
            const countDeferred = countClasses(writeStateDeferred);

            expect(countNaive).toBeLessThan(countDeferred);

            // Verify final consistency
            const finalNaive = timelineNaive.states[timelineNaive.states.length - 1];
            const finalDeferred = timelineDeferred.states[timelineDeferred.states.length - 1];
            expect(countClasses(finalNaive)).toBe(countClasses(finalDeferred));
        });
    });

    describe('Structural Integrity & Edge Cases', () => {
        it('should deduplicate identical nodes (hashconsing)', async () => {
            const engine = new TimelineEngine();
            // Create a list containing two identical f(a) nodes
            const preset: PresetConfig = {
                id: 'hashcons',
                label: 'Hashcons Test',
                description: 'Test hashconsing',
                root: {
                    op: 'list',
                    args: [
                        { op: 'f', args: [{ op: 'a', args: [] }] },
                        { op: 'f', args: [{ op: 'a', args: [] }] }
                    ]
                },
                rewrites: []
            };

            engine.loadPreset(preset, { iterationCap: 1, implementation: 'naive' });
            const timeline = await engine.runUntilHalt();
            const state = timeline.states[timeline.states.length - 1];

            // Find the 'list' node
            const listClass = state.eclasses.find(c => c.nodes.some(n => n.op === 'list'))!;
            const listNode = listClass.nodes.find(n => n.op === 'list')!;

            // The two args should be the SAME ID
            // listNode.args are now IDs (canonicalized in ViewModel)
            expect(listNode.args[0]).toBe(listNode.args[1]);
        });

        it('should handle multi-argument congruence', async () => {
            const engine = new TimelineEngine();
            // f(a, b) and f(c, d). Merge a=c, b=d.
            const preset: PresetConfig = {
                id: 'multi-arg',
                label: 'Multi-Arg Congruence',
                description: 'Test multi-arg congruence',
                root: {
                    op: 'list',
                    args: [
                        { op: 'f', args: [{ op: 'a', args: [] }, { op: 'b', args: [] }] },
                        { op: 'f', args: [{ op: 'c', args: [] }, { op: 'd', args: [] }] }
                    ]
                },
                rewrites: [
                    { name: 'a-c', lhs: 'a', rhs: 'c', enabled: true },
                    { name: 'b-d', lhs: 'b', rhs: 'd', enabled: true }
                ]
            };

            // Need more iterations for congruence closure in deferred mode
            // Deferred rebuild requires multiple iterations to propagate changes
            engine.loadPreset(preset, { iterationCap: 20, implementation: 'deferred' });
            const timeline = await engine.runUntilHalt();
            const state = timeline.states[timeline.states.length - 1];

            // Find important classes
            const classA = state.eclasses.find(c => c.nodes.some(n => n.op === 'a'));
            const classC = state.eclasses.find(c => c.nodes.some(n => n.op === 'c'));
            const classB = state.eclasses.find(c => c.nodes.some(n => n.op === 'b'));
            const classD = state.eclasses.find(c => c.nodes.some(n => n.op === 'd'));

            // Find f(...) classes

            // Find f(a,b) and f(c,d) classes
            // After a=c and b=d merge, congruence should merge f(a,b) with f(c,d)
            const listClass = state.eclasses.find(c => c.nodes.some(n => n.op === 'list'))!;
            const listNode = listClass.nodes.find(n => n.op === 'list')!;

            // The ViewModel keeps non-canonical args for UI purposes
            // But congruence should have merged both f(...) into the SAME class
            // So we need to check if list's two args canonicalize to the same class
            const canon0 = state.unionFind.find(uf => uf.id === listNode.args[0])?.canonical;
            const canon1 = state.unionFind.find(uf => uf.id === listNode.args[1])?.canonical;

            // Both f(...) instances should canonicalize to the same class
            expect(canon0).toBe(canon1);
        });

        it('should handle cycles gracefully (a = f(a))', async () => {
            const engine = new TimelineEngine();
            const preset: PresetConfig = {
                id: 'cycle',
                label: 'Cycle Test',
                description: 'Test cycle handling',
                root: { op: 'a', args: [] },
                rewrites: [
                    { name: 'wrap', lhs: '?x', rhs: { op: 'f', args: ['?x'] }, enabled: true }
                ]
            };

            // This rule ?x -> f(?x) will expand infinitely if not capped.
            // But if we merge a = f(a), it creates a cycle.
            // Let's change the rule to: a -> f(a) AND f(a) -> a (merge)
            // Or just: a = f(a).
            // The rule `lhs: 'a', rhs: { op: 'f', args: ['a'] }` creates f(a) and merges it with a.

            const cyclePreset: PresetConfig = {
                id: 'cycle-merge',
                label: 'Cycle Merge',
                description: 'Test cycle merge',
                root: { op: 'a', args: [] },
                rewrites: [
                    { name: 'cycle', lhs: 'a', rhs: { op: 'f', args: ['a'] }, enabled: true }
                ]
            };

            engine.loadPreset(cyclePreset, { iterationCap: 5, implementation: 'naive' });
            // Should not hang
            const timeline = await engine.runUntilHalt();
            const state = timeline.states[timeline.states.length - 1];

            // 'a' class should contain 'f(a)'
            const aClass = state.eclasses.find(c => c.nodes.some(n => n.op === 'a'))!;
            const hasF = aClass.nodes.some(n => n.op === 'f');
            expect(hasF).toBe(true);
        });
    });
});
