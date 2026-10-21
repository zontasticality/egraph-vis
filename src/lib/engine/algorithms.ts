import type { EGraphRuntime, RepairResult } from './runtime';
import type { RewriteRule, Pattern, ENodeId } from './types';
import type { SeededRandom } from './runtime';
import { isPatternObject, isVariablePattern, isLiteralPattern } from '../utils/typeGuards';

export interface Match {
    rule: RewriteRule;
    eclassId: ENodeId;
    substitution: Map<string, ENodeId>;
    /** E-nodes matched by the non-variable parts of the LHS, root first. */
    nodes: ENodeId[];
}

export interface MatchBatchResult {
    matches: Match[];       // Batch-local matches only
    batchId: number;
    totalBatches: number;
    classIds: ENodeId[];    // E-classes searched in this batch
    /** Every e-class searched in this read phase, in search order (shared by all batches). */
    order: ENodeId[];
    /** Batch size: number of parallel workers. */
    size: number;
    matchingNodeIds: number[];  // Nodes involved in matches (for highlighting)
    /** Time (ms) worker i spent searching `classIds[i]` for every rule (only with a timer). */
    taskTimes: number[];
}

interface PartialMatch {
    subst: Map<string, ENodeId>;
    nodes: ENodeId[];
}

// --- Matching ---

/**
 * E-matching: find every way `pattern` matches e-class `eclassId`.
 * Variables bind e-classes; constants and operators must match an e-node.
 */
export function matchPattern(runtime: EGraphRuntime, pattern: Pattern | number, eclassId: ENodeId): PartialMatch[] {
    const classId = runtime.find(eclassId);

    if (isLiteralPattern(pattern)) {
        return classId === runtime.find(pattern) ? [{ subst: new Map(), nodes: [] }] : [];
    }

    if (isVariablePattern(pattern)) {
        return [{ subst: new Map([[pattern, classId]]), nodes: [] }];
    }

    const eclass = runtime.eclasses.get(classId);
    if (!eclass) return [];

    const op = typeof pattern === 'string' ? pattern : pattern.op;
    const argPatterns = typeof pattern === 'string' ? [] : pattern.args;

    const results: PartialMatch[] = [];
    for (const nodeId of eclass.nodes) {
        const node = runtime.nodes[nodeId];
        if (node.op !== op || node.args.length !== argPatterns.length) continue;

        let partials: PartialMatch[] = [{ subst: new Map(), nodes: [nodeId] }];
        for (let i = 0; i < argPatterns.length && partials.length > 0; i++) {
            const argMatches = matchPattern(runtime, argPatterns[i], node.args[i]);
            const next: PartialMatch[] = [];
            for (const curr of partials) {
                for (const argMatch of argMatches) {
                    const merged = mergeSubsts(curr.subst, argMatch.subst);
                    if (merged) next.push({ subst: merged, nodes: [...curr.nodes, ...argMatch.nodes] });
                }
            }
            partials = next;
        }
        results.push(...partials);
    }
    return results;
}

function mergeSubsts(a: Map<string, ENodeId>, b: Map<string, ENodeId>): Map<string, ENodeId> | null {
    const merged = new Map(a);
    for (const [varName, id] of b) {
        const existing = merged.get(varName);
        if (existing !== undefined) {
            if (existing !== id) return null; // Conflict
        } else {
            merged.set(varName, id);
        }
    }
    return merged;
}

function substKey(subst: Map<string, ENodeId>): string {
    return Array.from(subst.entries())
        .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
        .map(([k, v]) => `${k}=${v}`)
        .join(',');
}

/** Match one rule against one e-class, deduplicating identical substitutions. */
function matchRuleInClass(runtime: EGraphRuntime, rule: RewriteRule, eclassId: ENodeId): Match[] {
    const matches: Match[] = [];
    const seen = new Set<string>();
    for (const m of matchPattern(runtime, rule.lhs, eclassId)) {
        const key = substKey(m.subst);
        if (seen.has(key)) continue;
        seen.add(key);
        matches.push({ rule, eclassId, substitution: m.subst, nodes: m.nodes });
    }
    return matches;
}

/** Collect all matches of all enabled rules (rule-major order). */
export function collectMatches(runtime: EGraphRuntime, rules: RewriteRule[]): Match[] {
    const enabled = rules.filter(r => r.enabled);
    const ids = Array.from(runtime.eclasses.keys());
    const matches: Match[] = [];
    for (const rule of enabled) {
        for (const id of ids) {
            matches.push(...matchRuleInClass(runtime, rule, id));
        }
    }
    return matches;
}

/**
 * Generator version that yields after each batch of e-classes.
 * In deferred mode with parallelism > 1, simulates parallel search by batching e-classes:
 * every batch checks ALL rules against `parallelism` e-classes, one worker per e-class.
 * With a `timer`, each worker's search is timed.
 *
 * IMPORTANT: The read phase is PURE - it does not mutate the graph.
 */
export function* collectMatchesGen(
    runtime: EGraphRuntime,
    rules: RewriteRule[],
    parallelism: number = 1,
    timer?: { clock: () => number; since: (t0: number) => number }
): Generator<MatchBatchResult> {
    const ids = Array.from(runtime.eclasses.keys());
    const enabledRules = rules.filter(r => r.enabled);
    const size = Math.max(1, Math.floor(parallelism));
    const totalBatches = Math.ceil(ids.length / size);

    for (let batchId = 0; batchId < totalBatches; batchId++) {
        const classIds = ids.slice(batchId * size, (batchId + 1) * size);
        const taskTimes: number[] = [];

        // Each worker searches its e-class for every rule...
        const found = classIds.map(id => {
            const t0 = timer?.clock() ?? 0;
            const perRule = enabledRules.map(rule => matchRuleInClass(runtime, rule, id));
            if (timer) taskTimes.push(timer.since(t0));
            return perRule;
        });

        // ...and the batch reports them rule-major (the writelist order)
        const batchMatches: Match[] = [];
        const batchNodeIds = new Set<number>();
        for (let r = 0; r < enabledRules.length; r++) {
            for (const perRule of found) {
                for (const match of perRule[r]) {
                    batchMatches.push(match);
                    match.nodes.forEach(n => batchNodeIds.add(n));
                }
            }
        }

        yield {
            matches: batchMatches,
            batchId,
            totalBatches,
            classIds,
            order: ids,
            size,
            matchingNodeIds: Array.from(batchNodeIds),
            taskTimes
        };
    }
}

// --- Writing ---

export function instantiatePattern(
    runtime: EGraphRuntime,
    pattern: Pattern | number,
    subst: Map<string, ENodeId>
): ENodeId {
    if (isVariablePattern(pattern)) {
        const id = subst.get(pattern);
        if (id === undefined) throw new Error(`Variable ${pattern} not found in substitution`);
        return runtime.find(id);
    } else if (typeof pattern === 'string') {
        return runtime.addEnode({ op: pattern, args: [] });
    } else if (isLiteralPattern(pattern)) {
        return runtime.find(pattern);
    }

    if (!isPatternObject(pattern)) {
        throw new Error(`Invalid pattern type: ${typeof pattern}`);
    }

    const args = pattern.args.map(arg => instantiatePattern(runtime, arg, subst));
    return runtime.addEnode({ op: pattern.op, args });
}

export interface ApplyResult {
    /** Canonical ID of the matched e-class (before the union). */
    target: ENodeId;
    /** ID returned by instantiating the RHS. */
    createdId: ENodeId;
    /** E-nodes newly created while instantiating the RHS. */
    newNodes: ENodeId[];
    /** Whether the union changed the e-graph (false = rewrite was redundant). */
    changed: boolean;
}

/**
 * Apply one rewrite: instantiate the RHS under `substitution` and union it
 * with `targetClass`. IDs are re-canonicalized first since earlier writes may
 * have merged them.
 */
export function applyRewrite(
    runtime: EGraphRuntime,
    ruleName: string,
    rhs: Pattern,
    targetClass: ENodeId,
    substitution: Map<string, ENodeId>,
    impl: 'naive' | 'deferred',
    rng?: SeededRandom
): ApplyResult {
    const canonicalSubst = new Map<string, ENodeId>();
    for (const [varName, id] of substitution) {
        canonicalSubst.set(varName, runtime.find(id));
    }

    const firstNew = runtime.nextId;
    const createdId = instantiatePattern(runtime, rhs, canonicalSubst);
    const newNodes: ENodeId[] = [];
    for (let id = firstNew; id < runtime.nextId; id++) newNodes.push(id);

    const target = runtime.find(targetClass);
    const actualNewId = runtime.find(createdId);
    if (target === actualNewId) {
        return { target, createdId, newNodes, changed: newNodes.length > 0 };
    }

    runtime.merge(target, actualNewId, impl, rng);
    runtime.diffs.push({
        type: 'rewrite',
        rule: ruleName,
        targetClass: target,
        createdId: actualNewId,
        mergedInto: runtime.find(target)
    });
    return { target, createdId: actualNewId, newNodes, changed: true };
}

export function* applyMatchesGen(
    runtime: EGraphRuntime,
    matches: Match[],
    impl: 'naive' | 'deferred',
    rng?: SeededRandom
): Generator<{ match: Match; result: ApplyResult }> {
    for (const match of matches) {
        const result = applyRewrite(runtime, match.rule.name, match.rule.rhs, match.eclassId, match.substitution, impl, rng);
        if (result.changed) {
            yield { match, result };
        }
    }
}

/** Apply all matches; in naive mode invariants are restored after every union. */
export function applyMatches(
    runtime: EGraphRuntime,
    matches: Match[],
    impl: 'naive' | 'deferred'
) {
    for (const _ of applyMatchesGen(runtime, matches, impl)) {
        if (impl === 'naive') rebuild(runtime, { compact: false });
    }
}

// --- Rebuild / Restoration ---

export type RebuildStep =
    | { phase: 'compact'; eclassId: ENodeId; compactedId: ENodeId }
    | { phase: 'repair'; eclassId: ENodeId; result: RepairResult };

/**
 * Restore the e-graph invariants, yielding after each unit of work:
 *  1. Compaction (deferred mode only): fold every merged, non-canonical
 *     e-class into its canonical representative. Naive unions merge e-classes
 *     physically right away, so there is nothing to compact.
 *  2. Repair: pop the worklist one e-class at a time and run congruence
 *     closure on its parents until the worklist is empty.
 */
export function* rebuildGen(runtime: EGraphRuntime, { compact = true }: { compact?: boolean } = {}): Generator<RebuildStep> {
    // 1. Compaction pass (ascending ID order for deterministic playback)
    const allIds = compact ? Array.from(runtime.eclasses.keys()).sort((a, b) => a - b) : [];
    for (const id of allIds) {
        const eclass = runtime.eclasses.get(id);
        if (!eclass) continue;

        const canonicalId = runtime.find(id);
        if (id === canonicalId) continue;

        const canonicalClass = runtime.eclasses.get(canonicalId);
        if (canonicalClass) {
            runtime.absorbClass(canonicalClass, eclass);
        } else {
            runtime.eclasses.delete(id);
        }
        yield { phase: 'compact', eclassId: canonicalId, compactedId: id };
    }

    // 2. Congruence repair, one worklist entry at a time
    while (runtime.worklist.size > 0) {
        const eclassId = runtime.worklist.values().next().value as ENodeId;
        runtime.worklist.delete(eclassId);

        // Entries can become stale when their class is merged into another one
        // later; the winner is always on the worklist too, so skip them.
        const canonicalId = runtime.find(eclassId);
        if (eclassId !== canonicalId || !runtime.eclasses.has(canonicalId)) continue;

        const result = runtime.repairClass(eclassId);
        yield { phase: 'repair', eclassId, result };
    }
}

/** Run a full rebuild without yielding intermediate steps. */
export function rebuild(runtime: EGraphRuntime, options?: { compact?: boolean }) {
    for (const _ of rebuildGen(runtime, options)) {
        // drain
    }
}
