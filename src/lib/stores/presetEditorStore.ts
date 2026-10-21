import { writable, derived, get } from 'svelte/store';
import type { PresetConfig, RewriteRule, Pattern } from '../engine/types';
import { saveUserPreset } from '../engine/presetStorage';

// Core state
export const isEditing = writable(false);
export const draftPreset = writable<PresetConfig | null>(null);
export const originalPresetId = writable<string | null>(null);
/** The preset as it was when editing started (what "Revert" restores). */
export const originalPreset = writable<PresetConfig | null>(null);

const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value));

// Derived state
export const isDirty = derived([draftPreset, originalPreset], ([$draft, $orig]) => {
    if (!$draft || !$orig) return false;
    return JSON.stringify($draft) !== JSON.stringify($orig);
});

// Actions
export function enterEditMode(preset: PresetConfig) {
    originalPreset.set(clone(preset));
    draftPreset.set(clone(preset));
    originalPresetId.set(preset.id);
    isEditing.set(true);
}

export function exitEditMode() {
    isEditing.set(false);
    draftPreset.set(null);
    originalPresetId.set(null);
    originalPreset.set(null);
}

export function updateDraftRoot(root: Pattern) {
    draftPreset.update(p => (p ? { ...p, root } : null));
}

export function updateDraftRules(rules: RewriteRule[]) {
    draftPreset.update(p => (p ? { ...p, rewrites: rules } : null));
}

export function saveAsPreset(id: string, label: string, description: string) {
    const draft = get(draftPreset);
    if (!draft) return;

    const newPreset: PresetConfig = { ...clone(draft), id, label, description };
    saveUserPreset(newPreset);

    // The saved preset becomes the new baseline
    draftPreset.set(clone(newPreset));
    originalPreset.set(clone(newPreset));
    originalPresetId.set(id);
    return newPreset;
}

/** Discard all edits made since editing started. */
export function revertChanges() {
    const orig = get(originalPreset);
    if (orig) draftPreset.set(clone(orig));
}
