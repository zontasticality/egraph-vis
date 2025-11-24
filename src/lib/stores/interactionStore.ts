import { writable } from 'svelte/store';

export type InteractionType = 'enode' | 'eclass' | 'hashcons';

export interface InteractionTarget {
    type: InteractionType;
    id: number | string;
}

export interface InteractionState {
    selection: InteractionTarget | null;
    hover: InteractionTarget | null;
}

function createInteractionStore() {
    const { subscribe, set, update } = writable<InteractionState>({
        selection: null,
        hover: null
    });

    return {
        subscribe,
        select: (target: InteractionTarget | null) => update(s => {
            // Toggle selection if clicking the same item? 
            // Spec says "Exclusive selection. Clicking an item selects it and deselects the previous one."
            // "Deselection: Clicking the background of any pane clears the selection."
            // So if target is passed, select it. If null, clear it.
            // Let's implement simple set for now.
            return { ...s, selection: target };
        }),
        hover: (target: InteractionTarget | null) => update(s => ({ ...s, hover: target })),
        clearSelection: () => update(s => ({ ...s, selection: null })),
        clearHover: () => update(s => ({ ...s, hover: null }))
    };
}

export const interactionStore = createInteractionStore();
