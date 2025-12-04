import type { PresetConfig } from './types';

const STORAGE_KEY = 'egraph-vis-user-presets';

export function loadUserPresets(): PresetConfig[] {
    if (typeof localStorage === 'undefined') return [];
    try {
        const stored = localStorage.getItem(STORAGE_KEY);
        return stored ? JSON.parse(stored) : [];
    } catch (e) {
        console.error('Failed to load user presets:', e);
        return [];
    }
}

export function saveUserPreset(preset: PresetConfig): void {
    if (typeof localStorage === 'undefined') return;
    const presets = loadUserPresets();
    const index = presets.findIndex(p => p.id === preset.id);

    if (index >= 0) {
        presets[index] = preset;
    } else {
        presets.push(preset);
    }

    try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(presets));
    } catch (e) {
        console.error('Failed to save user preset:', e);
    }
}

export function deleteUserPreset(id: string): void {
    if (typeof localStorage === 'undefined') return;
    const presets = loadUserPresets();
    const filtered = presets.filter(p => p.id !== id);

    try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(filtered));
    } catch (e) {
        console.error('Failed to delete user preset:', e);
    }
}

export function exportPresets(presets: PresetConfig[]): string {
    return JSON.stringify(presets, null, 2);
}

export function importPresets(json: string): { presets: PresetConfig[]; errors: string[] } {
    const errors: string[] = [];
    let presets: PresetConfig[] = [];

    try {
        const parsed = JSON.parse(json);
        const candidates = Array.isArray(parsed) ? parsed : [parsed];

        for (const p of candidates) {
            if (!isValidPreset(p)) {
                errors.push(`Invalid preset structure: ${p.id || 'unknown id'}`);
            } else {
                presets.push(p);
            }
        }
    } catch (e) {
        errors.push('Invalid JSON format');
    }

    return { presets, errors };
}

export function isUserPreset(id: string): boolean {
    const presets = loadUserPresets();
    return presets.some(p => p.id === id);
}

function isValidPreset(p: any): p is PresetConfig {
    return (
        typeof p === 'object' &&
        p !== null &&
        typeof p.id === 'string' &&
        typeof p.label === 'string' &&
        p.root !== undefined && // root can be string or object
        Array.isArray(p.rewrites)
    );
}
