// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/svelte';
import { get } from 'svelte/store';
import StatePane from './state_pane/StatePane.svelte';
import Controller from './Controller.svelte';
import RewriteRulesPanel from './graph_pane/RewriteRulesPanel.svelte';
import SingleRewriteRuleEditor from './editors/SingleRewriteRuleEditor.svelte';
import GraphCanvas from './graph_pane/GraphCanvas.svelte';
import { loadPreset, goToStep, stop, timeline, currentIndex, timeScaleMode, executionSpans } from '../stores/timelineStore';
import { executionTiming } from '../stores/benchmarkStore';
import { exitEditMode, isEditing, draftPreset } from '../stores/presetEditorStore';
import { layoutManager } from '../engine/layout';
import { PRESETS } from '../presets';

const paper = PRESETS.find(p => p.id === 'paper-example')!;

function indexOfPhase(phase: string, nth = 0) {
    const states = get(timeline)!.states;
    return states.map((s, i) => [s.phase, i] as const).filter(([p]) => p === phase)[nth][1];
}

beforeEach(async () => {
    stop();
    exitEditMode();
    timeScaleMode.set('steps');
    await loadPreset(paper, { implementation: 'deferred', parallelism: 2 });
});

describe('StatePane', () => {
    it('shows the e-graph tables for the current snapshot', () => {
        render(StatePane);
        const classes = screen.getByRole('heading', { name: /E-Classes/ });
        expect(classes).toHaveTextContent('E-Classes 4');
        expect(screen.getByRole('heading', { name: /Hashcons/ })).toHaveTextContent('Hashcons 4');
        expect(screen.getByText('Every id is its own canonical id')).toBeInTheDocument();
    });

    it('shows the writelist, union-find and worklist while writing', async () => {
        render(StatePane);
        // Two workers apply both writelist entries at once
        goToStep(indexOfPhase('write', 0), true);
        await waitFor(() => expect(screen.getByRole('heading', { name: /Writelist/ })).toHaveTextContent('Writelist 2'));
        expect(screen.getByText('applied 2/2')).toBeInTheDocument();
        expect(screen.getByText('mul-to-shift').closest('.wl-row')).toHaveClass('current');
        expect(screen.getByText('factor-out-div').closest('.wl-row')).toHaveClass('current');
        expect(screen.getByRole('heading', { name: /Worklist/ })).toHaveTextContent('Worklist 2');
        expect(document.querySelectorAll('.uf-row').length).toBe(2);
        expect(document.querySelectorAll('.set-block.multi').length).toBe(2);
    });
});

describe('Controller', () => {
    it('steps through the timeline and narrates each step', async () => {
        render(Controller);
        const last = get(timeline)!.states.length - 1;
        expect(screen.getByText(`0 / ${last}`)).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Previous step' })).toBeDisabled();
        expect(screen.getByText(/Built the initial term/)).toBeInTheDocument();

        await fireEvent.click(screen.getByRole('button', { name: 'Next step' }));
        await waitFor(() => expect(get(currentIndex)).toBe(1));
        await waitFor(() => expect(screen.getByText(/Searching e-class/)).toBeInTheDocument());

        await fireEvent.click(screen.getByRole('button', { name: 'Next phase' }));
        await waitFor(() => expect(screen.getByText(/2 workers apply in parallel: mul-to-shift/)).toBeInTheDocument());
    });

    it('measures execution time and compares it with naive in time mode', async () => {
        render(Controller);
        await fireEvent.keyDown(window, { key: 't' });
        expect(get(timeScaleMode)).toBe('time');
        await waitFor(() => expect(screen.getByText('measuring…')).toBeInTheDocument());

        // The timeline's own benchmark gives the playhead clock and real-time playback spans...
        await waitFor(() => expect(get(executionSpans)?.length).toBe(get(timeline)!.states.length), { timeout: 5000 });
        expect(document.querySelector('.exec-clock')!.textContent).toMatch(/^0 \/ [\d.]+ (ns|µs|ms)$/);

        // ...and the comparison names the three configurations
        await waitFor(() => expect(get(executionTiming)!.compare.every(c => c.status === 'ready')).toBe(true), { timeout: 5000 });
        expect(get(executionTiming)!.compare.map(c => c.label)).toEqual(['Naive', 'Deferred ×1', 'Deferred ×2']);
        const chip = await screen.findByRole('button', { name: /(faster|slower) than naive/ });
        await fireEvent.click(chip);
        const panel = screen.getByRole('dialog', { name: 'Execution time comparison' });
        const rows = within(panel).getAllByRole('row').map(r => r.querySelector('th')!.textContent!.trim());
        expect(rows).toEqual(['Stage', 'Read', 'Write', 'Rebuild', 'Total']);
        await fireEvent.keyDown(window, { key: 'Escape' });
        expect(screen.queryByRole('dialog')).toBeNull();

        await fireEvent.click(screen.getByRole('radio', { name: 'Steps' }));
        expect(get(timeScaleMode)).toBe('steps');
        expect(document.querySelector('.exec')).toBeNull();
    });

    it('responds to keyboard shortcuts', async () => {
        render(Controller);
        await fireEvent.keyDown(window, { key: 'End' });
        expect(get(currentIndex)).toBe(get(timeline)!.states.length - 1);
        expect(screen.getByText(/Saturated/)).toBeInTheDocument();
        await fireEvent.keyDown(window, { key: 'Home' });
        expect(get(currentIndex)).toBe(0);
    });
});

describe('RewriteRulesPanel', () => {
    it('lists rules and highlights matches', async () => {
        render(RewriteRulesPanel);
        expect(screen.getByRole('heading', { name: 'Rewrite Rules (5)' })).toBeInTheDocument();
        goToStep(indexOfPhase('read-batch', 1), true);
        await waitFor(() => expect(screen.getAllByText(/1 match/).length).toBeGreaterThan(0));
    });

    it('adds rules only when the editor is saved', async () => {
        render(RewriteRulesPanel);
        await fireEvent.click(screen.getByRole('button', { name: /Add rule/ }));
        const dialog = screen.getByRole('dialog');
        expect(within(dialog).getByText('Add Rewrite Rule')).toBeInTheDocument();
        expect(get(draftPreset)!.rewrites).toHaveLength(5); // not added yet

        await fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }));
        expect(screen.queryByRole('dialog')).toBeNull();
        expect(get(draftPreset)!.rewrites).toHaveLength(5);

        await fireEvent.click(screen.getByRole('button', { name: /Add rule/ }));
        await fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Add rule' }));
        expect(get(isEditing)).toBe(true);
        expect(get(draftPreset)!.rewrites).toHaveLength(6);
    });

    it('toggles rules through the checkbox', async () => {
        render(RewriteRulesPanel);
        const boxes = screen.getAllByRole('checkbox');
        await fireEvent.click(boxes[0]);
        expect(get(draftPreset)!.rewrites[0].enabled).toBe(false);
    });
});

describe('SingleRewriteRuleEditor', () => {
    it('validates patterns and blocks saving', async () => {
        const onSave = vi.fn();
        render(SingleRewriteRuleEditor, {
            props: { rule: { name: 'r', lhs: { op: 'f', args: ['?x'] }, rhs: '?x', enabled: true }, takenNames: ['taken'] },
            // legacy createEventDispatcher events are passed through mount()'s `events` option
            events: { save: (e: CustomEvent) => onSave(e.detail) }
        } as any);

        const rhs = screen.getByLabelText(/RHS/);
        await fireEvent.input(rhs, { target: { value: 'g(?y)' } });
        expect(screen.getByText(/"\?y" in RHS not bound/)).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled();

        await fireEvent.input(rhs, { target: { value: 'g(?x)' } });
        const name = screen.getByLabelText('Name');
        await fireEvent.input(name, { target: { value: 'taken' } });
        expect(screen.getByText(/already has this name/)).toBeInTheDocument();

        await fireEvent.input(name, { target: { value: 'fine' } });
        await fireEvent.click(screen.getByRole('button', { name: 'Save' }));
        expect(onSave).toHaveBeenCalledWith({ name: 'fine', lhs: { op: 'f', args: ['?x'] }, rhs: { op: 'g', args: ['?x'] }, enabled: true });
    });
});

describe('GraphCanvas', () => {
    it('renders every e-node, e-class and edge once laid out', async () => {
        render(GraphCanvas);
        await layoutManager.whenReady(0);
        await waitFor(() => expect(document.querySelectorAll('g.enode').length).toBe(4));
        expect(document.querySelectorAll('g.eclass').length).toBe(4);
        expect(document.querySelectorAll('path.edge').length).toBe(4);

        const w = indexOfPhase('write', 0);
        goToStep(w, true);
        await layoutManager.whenReady(w);
        await waitFor(() => expect(document.querySelectorAll('g.uf-set').length).toBe(2));
        expect(document.querySelectorAll('g.enode').length).toBe(8);
    });
});
