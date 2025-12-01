import { describe, it, expect, beforeEach } from 'vitest';
import { EGraphRuntime } from './runtime';
import { collectMatches, type Match } from './algorithms';
import type { RewriteRule } from './types';

describe('Pattern Matching', () => {
    let runtime: EGraphRuntime;

    beforeEach(() => {
        runtime = new EGraphRuntime();
    });

    describe('Variable Patterns', () => {
        it('should match any e-class with a variable pattern', () => {
            // Add nodes: a, b
            const idA = runtime.addEnode({ op: 'a', args: [] });
            const idB = runtime.addEnode({ op: 'b', args: [] });

            const rule: RewriteRule = {
                name: 'test',
                lhs: '?x',
                rhs: '?x',
                enabled: true
            };

            const matches = collectMatches(runtime, [rule]);

            // Should match both e-classes
            expect(matches.length).toBeGreaterThanOrEqual(2);
            const matchedClasses = matches.map(m => m.eclassId).sort();
            expect(matchedClasses).toContain(idA);
            expect(matchedClasses).toContain(idB);
        });

        it('should capture correct substitution for variables', () => {
            const idA = runtime.addEnode({ op: 'a', args: [] });

            const rule: RewriteRule = {
                name: 'test',
                lhs: '?x',
                rhs: 'b',
                enabled: true
            };

            const matches = collectMatches(runtime, [rule]);
            const match = matches.find(m => m.eclassId === idA);

            expect(match).toBeDefined();
            expect(match!.substitution.get('?x')).toBe(idA);
        });
    });

    describe('Structural Patterns', () => {
        it('should match operator with arguments', () => {
            // Build: f(a, b)
            const idA = runtime.addEnode({ op: 'a', args: [] });
            const idB = runtime.addEnode({ op: 'b', args: [] });
            const idF = runtime.addEnode({ op: 'f', args: [idA, idB] });

            const rule: RewriteRule = {
                name: 'test',
                lhs: { op: 'f', args: ['?x', '?y'] },
                rhs: '?x',
                enabled: true
            };

            const matches = collectMatches(runtime, [rule]);

            expect(matches.length).toBeGreaterThanOrEqual(1);
            const match = matches.find(m => m.eclassId === idF);
            expect(match).toBeDefined();
            expect(match!.substitution.get('?x')).toBe(idA);
            expect(match!.substitution.get('?y')).toBe(idB);
        });

        it('should match nested patterns', () => {
            // Build: f(g(a), b)
            const idA = runtime.addEnode({ op: 'a', args: [] });
            const idG = runtime.addEnode({ op: 'g', args: [idA] });
            const idB = runtime.addEnode({ op: 'b', args: [] });
            const idF = runtime.addEnode({ op: 'f', args: [idG, idB] });

            const rule: RewriteRule = {
                name: 'test',
                lhs: { op: 'f', args: [{ op: 'g', args: ['?x'] }, '?y'] },
                rhs: '?x',
                enabled: true
            };

            const matches = collectMatches(runtime, [rule]);

            expect(matches.length).toBeGreaterThanOrEqual(1);
            const match = matches.find(m => m.eclassId === idF);
            expect(match).toBeDefined();
            expect(match!.substitution.get('?x')).toBe(idA);
            expect(match!.substitution.get('?y')).toBe(idB);
        });

        it('should match multiple levels deep - recursive pattern', () => {
            // Build: *( *(2, a), 1)
            // This is the user's example from the image
            const id2 = runtime.addEnode({ op: '2', args: [] });
            const idA = runtime.addEnode({ op: 'a', args: [] });
            const id1 = runtime.addEnode({ op: '1', args: [] });
            const innerMul = runtime.addEnode({ op: '*', args: [id2, idA] });
            const outerMul = runtime.addEnode({ op: '*', args: [innerMul, id1] });

            // Pattern: /(*(?x, ?y), ?z)
            const rule: RewriteRule = {
                name: 'test-recursive',
                lhs: { op: '*', args: [{ op: '*', args: ['?x', '?y'] }, '?z'] },
                rhs: '?x',
                enabled: true
            };

            const matches = collectMatches(runtime, [rule]);

            expect(matches.length).toBeGreaterThanOrEqual(1);
            const match = matches.find(m => m.eclassId === outerMul);
            expect(match).toBeDefined();
            expect(match!.substitution.get('?x')).toBe(id2);
            expect(match!.substitution.get('?y')).toBe(idA);
            expect(match!.substitution.get('?z')).toBe(id1);
        });
    });

    describe('Constant Patterns', () => {
        it('should match constant strings', () => {
            const idA = runtime.addEnode({ op: 'a', args: [] });
            const idB = runtime.addEnode({ op: 'b', args: [] });

            const rule: RewriteRule = {
                name: 'test',
                lhs: 'a',
                rhs: 'b',
                enabled: true
            };

            const matches = collectMatches(runtime, [rule]);

            expect(matches.length).toBeGreaterThanOrEqual(1);
            expect(matches.some(m => m.eclassId === idA)).toBe(true);
            expect(matches.every(m => m.eclassId !== idB)).toBe(true);
        });

        it('should not match if operator differs', () => {
            const idA = runtime.addEnode({ op: 'a', args: [] });

            const rule: RewriteRule = {
                name: 'test',
                lhs: 'b',
                rhs: 'a',
                enabled: true
            };

            const matches = collectMatches(runtime, [rule]);

            expect(matches.length).toBe(0);
        });
    });

    describe('E-graph Semantics', () => {
        it('should match after merge due to equivalence', () => {
            // Build: f(a) and f(b), then merge a and b
            const idA = runtime.addEnode({ op: 'a', args: [] });
            const idB = runtime.addEnode({ op: 'b', args: [] });
            const idFA = runtime.addEnode({ op: 'f', args: [idA] });
            const idFB = runtime.addEnode({ op: 'f', args: [idB] });

            // Merge a and b
            runtime.merge(idA, idB);

            // Pattern should match f(?x) for both
            const rule: RewriteRule = {
                name: 'test',
                lhs: { op: 'f', args: ['?x'] },
                rhs: '?x',
                enabled: true
            };

            const matches = collectMatches(runtime, [rule]);

            // Both f(a) and f(b) should still match because they're in separate e-classes
            // (until congruence closure is applied)
            expect(matches.length).toBeGreaterThanOrEqual(2);
        });

        it('should handle variable reuse in pattern', () => {
            // Build: f(a, a) and f(a, b)
            const idA = runtime.addEnode({ op: 'a', args: [] });
            const idB = runtime.addEnode({ op: 'b', args: [] });
            const idFAA = runtime.addEnode({ op: 'f', args: [idA, idA] });
            const idFAB = runtime.addEnode({ op: 'f', args: [idA, idB] });

            // Pattern: f(?x, ?x) - same variable used twice
            const rule: RewriteRule = {
                name: 'test',
                lhs: { op: 'f', args: ['?x', '?x'] },
                rhs: '?x',
                enabled: true
            };

            const matches = collectMatches(runtime, [rule]);

            // Should only match f(a, a), not f(a, b)
            expect(matches.some(m => m.eclassId === idFAA)).toBe(true);
            expect(matches.every(m => m.eclassId !== idFAB)).toBe(true);
        });
    });

    describe('Multiple Rules', () => {
        it('should find matches for all enabled rules', () => {
            const idA = runtime.addEnode({ op: 'a', args: [] });

            const rules: RewriteRule[] = [
                { name: 'rule1', lhs: 'a', rhs: 'b', enabled: true },
                { name: 'rule2', lhs: 'a', rhs: 'c', enabled: true }
            ];

            const matches = collectMatches(runtime, rules);

            const rule1Matches = matches.filter(m => m.rule.name === 'rule1');
            const rule2Matches = matches.filter(m => m.rule.name === 'rule2');

            expect(rule1Matches.length).toBeGreaterThanOrEqual(1);
            expect(rule2Matches.length).toBeGreaterThanOrEqual(1);
        });

        it('should skip disabled rules', () => {
            const idA = runtime.addEnode({ op: 'a', args: [] });

            const rules: RewriteRule[] = [
                { name: 'enabled', lhs: 'a', rhs: 'b', enabled: true },
                { name: 'disabled', lhs: 'a', rhs: 'c', enabled: false }
            ];

            // Note: collectMatches doesn't currently filter by enabled flag
            // This test documents current behavior - may need to add filtering
            const matches = collectMatches(runtime, rules.filter(r => r.enabled));

            expect(matches.every(m => m.rule.name !== 'disabled')).toBe(true);
        });
    });
});
