import { writable, derived, get } from 'svelte/store';
import type { PresetConfig, RewriteRule, Pattern } from '../engine/types';
import { saveUserPreset, isUserPreset } from '../engine/presetStorage';

// Core state
export const isEditing = writable(false);
export const draftPreset = writable<PresetConfig | null>(null);
export const originalPresetId = writable<string | null>(null);
const originalPresetJson = writable<string | null>(null);

// Derived state
export const isDirty = derived(
    [draftPreset, originalPresetJson],
    ([$draft, $origJson]) => {
        if (!$draft || !$origJson) return false;
        return JSON.stringify($draft) !== $origJson;
    }
);

// Actions
export function enterEditMode(preset: PresetConfig) {
    // Deep copy to create draft
    const json = JSON.stringify(preset);
    const draft = JSON.parse(json);
    draftPreset.set(draft);
    originalPresetId.set(preset.id);
    originalPresetJson.set(json);
    isEditing.set(true);
}

export function exitEditMode() {
    isEditing.set(false);
    draftPreset.set(null);
    originalPresetId.set(null);
    originalPresetJson.set(null);
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
    originalPresetJson.set(JSON.stringify(newPreset));

    // We stay in edit mode but now editing the new preset
    return newPreset;
}

export function revertChanges(originalPreset: PresetConfig) {
    enterEditMode(originalPreset);
}
