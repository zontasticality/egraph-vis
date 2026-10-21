import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { parsePattern, stringifyPattern, validatePattern, collectVariables, validateRule } from './parser';
import { termArb, ruleArb } from '../test/helpers';

describe('parsePattern', () => {
    it('parses constants, variables and applications', () => {
        expect(parsePattern('a')).toBe('a');
        expect(parsePattern('?x')).toBe('?x');
        expect(parsePattern('f(a)')).toEqual({ op: 'f', args: ['a'] });
        expect(parsePattern('/(*(a, 2), 2)')).toEqual({
            op: '/',
            args: [{ op: '*', args: ['a', '2'] }, '2']
        });
        expect(parsePattern('nil()')).toEqual({ op: 'nil', args: [] });
    });

    it('ignores whitespace', () => {
        expect(parsePattern('  +( ?x ,\n 0 )  ')).toEqual({ op: '+', args: ['?x', '0'] });
        expect(parsePattern('f (a)')).toEqual({ op: 'f', args: ['a'] });
    });

    it.each([
        ['', /Empty/],
        ['   ', /Empty/],
        ['f(a', /Missing closing/],
        ['f(a b)', /Expected ',' or '\)'/],
        ['f(a,)', /Expected an argument/],
        ['f(,a)', /Expected an argument/],
        ['f((a))', /Unexpected '\('/],
        ['(a)', /Unexpected '\('/],
        [')', /Expected an argument/],
        ['a b', /Unexpected 'b'/],
        ['f(a))', /Unexpected '\)'/],
        ['?x(a)', /cannot be used as an operator/],
        ['?', /Variable name missing/],
    ])('rejects %j', (input, message) => {
        expect(() => parsePattern(input)).toThrow(message);
        expect(validatePattern(input).valid).toBe(false);
    });

    it('round-trips through stringifyPattern', () => {
        fc.assert(
            fc.property(termArb, term => {
                expect(parsePattern(stringifyPattern(term))).toEqual(term);
            })
        );
        fc.assert(
            fc.property(ruleArb, r => {
                expect(parsePattern(stringifyPattern(r.lhs))).toEqual(r.lhs);
                expect(parsePattern(stringifyPattern(r.rhs))).toEqual(r.rhs);
            })
        );
    });
});

describe('collectVariables', () => {
    it('collects nested variables once', () => {
        expect(collectVariables(parsePattern('+(?x, *(?y, ?x))'))).toEqual(new Set(['?x', '?y']));
        expect(collectVariables(parsePattern('f(a)')).size).toBe(0);
        expect(collectVariables('?z')).toEqual(new Set(['?z']));
    });
});

describe('validateRule', () => {
    it('accepts well-formed rules', () => {
        expect(validateRule('+(?x, 0)', '?x')).toEqual({});
        expect(validateRule('a', 'b')).toEqual({});
    });

    it('rejects unbound RHS variables', () => {
        expect(validateRule('f(?x)', 'g(?y)').rhsError).toMatch(/\?y.*not bound/);
    });

    it('rejects a bare-variable LHS', () => {
        expect(validateRule('?x', 'f(?x)').lhsError).toMatch(/bare variable/);
    });

    it('reports syntax errors per side', () => {
        const r = validateRule('f(', 'g(');
        expect(r.lhsError).toMatch(/end of input|Missing/);
        expect(r.rhsError).toMatch(/end of input|Missing/);
    });
});
