import { writable } from 'svelte/store';

export type HoverTarget =
    | { type: 'eclass'; id: number }
    | { type: 'enode'; id: number }
    | { type: 'hashcons'; key: string };

export interface Selection {
    nodeIds: Set<number>;
}

interface InteractionState {
    hover: HoverTarget | null;
    selection: Selection | null;
}

function createInteractionStore() {
    const { subscribe, update } = writable<InteractionState>({
        hover: null,
        selection: null
    });

    return {
        subscribe,
        hover: (target: HoverTarget) => update(state => ({ ...state, hover: target })),
        clearHover: () => update(state => ({ ...state, hover: null })),

        // Select a single E-Node
        selectENode: (id: number) => update(state => ({
            ...state,
            selection: { nodeIds: new Set([id]) }
        })),

        // Select all nodes in an E-Class
        selectEClass: (nodeIdsInClass: number[]) => update(state => ({
            ...state,
            selection: { nodeIds: new Set(nodeIdsInClass) }
        })),

        // Toggle a node in/out of selection (for future multi-select)
        toggleENode: (id: number) => update(state => {
            if (!state.selection) {
                return { ...state, selection: { nodeIds: new Set([id]) } };
            }
            const newSet = new Set(state.selection.nodeIds);
            if (newSet.has(id)) {
                newSet.delete(id);
                return {
                    ...state,
                    selection: newSet.size > 0 ? { nodeIds: newSet } : null
                };
            } else {
                newSet.add(id);
                return { ...state, selection: { nodeIds: newSet } };
            }
        }),
        clearSelection: () => update(s => ({ ...s, selection: null })),
    };
}

export const interactionStore = createInteractionStore();

// Helper: Check if all nodes in an E-Class are selected
export function isEClassFullySelected(nodeIds: number[], selection: Selection | null): boolean {
    if (!selection) return false;
    return nodeIds.every(id => selection.nodeIds.has(id));
}
