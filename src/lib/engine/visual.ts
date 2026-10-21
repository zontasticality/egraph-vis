import type {
    EGraphState,
    NodeVisualState,
    EClassVisualState,
    NodeStyleClass,
} from './types';
import { NodeStyleClass as NSC, EClassStyleClass as ESC } from './types';

/**
 * Compute visual states for all nodes and e-classes in a snapshot.
 * This centralizes all visual classification logic in one place.
 *
 * Node states are sparse: e-nodes in the Default style are omitted.
 */
export function computeVisualStates(state: Pick<EGraphState, 'phase' | 'metadata' | 'eclasses' | 'unionFind' | 'worklist'>): {
    nodes: Map<number, NodeVisualState>;
    eclasses: Map<number, EClassVisualState>;
} {
    const nodeStates = new Map<number, NodeVisualState>();
    const eclassStates = new Map<number, EClassVisualState>();
    const { phase, metadata } = state;

    const matched = new Set<number>();
    const created = new Set<number>();
    const repairing = new Set<number>();

    if (phase === 'read' || phase === 'read-batch') {
        metadata.matches.forEach(m => m.nodes.forEach(id => matched.add(id)));
    } else if (phase === 'write' && metadata.applied) {
        for (const a of metadata.applied) {
            a.lhsNodes.forEach(id => matched.add(id));
            a.newNodes.forEach(id => created.add(id));
        }
    } else if (phase === 'repair') {
        metadata.repairedNodes?.forEach(id => repairing.add(id));
    }

    const isCanonical = (id: number) => (state.unionFind[id]?.canonical ?? id) === id;

    for (const eclass of state.eclasses) {
        for (const node of eclass.nodes) {
            const styleClass = classifyNode(
                repairing.has(node.id),
                created.has(node.id),
                matched.has(node.id),
                node.args.some(arg => !isCanonical(arg))
            );
            if (styleClass !== NSC.Default) {
                nodeStates.set(node.id, { styleClass });
            }
        }
    }

    const worklist = new Set(state.worklist);
    const searching = new Set(phase === 'read-batch' ? metadata.batch?.classIds ?? [] : []);
    for (const eclass of state.eclasses) {
        const canonical = isCanonical(eclass.id);
        let styleClass = ESC.Default;
        if (!canonical) {
            styleClass = ESC.Merged;
        } else if (searching.has(eclass.id)) {
            styleClass = ESC.Searching;
        } else if ((phase === 'repair' || phase === 'compact') && eclass.id === metadata.activeId) {
            styleClass = ESC.Active;
        } else if (worklist.has(eclass.id)) {
            styleClass = ESC.InWorklist;
        }
        eclassStates.set(eclass.id, { styleClass, isCanonical: canonical });
    }

    return { nodes: nodeStates, eclasses: eclassStates };
}

/**
 * Priority order (highest to lowest):
 * 1. ParentNode (repair: parent being re-canonicalized)
 * 2. NewNode (write: created by the rewrite)
 * 3. MatchedLHS (read/write: matched by a pattern)
 * 4. NonCanonical (stored children point at merged e-classes)
 * 5. Default
 */
function classifyNode(isRepairing: boolean, isNew: boolean, isMatched: boolean, isStale: boolean): NodeStyleClass {
    if (isRepairing) return NSC.ParentNode;
    if (isNew) return NSC.NewNode;
    if (isMatched) return NSC.MatchedLHS;
    if (isStale) return NSC.NonCanonical;
    return NSC.Default;
}

export function getNodeStyleClass(state: EGraphState, nodeId: number): NodeStyleClass {
    return state.visualStates.nodes.get(nodeId)?.styleClass ?? NSC.Default;
}
