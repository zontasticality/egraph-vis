import type { EGraphRuntime } from './runtime';
import type { RewriteRule, Pattern, ENodeId, ENode } from './types';

export interface Match {
    rule: RewriteRule;
    eclassId: ENodeId;
    substitution: Map<string, ENodeId>;
}

// --- Rebuild / Restoration ---

export function rebuild(runtime: EGraphRuntime) {
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
            runtime.merge(leader, ids[i]);
        }

        // Update hashcons to point to the leader
        // This ensures future addEnode calls find this class
        runtime.hashcons.set(key, leader);
    }
}

// --- Matching ---

export function collectMatches(runtime: EGraphRuntime, rules: RewriteRule[]): Match[] {
    const matches: Match[] = [];

    for (const rule of rules) {
        if (!rule.enabled) continue;

        // Iterate over all *canonical* eclasses
        for (const [id, eclass] of runtime.eclasses) {
            // Optimization: only match against the representative
            if (runtime.find(id) !== id) continue;

            // Try to match the LHS pattern against any node in this class
            // A class matches if ANY of its nodes matches
            for (const nodeId of eclass.nodes) {
                const node = runtime.nodes[nodeId];
                const subst = matchPattern(runtime, rule.lhs, node);
                if (subst) {
                    matches.push({ rule, eclassId: id, substitution: subst });
                }
            }
        }
    }

    return deduplicateMatches(matches);
}

function deduplicateMatches(matches: Match[]): Match[] {
    const unique = new Set<string>();
    const result: Match[] = [];

    for (const m of matches) {
        // Key: ruleName + eclass + sorted_subst
        const substKey = Array.from(m.substitution.entries())
            .sort((a, b) => a[0].localeCompare(b[0]))
            .map(([k, v]) => `${k}=${v}`)
            .join(',');
        const key = `${m.rule.name}:${m.eclassId}:${substKey}`;

        if (!unique.has(key)) {
            unique.add(key);
            result.push(m);
        }
    }
    return result;
}

function matchPattern(
    runtime: EGraphRuntime,
    pattern: Pattern,
    enode: ENode,
    subst: Map<string, ENodeId> = new Map()
): Map<string, ENodeId> | null {
    const newSubst = new Map(subst);

    if (typeof pattern === 'string') {
        if (pattern.startsWith('?')) {
            // Variable
            if (newSubst.has(pattern)) {
                if (newSubst.get(pattern) !== runtime.find(runtime.addEnode(enode))) {
                    return null;
                }
            } else {
                // Note: We cannot easily bind a variable to a class ID here because we only have the ENode.
                // However, matchPattern is typically called recursively.
                // For the root pattern, the caller handles binding if necessary, or we assume the variable matches the class.
                // But wait, if the pattern IS just a variable "?x", it matches anything.
                // The issue is we don't know the Class ID of `enode` here to bind it.
                // This case (root pattern is variable) should be handled by the caller or passed in context.
                // For now, we assume this function is primarily for checking structure.
                // If we are here, it means we are matching a variable against a node.
                // This implies the variable binds to the class containing this node.
                // But we don't have the class ID.
                // In `collectMatches`, we iterate classes.
                // If the rule is just "?x", it matches every class.
                // This specific function `matchPattern` might need refactoring if we want to support root variables fully
                // without passing class ID.
                // For now, we'll return null if we can't verify.
                // But actually, if pattern is string, we handled it above?
                // Wait, lines 135-173 handle string pattern.
                return null;
            }
        } else {
            // Literal string
            if (enode.op === pattern && enode.args.length === 0) return newSubst;
            return null;
        }
    } else {
        // 1. Check operator
        if (pattern.op !== enode.op) {
            return null;
        }

        // 2. Check arity
        if (pattern.args.length !== enode.args.length) {
            return null;
        }

        for (let i = 0; i < pattern.args.length; i++) {
            const patArg = pattern.args[i];
            const nodeArgId = runtime.find(enode.args[i]); // Canonicalize!

            // Recursive match?
            // If patArg is simple (string/number), we check it.
            // If patArg is nested Pattern, we check if class `nodeArgId` matches.

            if (typeof patArg === 'string') {
                if (patArg.startsWith('?')) {
                    if (newSubst.has(patArg)) {
                        // Check consistency: variable must map to same eclass
                        if (newSubst.get(patArg) !== nodeArgId) {
                            return null;
                        }
                    } else {
                        // Bind variable
                        newSubst.set(patArg, nodeArgId);
                    }
                } else {
                    // Literal arg
                    // Check if class `nodeArgId` has literal `patArg`
                    const childClass = runtime.eclasses.get(nodeArgId);
                    if (!childClass) return null;
                    if (!childClass.nodes.some(id => {
                        const n = runtime.nodes[id];
                        return n.op === patArg && n.args.length === 0;
                    })) {
                        return null;
                    }
                }
            } else if (typeof patArg === 'number') {
                if (patArg !== nodeArgId) {
                    return null;
                }
            } else {
                // Nested Pattern
                const childClass = runtime.eclasses.get(nodeArgId);
                if (!childClass) {
                    return null;
                }
                let found = false;
                for (const childId of childClass.nodes) {
                    const childNode = runtime.nodes[childId];
                    const res = matchPattern(runtime, patArg, childNode, newSubst);
                    if (res) {
                        for (const [k, v] of res) newSubst.set(k, v);
                        found = true;
                        break;
                    }
                }
                if (!found) {
                    return null;
                }
            }
        }
        return newSubst;
    }
    return null; // Should be unreachable
}

// --- Applying Rewrites ---

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

        // Deduplication check:
        // If the new node is ALREADY in the target class, merge returns the same ID and does nothing.
        // We can check this before calling merge to avoid recording a diff.
        if (target === actualNewId) {
            // Redundant rewrite
            continue;
        }

        // Perform merge
        runtime.merge(target, actualNewId);

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
