// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { get } from 'svelte/store';
import {
    isEditing,
    draftPreset,
    isDirty,
    enterEditMode,
    exitEditMode,
    updateDraftRoot,
    updateDraftRules,
    saveAsPreset,
    revertChanges,
} from './presetEditorStore';
import {
    loadUserPresets,
    saveUserPreset,
    deleteUserPreset,
    exportPresets,
    importPresets,
    isUserPreset,
} from '../engine/presetStorage';
import { PRESETS, getAllPresets, getPresetById } from '../presets';

const paper = PRESETS.find(p => p.id === 'paper-example')!;

describe('presetEditorStore', () => {
    beforeEach(() => {
        localStorage.clear();
        exitEditMode();
    });

    it('starts clean and becomes dirty after edits', () => {
        enterEditMode(paper);
        expect(get(isEditing)).toBe(true);
        expect(get(isDirty)).toBe(false);
        updateDraftRoot('a');
        expect(get(isDirty)).toBe(true);
    });

    it('never mutates the preset being edited', () => {
        const before = JSON.stringify(paper);
        enterEditMode(paper);
        updateDraftRules([]);
        updateDraftRoot('z');
        expect(JSON.stringify(paper)).toBe(before);
    });

    it('reverts to the preset as it was when editing started', () => {
        // Regression: revert used to reset to whatever was last loaded (the draft)
        enterEditMode(paper);
        updateDraftRules(paper.rewrites.slice(1));
        updateDraftRoot({ op: 'f', args: ['a'] });
        revertChanges();
        expect(get(draftPreset)).toEqual(paper);
        expect(get(isDirty)).toBe(false);
    });

    it('saves a copy under a new id and treats it as the new baseline', () => {
        enterEditMode(paper);
        updateDraftRoot('a');
        const saved = saveAsPreset('mine', 'Mine', 'desc')!;
        expect(saved.id).toBe('mine');
        expect(get(isDirty)).toBe(false);
        expect(isUserPreset('mine')).toBe(true);
        expect(getPresetById('mine')!.root).toBe('a');
        // still editing the new preset; reverting goes back to the saved version
        updateDraftRoot('b');
        revertChanges();
        expect(get(draftPreset)!.root).toBe('a');
    });

    it('exits cleanly', () => {
        enterEditMode(paper);
        exitEditMode();
        expect(get(isEditing)).toBe(false);
        expect(get(draftPreset)).toBeNull();
        expect(get(isDirty)).toBe(false);
    });
});

describe('presetStorage', () => {
    beforeEach(() => localStorage.clear());

    it('saves, overwrites and deletes user presets', () => {
        saveUserPreset({ ...paper, id: 'x', label: 'X' });
        saveUserPreset({ ...paper, id: 'x', label: 'X2' });
        expect(loadUserPresets().map(p => p.label)).toEqual(['X2']);
        deleteUserPreset('x');
        expect(loadUserPresets()).toEqual([]);
    });

    it('lets user presets shadow built-ins', () => {
        saveUserPreset({ ...paper, label: 'Shadowed' });
        expect(getAllPresets().filter(p => p.id === paper.id).map(p => p.label)).toEqual(['Shadowed']);
        deleteUserPreset(paper.id);
        expect(getPresetById(paper.id)!.label).toBe(paper.label);
    });

    it('never drops other stored presets when saving or deleting', () => {
        // Regression: entries failing the (stricter) validation were erased on save
        const legacy = { id: 'old', label: 'Old', root: 'a', rewrites: [{ name: 'r', lhs: 'a', rhs: '?y', enabled: true }] };
        localStorage.setItem('egraph-vis-user-presets', JSON.stringify([legacy, { junk: true }]));
        saveUserPreset({ ...paper, id: 'new', label: 'New' });
        deleteUserPreset('new');
        expect(JSON.parse(localStorage.getItem('egraph-vis-user-presets')!)).toEqual([legacy, { junk: true }]);
        // the legacy preset is still listed so it can be fixed or deleted from the UI
        expect(loadUserPresets().map(p => p.id)).toEqual(['old']);
    });

    it('survives corrupt storage', () => {
        const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
        localStorage.setItem('egraph-vis-user-presets', '{not json');
        expect(loadUserPresets()).toEqual([]);
        localStorage.setItem('egraph-vis-user-presets', '{"not": "an array"}');
        expect(loadUserPresets()).toEqual([]);
        spy.mockRestore();
    });

    it('round-trips exports through imports', () => {
        const { presets, errors } = importPresets(exportPresets(PRESETS));
        expect(errors).toEqual([]);
        expect(presets).toEqual(PRESETS);
    });

    it('reports invalid imports', () => {
        expect(importPresets('nope').errors).toEqual(['Invalid JSON format']);
        const res = importPresets(JSON.stringify([{ id: 'ok', label: 'ok', root: 'a', rewrites: [] }, { id: 'bad' }, null]));
        expect(res.presets.map(p => p.id)).toEqual(['ok']);
        expect(res.errors).toHaveLength(2);
        expect(res.errors[0]).toMatch(/Invalid preset bad: .*missing label/);
        expect(res.errors[1]).toMatch(/Invalid preset #3: not an object/);
        // missing description / enabled are filled in
        expect(res.presets[0].description).toBe('');
    });

    it('rejects presets with malformed rules or patterns', () => {
        const bad = [
            { id: 'a', label: 'a', root: 'a', rewrites: [{ name: 'r', lhs: 'x', enabled: true }] },
            { id: 'b', label: 'b', root: { op: 'f' }, rewrites: [] },
            { id: 'c', label: 'c', root: 'a', rewrites: [{ name: 'r', lhs: '?x', rhs: '?y', enabled: true }] },
            { id: 'd', label: 'd', root: { op: 'f(', args: ['a'] }, rewrites: [] },
            { id: 'e', label: 'e', root: { op: 'f', args: [7] }, rewrites: [] },
        ];
        const res = importPresets(JSON.stringify(bad));
        expect(res.presets).toEqual([]);
        expect(res.errors.length).toBe(5);
    });
});
