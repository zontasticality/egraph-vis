import type {
    EGraphState,
    NodeVisualState,
    EClassVisualState,
    NodeStyleClass,
    EClassStyleClass
} from './types';
import { NodeStyleClass as NSC, EClassStyleClass as ESC } from './types';

/**
 * Compute visual states for all nodes and e-classes in a snapshot.
 * This centralizes all visual classification logic in one place.
 */
export function computeVisualStates(state: EGraphState): {
    nodes: Map<number, NodeVisualState>;
    eclasses: Map<number, EClassVisualState>;
} {
    const nodeStates = new Map<number, NodeVisualState>();
    const eclassStates = new Map<number, EClassVisualState>();

    const phase = state.phase;

    // Build lookup sets for efficient classification
    const matchedNodeIds = new Set<number>();
    state.metadata.matches?.forEach(m => m.nodes.forEach(id => matchedNodeIds.add(id)));

    // Also add currentMatchingNodes if present (for read-batch phase)
    state.metadata.currentMatchingNodes?.forEach(id => matchedNodeIds.add(id));

    const newNodeIds = new Set<number>();
    state.metadata.diffs?.forEach(d => {
        if (d.type === 'add') newNodeIds.add(d.nodeId);
        if (d.type === 'rewrite') newNodeIds.add(d.createdId);
    });

    const activeId = state.metadata.activeId;

    // Compute node visual states
    for (const eclass of state.eclasses) {
        for (const node of eclass.nodes) {
            const styleClass = computeNodeStyleClass(
                node,
                phase,
                matchedNodeIds.has(node.id),
                newNodeIds.has(node.id),
                activeId,
                state.unionFind
            );

            // Compute canonical targets for ports (for port color determination)
            const portTargets = node.args.map(argId =>
                state.unionFind[argId]?.canonical ?? argId
            );

            nodeStates.set(node.id, { styleClass, portTargets });
        }
    }

    // Compute e-class visual states
    for (const eclass of state.eclasses) {
        const canonical = state.unionFind[eclass.id]?.canonical ?? eclass.id;
        const isCanonical = eclass.id === canonical;

        let styleClass = ESC.Default;

        // Priority-based classification (highest to lowest)
        if (phase === 'compact' && !isCanonical) {
            styleClass = ESC.Merged;
        } else if ((phase === 'repair' || phase === 'compact') && eclass.id === activeId) {
            styleClass = ESC.Active;
        } else if (state.worklist.includes(eclass.id)) {
            styleClass = ESC.InWorklist;
        }

        eclassStates.set(eclass.id, { styleClass, isCanonical });
    }

    return { nodes: nodeStates, eclasses: eclassStates };
}

/**
 * Determine the style class for a single node based on phase and context.
 * Priority order (highest to lowest):
 * 1. ParentNode (repair phase)
 * 2. NonCanonical (compact phase)
 * 3. NewNode (write phase)
 * 4. MatchedLHS (read/write phase)
 * 5. Default
 */
function computeNodeStyleClass(
    node: { id: number; op: string; args: number[] },
    phase: string,
    isMatched: boolean,
    isNew: boolean,
    activeId: number | undefined,
    unionFind: Array<{ id: number; canonical: number; isCanonical: boolean }>
): NodeStyleClass {
    // Priority 1: Repair phase - parent nodes being repaired
    if (phase === 'repair' && activeId !== undefined && node.args.includes(activeId)) {
        return NSC.ParentNode;
    }

    // Priority 2: Compact phase - non-canonical nodes (ghost nodes)
    if (phase === 'compact') {
        const hasNonCanonicalArg = node.args.some(argId => {
            const argClass = unionFind[argId];
            return argClass && !argClass.isCanonical;
        });
        if (hasNonCanonicalArg) {
            return NSC.NonCanonical;
        }
    }

    // Priority 3: Write phase - new nodes (higher priority than matches)
    if (phase === 'write' && isNew) {
        return NSC.NewNode;
    }

    // Priority 4: Read/Write phase - matched LHS nodes
    if ((phase === 'read' || phase === 'read-batch' || phase === 'write') && isMatched) {
        return NSC.MatchedLHS;
    }

    // Priority 5: Default
    return NSC.Default;
}
