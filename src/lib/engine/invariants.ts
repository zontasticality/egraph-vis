import type { EGraphRuntime } from './runtime';

/**
 * Check the e-graph invariants that must hold after a full rebuild
 * (egg §3: congruence + hashcons invariants, plus bookkeeping consistency).
 * Returns a list of human readable violations (empty = all good).
 */
export function checkInvariants(runtime: EGraphRuntime): string[] {
    const errors: string[] = [];
    const seenNodes = new Map<number, number>(); // node -> class
    const canonicalForms = new Map<string, number>(); // key -> node

    if (runtime.worklist.size > 0) {
        errors.push(`worklist not empty: [${Array.from(runtime.worklist).join(', ')}]`);
    }

    for (const [classId, eclass] of runtime.eclasses) {
        if (eclass.id !== classId) {
            errors.push(`e-class map key ${classId} holds class with id ${eclass.id}`);
        }
        if (runtime.find(classId) !== classId) {
            errors.push(`e-class ${classId} is not canonical (find = ${runtime.find(classId)})`);
        }
        if (eclass.nodes.length === 0) {
            errors.push(`e-class ${classId} is empty`);
        }
        for (const nodeId of eclass.nodes) {
            if (seenNodes.has(nodeId)) {
                errors.push(`e-node ${nodeId} appears in e-classes ${seenNodes.get(nodeId)} and ${classId}`);
            }
            seenNodes.set(nodeId, classId);
            if (runtime.removedNodes.has(nodeId)) {
                errors.push(`removed e-node ${nodeId} still in e-class ${classId}`);
            }
            if (runtime.find(nodeId) !== classId) {
                errors.push(`e-node ${nodeId} in e-class ${classId} but find(${nodeId}) = ${runtime.find(nodeId)}`);
            }

            const node = runtime.nodes[nodeId];
            for (const arg of node.args) {
                if (runtime.find(arg) !== arg) {
                    errors.push(`e-node ${nodeId} ${runtime.canonicalKey(node)} has non-canonical child ${arg}`);
                }
                if (!runtime.eclasses.has(runtime.find(arg))) {
                    errors.push(`e-node ${nodeId} points to missing e-class ${arg}`);
                }
            }

            // Congruence invariant: identical canonical e-nodes are the same e-node
            const key = runtime.canonicalKey(runtime.canonicalize(node));
            const other = canonicalForms.get(key);
            if (other !== undefined) {
                const otherClass = seenNodes.get(other);
                errors.push(
                    otherClass === classId
                        ? `duplicate e-nodes ${other} and ${nodeId} (${key}) in e-class ${classId}`
                        : `congruence violated: ${key} in e-classes ${otherClass} (node ${other}) and ${classId} (node ${nodeId})`
                );
            } else {
                canonicalForms.set(key, nodeId);
            }

            // Hashcons invariant: every canonical e-node is in the hashcons
            const hc = runtime.hashcons.get(key);
            if (hc === undefined) {
                errors.push(`hashcons missing ${key} (e-node ${nodeId})`);
            } else if (runtime.find(hc) !== classId) {
                errors.push(`hashcons maps ${key} to ${hc} (class ${runtime.find(hc)}), expected ${classId}`);
            }

            // Parent bookkeeping: each child class knows about this parent
            for (const arg of new Set(node.args.map(a => runtime.find(a)))) {
                const child = runtime.eclasses.get(arg);
                if (!child) continue;
                const known = Array.from(child.parents.values()).some(
                    p => !runtime.removedNodes.has(p.parentId) && runtime.find(p.parentId) === classId &&
                        runtime.canonicalKey(runtime.canonicalize(runtime.nodes[p.parentId])) === key
                );
                if (!known) {
                    errors.push(`e-class ${arg} is missing parent e-node ${nodeId} (${key})`);
                }
            }
        }
    }

    // Hashcons must not contain stale or dangling keys
    for (const [key, classId] of runtime.hashcons) {
        if (!canonicalForms.has(key)) {
            errors.push(`hashcons has stale entry ${key} -> ${classId}`);
        }
    }

    // Every live node must be accounted for
    for (let id = 0; id < runtime.nodes.length; id++) {
        if (!seenNodes.has(id) && !runtime.removedNodes.has(id)) {
            errors.push(`e-node ${id} is not in any e-class`);
        }
    }

    return errors;
}

export function assertInvariants(runtime: EGraphRuntime, context = '') {
    const errors = checkInvariants(runtime);
    if (errors.length > 0) {
        const head = errors.slice(0, 10).join('\n  ');
        const more = errors.length > 10 ? `\n  ...and ${errors.length - 10} more` : '';
        throw new Error(`E-graph invariants violated${context ? ` (${context})` : ''}:\n  ${head}${more}`);
    }
}
