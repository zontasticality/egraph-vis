import type { EGraphRuntime } from './runtime';
import type { RewriteRule, Pattern, ENodeId, ENode } from './types';
import { SeededRandom } from './runtime';

export interface Match {
    rule: RewriteRule;
    eclassId: ENodeId;
    substitution: Map<string, ENodeId>;
}

// --- Rebuild / Restoration ---

export function rebuild(runtime: EGraphRuntime) {
    // 1. Compaction Pass (For Deferred Mode Visualization)
    // In deferred mode, we skipped moving nodes during merge.
    // We must now move them to the canonical class before repairing invariants.

    // Collect all IDs first to avoid iterator invalidation during deletion
    const allIds = Array.from(runtime.eclasses.keys());

    for (const id of allIds) {
        const eclass = runtime.eclasses.get(id);
        if (!eclass) continue; // Already deleted

        const canonicalId = runtime.find(id);
        if (id !== canonicalId) {
            // This is a "stale" class (Red Box).
            // Move its nodes to the canonical class (Normal Box).
            const canonicalClass = runtime.eclasses.get(canonicalId);
            if (canonicalClass) {
                canonicalClass.nodes.push(...eclass.nodes);
                // We don't need to update hashcons here because we did it in merge()

                // Merge parents (if any were added after merge? unlikely but safe)
                for (const [key, parentInfo] of eclass.parents) {
                    canonicalClass.parents.set(key, parentInfo);
                }

                // Merge data
                if (eclass.data) {
                    canonicalClass.data = { ...canonicalClass.data, ...eclass.data };
                }

                // Update version to trigger ViewModel refresh
                canonicalClass.version++;
            }
            // Delete the stale class
            runtime.eclasses.delete(id);
        }
    }

    // 2. Standard Congruence Repair
    // Loop until fixpoint (worklist empty)
    while (runtime.worklist.size > 0) {
        const todo = Array.from(runtime.worklist);
        runtime.worklist.clear();

        for (const eclassId of todo) {
            repair(runtime, eclassId);
        }
    }
}

function repair(runtime: EGraphRuntime, eclassId: ENodeId) {
    // ... (rest of repair is unchanged)
    // 1. Gather parents that reference this eclass
    // Note: parents map in runtime stores { parentId, enode }
    // The 'enode' there is the *old* version. We need to re-canonicalize it.
    const parents = runtime.getParents(eclassId);

    // 2. Group parents by their NEW canonical key
    const groups = new Map<string, ENodeId[]>();

    for (const { parentId, enode } of parents) {
        const canonicalParentId = runtime.find(parentId);

        // Re-canonicalize the parent node itself (its children might have merged)
        const newEnode = runtime.canonicalize(enode);
        const newKey = runtime.canonicalKey(newEnode);

        // Update hashcons: The old key might point to something else, 
        // but we want to ensure the NEW key points to this class.
        // However, if multiple parents map to the same key, they must be merged.
        // We defer the hashcons update until after we find the leader of the group.

        if (!groups.has(newKey)) {
            groups.set(newKey, []);
        }
        groups.get(newKey)!.push(canonicalParentId);
    }

    // 3. Merge classes in each group
    for (const [key, ids] of groups) {
        if (ids.length === 0) continue;

        const leader = ids[0];

        // Merge all others into leader
        for (let i = 1; i < ids.length; i++) {
            runtime.merge(leader, ids[i]); // Always eager here? Or recursive deferred?
            // Rebuild is always eager in its internal merges to ensure termination/progress.
            // If we used deferred merge here, we'd just add to worklist and loop forever?
            // Actually, `runtime.merge` defaults to 'naive' (eager).
            // So internal merges in rebuild are eager, which is correct.
        }

        // Update hashcons to point to the leader
        // This ensures future addEnode calls find this class
        runtime.hashcons.set(key, leader);
    }
}

// ...

// --- Matching ---

export function collectMatches(runtime: EGraphRuntime, rules: RewriteRule[]): Match[] {
    const matches: Match[] = [];
    for (const rule of rules) {
        for (const [id, eclass] of runtime.eclasses) {
            const found = matchPattern(runtime, rule.lhs, id);
            for (const substitution of found) {
                matches.push({ rule, eclassId: id, substitution });
            }
        }
    }
    return matches;
}

function matchPattern(runtime: EGraphRuntime, pattern: Pattern | number, eclassId: ENodeId): Map<string, ENodeId>[] {
    // 1. Concrete ID Match
    if (typeof pattern === 'number') {
        // If pattern is a number, it must match the eclassId?
        // Or does it match if the eclass contains that node?
        // Usually in e-graphs, patterns don't contain concrete IDs unless it's a specific reference.
        // If pattern is a number, it means "match this specific EClass".
        // So if eclassId === pattern (canonical), it's a match.
        if (runtime.find(eclassId) === runtime.find(pattern)) {
            return [new Map()];
        }
        return [];
    }

    // 2. Variable Match
    if (typeof pattern === 'string' && pattern.startsWith('?')) {
        return [new Map([[pattern, eclassId]])];
    }

    // 3. Structure Match
    const eclass = runtime.eclasses.get(eclassId);
    if (!eclass) return [];

    const results: Map<string, ENodeId>[] = [];

    for (const nodeId of eclass.nodes) {
        const node = runtime.nodes[nodeId];
        const substs = matchNode(runtime, pattern, node);
        results.push(...substs);
    }

    return results;
}

function matchNode(runtime: EGraphRuntime, pattern: Pattern, node: ENode): Map<string, ENodeId>[] {
    if (typeof pattern === 'string') {
        // Constant string "foo" -> matches node with op "foo", args []
        if (node.op === pattern && node.args.length === 0) {
            return [new Map()];
        }
        return [];
    } else if (typeof pattern === 'number') {
        return [];
    }

    // Object pattern { op, args }
    if (node.op !== pattern.op) return [];
    if (node.args.length !== pattern.args.length) return [];

    // Recursive match for args
    let currentSubsts: Map<string, ENodeId>[] = [new Map()];

    for (let i = 0; i < node.args.length; i++) {
        const argPattern = pattern.args[i];
        const argClassId = runtime.find(node.args[i]); // Canonicalize before matching

        const nextSubsts: Map<string, ENodeId>[] = [];

        // Find all matches for this argument
        const argMatches = matchPattern(runtime, argPattern, argClassId);

        // Cartesian product
        for (const curr of currentSubsts) {
            for (const argMatch of argMatches) {
                const merged = mergeSubsts(curr, argMatch);
                if (merged) {
                    nextSubsts.push(merged);
                }
            }
        }

        currentSubsts = nextSubsts;
        if (currentSubsts.length === 0) return [];
    }

    return currentSubsts;
}

function mergeSubsts(a: Map<string, ENodeId>, b: Map<string, ENodeId>): Map<string, ENodeId> | null {
    const merged = new Map(a);
    for (const [varName, id] of b) {
        if (merged.has(varName)) {
            if (merged.get(varName) !== id) return null; // Conflict
        } else {
            merged.set(varName, id);
        }
    }
    return merged;
}

// --- Generator Versions for Fine-Grained Snapshots ---

export function* applyMatchesGen(
    runtime: EGraphRuntime,
    matches: Match[],
    impl: 'naive' | 'deferred',
    rng?: SeededRandom
): Generator<{ match: Match; phase: 'apply' | 'rebuild' }> {
    for (const match of matches) {
        const { rule, eclassId, substitution } = match;

        // Instantiate RHS
        const newId = instantiatePattern(runtime, rule.rhs, substitution);

        // Merge with target
        const target = runtime.find(eclassId);
        const actualNewId = runtime.find(newId);

        // Deduplication check
        if (target === actualNewId) {
            continue;
        }

        // Perform merge
        runtime.merge(target, actualNewId, impl, rng);

        // Record rewrite diff
        runtime.diffs.push({
            type: 'rewrite',
            rule: rule.name,
            targetClass: target,
            createdId: actualNewId,
            mergedInto: runtime.find(target)
        });

        // Yield after each merge (this allows a snapshot to be taken)
        yield { match, phase: 'apply' };

        // In naive mode, rebuild will be called separately by TimelineEngine
        // We don't delegate here to avoid complex type issues
    }
}

export function* rebuildGen(runtime: EGraphRuntime): Generator<{ phase: 'compact' | 'repair'; eclassId?: number }> {
    // 1. Compaction Pass
    const allIds = Array.from(runtime.eclasses.keys());

    for (const id of allIds) {
        const eclass = runtime.eclasses.get(id);
        if (!eclass) continue;

        const canonicalId = runtime.find(id);
        if (id !== canonicalId) {
            const canonicalClass = runtime.eclasses.get(canonicalId);
            if (canonicalClass) {
                canonicalClass.nodes.push(...eclass.nodes);
                for (const [key, parentInfo] of eclass.parents) {
                    canonicalClass.parents.set(key, parentInfo);
                }
                if (eclass.data) {
                    canonicalClass.data = { ...canonicalClass.data, ...eclass.data };
                }
                canonicalClass.version++;
            }
            runtime.eclasses.delete(id);

            // Yield after each compaction
            // Yield the canonicalId (survivor) so we can highlight the class that absorbed the other
            yield { phase: 'compact', eclassId: canonicalId };
        }
    }

    // 2. Congruence Repair (One item at a time for granular visualization)
    while (runtime.worklist.size > 0) {
        // Take just one item from the worklist
        const eclassId = runtime.worklist.values().next().value;
        if (eclassId === undefined) break; // Safety check

        runtime.worklist.delete(eclassId);

        // Repair this item (may add more items to worklist)
        repair(runtime, eclassId);

        // Yield after each repair to show worklist changes
        yield { phase: 'repair', eclassId };
    }
}

export function applyMatches(
    runtime: EGraphRuntime,
    matches: Match[],
    impl: 'naive' | 'deferred'
) {
    for (const match of matches) {
        const { rule, eclassId, substitution } = match;

        // Instantiate RHS
        const newId = instantiatePattern(runtime, rule.rhs, substitution);

        // Merge with target
        const target = runtime.find(eclassId);
        const actualNewId = runtime.find(newId);

        // Deduplication check:
        // If the new node is ALREADY in the target class, merge returns the same ID and does nothing.
        // We can check this before calling merge to avoid recording a diff.
        if (target === actualNewId) {
            // Redundant rewrite
            continue;
        }

        // Perform merge
        // Pass implementation flag to support lazy merge in deferred mode
        runtime.merge(target, actualNewId, impl);

        // In naive mode, we restore invariants immediately after every merge
        if (impl === 'naive') {
            rebuild(runtime);
        }

        // Record diff
        // Note: runtime.merge records a 'merge' diff.
        // We also want to record a 'rewrite' diff to link it to the rule.
        // But `runtime.diffs` is a flat list.
        // We should append a specific rewrite event.
        // The spec says: "Record metadata diff referencing rule.name".
        // "type: 'rewrite', rule: string, targetClass: number, createdId: number, mergedInto: number"

        // We need to be careful: `runtime.merge` already pushed a 'merge' event.
        // The UI might want to know WHICH rewrite caused this.
        // Maybe we should add the rewrite event *after* the merge?
        // Or maybe the 'rewrite' event IS the merge event wrapper?
        // Spec says: "Record metadata diff referencing rule.name... In addition to the merge diff?"
        // "metadata.diffs entries referencing rewrites should include: { type: 'rewrite', ... }"
        // This seems to be a separate event.

        runtime.diffs.push({
            type: 'rewrite',
            rule: rule.name,
            targetClass: target,
            createdId: actualNewId, // The ID of the node we created (or found)
            mergedInto: runtime.find(target) // The winner of the merge
        });
    }
}

function instantiatePattern(
    runtime: EGraphRuntime,
    pattern: Pattern | number,
    subst: Map<string, ENodeId>
): ENodeId {
    if (typeof pattern === 'string') {
        if (pattern.startsWith('?')) {
            const id = subst.get(pattern);
            if (id === undefined) throw new Error(`Variable ${pattern} not found in substitution`);
            return id;
        } else {
            return runtime.addEnode({ op: pattern, args: [] });
        }
    } else if (typeof pattern === 'number') {
        return pattern;
    }

    const args: ENodeId[] = [];
    for (const arg of pattern.args) {
        args.push(instantiatePattern(runtime, arg, subst));
    }

    return runtime.addEnode({ op: pattern.op, args });
}
