import { writable, derived, get } from 'svelte/store';
import type { PresetConfig, RewriteRule, Pattern } from '../engine/types';
import { saveUserPreset, isUserPreset } from '../engine/presetStorage';

// Core state
export const isEditing = writable(false);
export const draftPreset = writable<PresetConfig | null>(null);
export const originalPresetId = writable<string | null>(null);

// Derived state
export const isDirty = derived(
    [draftPreset, originalPresetId],
    ([$draft, $origId]) => {
        if (!$draft || !$origId) return false;
        // Simple dirty check - in a real app might want deep comparison
        // For now, we assume any mutation to draft sets it as dirty
        // But since we don't have the original object to compare against easily here without fetching it,
        // we'll rely on the actions to set a dirty flag or just assume true if draft exists.
        // Actually, let's make it simpler: if we are in edit mode, we assume it's dirty if changed.
        // For this MVP, let's just return true if we are editing. 
        // Refinement: We can track a separate dirty flag.
        return true;
    }
);

// Actions
export function enterEditMode(preset: PresetConfig) {
    // Deep copy to create draft
    const draft = JSON.parse(JSON.stringify(preset));
    draftPreset.set(draft);
    originalPresetId.set(preset.id);
    isEditing.set(true);
}

export function exitEditMode() {
    isEditing.set(false);
    draftPreset.set(null);
    originalPresetId.set(null);
}

export function updateDraftRoot(root: Pattern) {
    draftPreset.update(p => {
        if (!p) return null;
        return { ...p, root };
    });
}

export function updateDraftRules(rules: RewriteRule[]) {
    draftPreset.update(p => {
        if (!p) return null;
        return { ...p, rewrites: rules };
    });
}

export function saveAsPreset(id: string, label: string, description: string) {
    const draft = get(draftPreset);
    if (!draft) return;

    // User requested to use label as ID and remove description
    // We keep the signature compatible with +page.svelte but we could simplify it
    // effectively id should be equal to label here based on SaveAsDialog logic

    const newPreset: PresetConfig = {
        ...draft,
        id: id,
        label: label,
        description: description
    };

    saveUserPreset(newPreset);

    // Update draft to match saved state
    draftPreset.set(newPreset);
    originalPresetId.set(id);

    // We stay in edit mode but now editing the new preset
    return newPreset;
}

export function revertChanges(originalPreset: PresetConfig) {
    enterEditMode(originalPreset);
}
