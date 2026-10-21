import { describe, it, expect, beforeEach } from 'vitest';
import { get } from 'svelte/store';
import {
    timeline,
    timelinePosition,
    currentIndex,
    currentState,
    scrubData,
    engineError,
    currentPreset,
    isPlaying,
    loadPreset,
    goToStep,
    scrubTo,
    nextStep,
    prevStep,
    nextPhase,
    prevPhase,
    togglePlay,
    stop,
    setSpeed,
    findPhaseBoundary,
} from './timelineStore';
import { PRESETS } from '../presets';
import { preset } from '../test/helpers';
import type { EGraphState } from '../engine/types';

const paper = PRESETS.find(p => p.id === 'paper-example')!;
const simple = PRESETS.find(p => p.id === 'simple-add')!;

describe('timelineStore', () => {
    beforeEach(async () => {
        stop();
        await loadPreset(paper, { implementation: 'deferred', parallelism: 2 });
    });

    it('publishes a timeline and resets the position', async () => {
        const tl = get(timeline)!;
        expect(tl.presetId).toBe('paper-example');
        expect(get(timelinePosition)).toBe(0);
        expect(get(currentState)!.phase).toBe('init');
        expect(get(currentPreset)!.id).toBe('paper-example');
        goToStep(5, true);
        await loadPreset(simple);
        expect(get(timelinePosition)).toBe(0);
    });

    it('only publishes the most recent of concurrent loads', async () => {
        const first = loadPreset(simple);
        const second = loadPreset(paper, { implementation: 'naive' });
        await Promise.all([first, second]);
        expect(get(timeline)!.presetId).toBe('paper-example');
        expect(get(timeline)!.implementation).toBe('naive');
    });

    it('reports engine errors instead of throwing', async () => {
        await loadPreset(preset({ op: 'f', args: [42] }));
        expect(get(engineError)).toMatch(/Unknown ENodeId/);
        expect(get(timeline)).toBeNull();
        await loadPreset(paper);
        expect(get(engineError)).toBeNull();
    });

    it('clamps navigation to the timeline', () => {
        const last = get(timeline)!.states.length - 1;
        goToStep(-3, true);
        expect(get(currentIndex)).toBe(0);
        goToStep(10_000, true);
        expect(get(currentIndex)).toBe(last);
        scrubTo(-1);
        expect(get(timelinePosition)).toBe(0);
        scrubTo(1e9);
        expect(get(timelinePosition)).toBe(last);
    });

    it('steps forward and backward', () => {
        nextStep();
        expect(get(currentIndex)).toBe(1);
        nextStep();
        expect(get(currentIndex)).toBe(2);
        prevStep();
        expect(get(currentIndex)).toBe(1);
        prevStep();
        prevStep(); // no-op at the start
        expect(get(currentIndex)).toBe(0);
    });

    it('derives interpolation data while scrubbing', () => {
        scrubTo(2.25);
        const s = get(scrubData);
        expect(s.currentIndex).toBe(2);
        expect(s.nextIndex).toBe(3);
        expect(s.progress).toBeCloseTo(0.25);
        expect(s.isScrubbing).toBe(true);
        expect(s.currentState!.stepIndex).toBe(2);
        expect(s.nextState!.stepIndex).toBe(3);
        const last = get(timeline)!.states.length - 1;
        scrubTo(last);
        expect(get(scrubData).nextState).toBeNull();
        expect(get(scrubData).isScrubbing).toBe(false);
    });

    it('jumps between phase boundaries', () => {
        const states = get(timeline)!.states;
        nextPhase(); // init -> first read batch
        expect(get(currentState)!.phase).toBe('read-batch');
        nextPhase(); // -> first write
        expect(get(currentState)!.phase).toBe('write');
        expect(states[get(currentIndex) - 1].phase).toBe('read-batch');
        prevPhase(); // back to the start of the read batches
        expect(get(currentIndex)).toBe(1);
    });

    it('plays through the timeline and stops at the end', async () => {
        setSpeed(5);
        goToStep(get(timeline)!.states.length - 3, true);
        togglePlay();
        expect(get(isPlaying)).toBe(true);
        const last = get(timeline)!.states.length - 1;
        for (let i = 0; i < 200 && get(isPlaying); i++) await new Promise(r => setTimeout(r, 10));
        expect(get(isPlaying)).toBe(false);
        expect(get(currentIndex)).toBe(last);
        setSpeed(900);
    });

    it('keeps playing after manual navigation', async () => {
        // Regression: navigation cancelled the playback timer but left isPlaying = true
        setSpeed(20);
        togglePlay();
        await new Promise(r => setTimeout(r, 30));
        nextStep();
        const at = get(currentIndex);
        await new Promise(r => setTimeout(r, 150));
        expect(get(isPlaying)).toBe(true);
        expect(get(currentIndex)).toBeGreaterThan(at);
        stop();
        setSpeed(900);
    });

    it('can be paused', () => {
        togglePlay();
        expect(get(isPlaying)).toBe(true);
        togglePlay();
        expect(get(isPlaying)).toBe(false);
    });
});

describe('findPhaseBoundary', () => {
    const states = ['init', 'read-batch', 'read-batch', 'write', 'write', 'compact', 'repair', 'done']
        .map(phase => ({ phase }) as EGraphState);

    it('moves forward to the next run of phases', () => {
        expect(findPhaseBoundary(states, 0, 1)).toBe(1);
        expect(findPhaseBoundary(states, 1, 1)).toBe(3);
        expect(findPhaseBoundary(states, 2, 1)).toBe(3);
        expect(findPhaseBoundary(states, 7, 1)).toBe(7);
    });

    it('moves backward to the start of the current or previous run', () => {
        expect(findPhaseBoundary(states, 4, -1)).toBe(3);
        expect(findPhaseBoundary(states, 3, -1)).toBe(1);
        expect(findPhaseBoundary(states, 1, -1)).toBe(0);
        expect(findPhaseBoundary(states, 0, -1)).toBe(0);
    });
});
