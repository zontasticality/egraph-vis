import type { Pattern, PresetConfig, RewriteRule } from './types';
import { collectVariables } from './parser';
import { isVariablePattern } from '../utils/typeGuards';

const STORAGE_KEY = 'egraph-vis-user-presets';

/** Raw stored list (entries are left untouched so saving never drops anything). */
function readStored(): unknown[] {
    if (typeof localStorage === 'undefined') return [];
    try {
        const stored = localStorage.getItem(STORAGE_KEY);
        if (!stored) return [];
        const parsed = JSON.parse(stored);
        return Array.isArray(parsed) ? parsed : [];
    } catch (e) {
        console.error('Failed to load user presets:', e);
        return [];
    }
}

function writeStored(entries: unknown[]) {
    try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(entries));
    } catch (e) {
        console.error('Failed to save user presets:', e);
    }
}

const storedId = (p: unknown) => (p && typeof p === 'object' ? (p as { id?: unknown }).id : undefined);

/**
 * User presets that can be shown. Entries saved by older versions are kept as
 * long as they have the basic shape; rule-level problems surface as engine
 * errors when loaded instead of silently hiding (or deleting) the preset.
 */
export function loadUserPresets(): PresetConfig[] {
    return readStored().filter(isLoadablePreset).map(normalizePreset);
}

export function saveUserPreset(preset: PresetConfig): void {
    if (typeof localStorage === 'undefined') return;
    const entries = readStored();
    const index = entries.findIndex(p => storedId(p) === preset.id);
    if (index >= 0) {
        entries[index] = preset;
    } else {
        entries.push(preset);
    }
    writeStored(entries);
}

export function deleteUserPreset(id: string): void {
    if (typeof localStorage === 'undefined') return;
    writeStored(readStored().filter(p => storedId(p) !== id));
}

export function exportPresets(presets: PresetConfig[]): string {
    return JSON.stringify(presets, null, 2);
}

export function importPresets(json: string): { presets: PresetConfig[]; errors: string[] } {
    const errors: string[] = [];
    const presets: PresetConfig[] = [];

    let parsed: unknown;
    try {
        parsed = JSON.parse(json);
    } catch {
        return { presets, errors: ['Invalid JSON format'] };
    }

    const candidates = Array.isArray(parsed) ? parsed : [parsed];
    candidates.forEach((p, i) => {
        const problems = validatePreset(p);
        if (problems.length > 0) {
            const name = p && typeof p === 'object' && typeof (p as any).id === 'string' ? (p as any).id : `#${i + 1}`;
            errors.push(`Invalid preset ${name}: ${problems.join('; ')}`);
        } else {
            presets.push(normalizePreset(p as PresetConfig));
        }
    });

    return { presets, errors };
}

export function isUserPreset(id: string): boolean {
    return loadUserPresets().some(p => p.id === id);
}

/** Operator / constant names must be single parser tokens. */
const isSymbol = (s: unknown): s is string => typeof s === 'string' && /^[^\s(),]+$/.test(s);

function isPattern(p: unknown, depth = 0): p is Pattern {
    if (depth > 200) return false;
    if (typeof p === 'string') return isSymbol(p);
    if (!p || typeof p !== 'object') return false;
    const o = p as { op?: unknown; args?: unknown };
    return (
        isSymbol(o.op) &&
        !o.op.startsWith('?') &&
        Array.isArray(o.args) &&
        o.args.every(a => isPattern(a, depth + 1))
    );
}

function validateRule(r: unknown, index: number): string[] {
    if (!r || typeof r !== 'object') return [`rule ${index + 1} is not an object`];
    const rule = r as Partial<RewriteRule>;
    const label = typeof rule.name === 'string' && rule.name ? `rule "${rule.name}"` : `rule ${index + 1}`;
    const errors: string[] = [];
    if (typeof rule.name !== 'string' || !rule.name) errors.push(`${label} has no name`);
    if (!isPattern(rule.lhs)) errors.push(`${label} has an invalid LHS`);
    if (!isPattern(rule.rhs)) errors.push(`${label} has an invalid RHS`);
    if (rule.enabled !== undefined && typeof rule.enabled !== 'boolean') errors.push(`${label}: "enabled" must be a boolean`);
    if (errors.length === 0) {
        if (isVariablePattern(rule.lhs!)) errors.push(`${label}: LHS cannot be a bare variable`);
        const bound = collectVariables(rule.lhs!);
        for (const v of collectVariables(rule.rhs!)) {
            if (!bound.has(v)) errors.push(`${label}: ${v} is not bound by the LHS`);
        }
    }
    return errors;
}

/** Return a list of problems with a preset (empty when valid). */
export function validatePreset(p: unknown): string[] {
    if (!p || typeof p !== 'object' || Array.isArray(p)) return ['not an object'];
    const preset = p as Partial<PresetConfig>;
    const errors: string[] = [];
    if (typeof preset.id !== 'string' || !preset.id.trim()) errors.push('missing id');
    if (typeof preset.label !== 'string') errors.push('missing label');
    if (!isPattern(preset.root)) errors.push('invalid root term');
    if (!Array.isArray(preset.rewrites)) {
        errors.push('rewrites must be a list');
    } else {
        preset.rewrites.forEach((r, i) => errors.push(...validateRule(r, i)));
    }
    return errors;
}

function isLoadablePreset(p: unknown): p is PresetConfig {
    if (!p || typeof p !== 'object') return false;
    const o = p as Partial<PresetConfig>;
    return typeof o.id === 'string' && !!o.id && typeof o.label === 'string' && isPattern(o.root) && Array.isArray(o.rewrites);
}

function normalizePreset(p: PresetConfig): PresetConfig {
    return {
        ...p,
        description: typeof p.description === 'string' ? p.description : '',
        rewrites: p.rewrites.map(r => ({ ...r, enabled: r.enabled ?? true }))
    };
}
