/**
 * Shared helpers for engine/visualization tests.
 */
import fc from 'fast-check';
import { TimelineEngine } from '../engine/timeline';
import type { EGraphRuntime } from '../engine/runtime';
import { matchPattern } from '../engine/algorithms';
import type { EGraphState, EGraphTimeline, EngineOptions, Pattern, PresetConfig, RewriteRule } from '../engine/types';
import { isPatternObject, isVariablePattern } from '../utils/typeGuards';

export function preset(root: Pattern, rewrites: RewriteRule[] = [], id = 'test'): PresetConfig {
    return { id, label: id, description: '', root, rewrites };
}

export function rule(name: string, lhs: Pattern, rhs: Pattern, enabled = true): RewriteRule {
    return { name, lhs, rhs, enabled };
}

export function run(p: PresetConfig, options: Partial<EngineOptions> = {}): { engine: TimelineEngine; timeline: EGraphTimeline } {
    const engine = new TimelineEngine();
    engine.loadPreset(p, { implementation: 'deferred', ...options });
    const timeline = engine.run();
    return { engine, timeline };
}

export function lastState(timeline: EGraphTimeline): EGraphState {
    return timeline.states[timeline.states.length - 1];
}

/** Find the e-class (in a snapshot) containing an e-node with `op`. */
export function classWithOp(state: EGraphState, op: string) {
    return state.eclasses.find(c => c.nodes.some(n => n.op === op));
}

/**
 * Look up a pattern instantiation without adding anything to the e-graph.
 * Returns the canonical e-class, or undefined if some sub-term is absent.
 */
export function lookupPattern(runtime: EGraphRuntime, pattern: Pattern | number, subst: Map<string, number>): number | undefined {
    if (typeof pattern === 'number') return runtime.find(pattern);
    if (isVariablePattern(pattern)) {
        const id = subst.get(pattern);
        return id === undefined ? undefined : runtime.find(id);
    }
    const op = typeof pattern === 'string' ? pattern : pattern.op;
    const args: number[] = [];
    if (isPatternObject(pattern)) {
        for (const a of pattern.args) {
            const id = lookupPattern(runtime, a, subst);
            if (id === undefined) return undefined;
            args.push(id);
        }
    }
    const hit = runtime.hashcons.get(runtime.canonicalKey({ op, args }));
    return hit === undefined ? undefined : runtime.find(hit);
}

/** True if no enabled rule can add anything new to the (rebuilt) e-graph. */
export function isSaturated(runtime: EGraphRuntime, rules: RewriteRule[]): boolean {
    for (const r of rules.filter(r => r.enabled)) {
        for (const classId of runtime.eclasses.keys()) {
            for (const m of matchPattern(runtime, r.lhs, classId)) {
                if (lookupPattern(runtime, r.rhs, m.subst) !== runtime.find(classId)) return false;
            }
        }
    }
    return true;
}

/** Equivalence relation over node IDs [0, n) as a canonical string, independent of class IDs. */
export function partitionSignature(runtime: EGraphRuntime, n: number): string {
    const groups = new Map<number, number[]>();
    for (let id = 0; id < n; id++) {
        const c = runtime.find(id);
        if (!groups.has(c)) groups.set(c, []);
        groups.get(c)!.push(id);
    }
    return Array.from(groups.values())
        .map(g => g.join(','))
        .sort()
        .join(' | ');
}

/** Count nodes in the term tree (= number of distinct e-nodes before any rewriting, upper bound). */
export function termSize(p: Pattern | number): number {
    if (typeof p !== 'object') return 1;
    return 1 + p.args.reduce<number>((acc, a) => acc + termSize(a), 0);
}

// ─── fast-check arbitraries ──────────────────────────────────────────────

const LEAVES = ['a', 'b', '0', '1'];
const UNARY = ['f', 'g'];
const BINARY = ['+', '*'];

function groundArb(depth: number): fc.Arbitrary<Pattern> {
    const leaf = fc.constantFrom(...LEAVES);
    if (depth <= 0) return leaf;
    const sub = groundArb(depth - 1);
    return fc.oneof(
        { weight: 1, arbitrary: leaf },
        { weight: 1, arbitrary: fc.record({ op: fc.constantFrom(...UNARY), args: fc.tuple(sub) }) },
        { weight: 2, arbitrary: fc.record({ op: fc.constantFrom(...BINARY), args: fc.tuple(sub, sub) }) }
    );
}

/** Random ground term over a small signature (small alphabet => lots of sharing). Root is an operator. */
export const termArb: fc.Arbitrary<Pattern> = fc
    .oneof(
        fc.record({ op: fc.constantFrom(...UNARY), args: fc.tuple(groundArb(3)) }),
        fc.record({ op: fc.constantFrom(...BINARY), args: fc.tuple(groundArb(3), groundArb(3)) })
    )
    .filter(t => termSize(t) <= 30);

const VARS = ['?x', '?y', '?z'];

/** Random pattern; variables drawn from `vars` (weighted heavily so patterns match often). */
function patternArb(vars: string[], depth: number): fc.Arbitrary<Pattern> {
    const leaf = fc.oneof(
        { weight: 3, arbitrary: fc.constantFrom(...vars) },
        { weight: 1, arbitrary: fc.constantFrom(...LEAVES) }
    );
    if (depth <= 0) return leaf;
    const sub = patternArb(vars, depth - 1);
    return fc.oneof(
        { weight: 2, arbitrary: leaf },
        { weight: 1, arbitrary: fc.record({ op: fc.constantFrom(...UNARY), args: fc.tuple(sub) }) },
        { weight: 1, arbitrary: fc.record({ op: fc.constantFrom(...BINARY), args: fc.tuple(sub, sub) }) }
    );
}

function varsOf(p: Pattern): Set<string> {
    const out = new Set<string>();
    const walk = (q: Pattern | number) => {
        if (isVariablePattern(q as Pattern)) out.add(q as string);
        else if (typeof q === 'object') q.args.forEach(walk);
    };
    walk(p);
    return out;
}

const op = (o: string, ...args: Pattern[]): Pattern => ({ op: o, args });

/** Well-known algebraic rules (commutativity, associativity, identities, ...). */
export const RULE_CATALOG: Array<[Pattern, Pattern]> = [
    [op('+', '?x', '?y'), op('+', '?y', '?x')],
    [op('*', '?x', '?y'), op('*', '?y', '?x')],
    [op('+', op('+', '?x', '?y'), '?z'), op('+', '?x', op('+', '?y', '?z'))],
    [op('+', '?x', op('+', '?y', '?z')), op('+', op('+', '?x', '?y'), '?z')],
    [op('+', '?x', '0'), '?x'],
    [op('*', '?x', '1'), '?x'],
    [op('*', '?x', '0'), '0'],
    [op('f', op('g', '?x')), '?x'],
    [op('g', '?x'), op('f', '?x')],
    [op('f', '?x'), op('f', op('f', '?x'))],
    [op('f', '?x'), op('g', op('f', '?x'))],
    [op('*', '?x', op('+', '?y', '?z')), op('+', op('*', '?x', '?y'), op('*', '?x', '?z'))],
    ['a', 'b'],
    ['0', op('*', '0', '1')],
];

/** Random rewrite rule whose RHS only uses variables bound by the LHS. */
const randomRuleArb: fc.Arbitrary<RewriteRule> = patternArb(VARS, 2)
    .filter(lhs => typeof lhs === 'object') // keep LHS anchored on an operator
    .chain(lhs => {
        const bound = Array.from(varsOf(lhs));
        return patternArb(bound.length > 0 ? bound : ['a'], 2).map(rhs => ({ name: 'r', lhs, rhs, enabled: true }));
    });

const catalogRuleArb: fc.Arbitrary<RewriteRule> = fc
    .constantFrom(...RULE_CATALOG)
    .map(([lhs, rhs]) => ({ name: 'r', lhs, rhs, enabled: true }));

export const ruleArb: fc.Arbitrary<RewriteRule> = fc.oneof(
    { weight: 2, arbitrary: catalogRuleArb },
    { weight: 1, arbitrary: randomRuleArb }
);

export const rulesArb: fc.Arbitrary<RewriteRule[]> = fc
    .array(ruleArb, { minLength: 2, maxLength: 4 })
    .map(rules => rules.map((r, i) => ({ ...r, name: `r${i}` })));
