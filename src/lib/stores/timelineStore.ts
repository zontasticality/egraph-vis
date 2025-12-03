import { writable, derived, get } from 'svelte/store';
import type { EGraphTimeline, EGraphState, PresetConfig, EngineOptions } from '../engine/types';
import { TimelineEngine } from '../engine/timeline';
import { layoutManager } from '../engine/layout';

// --- Stores ---

export const timeline = writable<EGraphTimeline | null>(null);

// Subscribe to layout updates to force store refresh
layoutManager.subscribe(() => {
    timeline.update(t => t ? { ...t } : null);
});
export const isPlaying = writable<boolean>(false);
export const playbackSpeed = writable<number>(1000); // ms per step
export const transitionMode = writable<'smooth' | 'instant'>('smooth');
export const currentPreset = writable<PresetConfig | null>(null);

// NEW: Float-based timeline position (enables scrubbing interpolation)
export const timelinePosition = writable<number>(0);

// DERIVED: Integer index (backward compatible)
export const currentIndex = derived(timelinePosition, $pos => Math.floor($pos));

// DERIVED: Current state (backward compatible)
export const currentState = derived(
    [timeline, currentIndex],
    ([$timeline, $currentIndex]) => {
        if (!$timeline || $timeline.states.length === 0) return null;
        // Clamp index to be safe
        const index = Math.max(0, Math.min($currentIndex, $timeline.states.length - 1));
        return $timeline.states[index];
    }
);

// DERIVED: Scrubbing data with interpolation info
export const scrubData = derived(
    [timeline, timelinePosition],
    ([$timeline, $pos]) => {
        if (!$timeline || $timeline.states.length === 0) {
            return {
                currentIndex: 0,
                nextIndex: 0,
                progress: 0,
                currentState: null,
                nextState: null,
                isScrubbing: false
            };
        }

        const index = Math.floor($pos);
        const progress = $pos % 1;
        const maxIndex = $timeline.states.length - 1;
        const clampedIndex = Math.max(0, Math.min(index, maxIndex));
        const nextIndex = Math.min(clampedIndex + 1, maxIndex);

        // Consider "scrubbing" if progress is meaningfully between snapshots
        const isScrubbing = progress > 0.01 && progress < 0.99 && nextIndex > clampedIndex;

        return {
            currentIndex: clampedIndex,
            nextIndex,
            progress,
            currentState: $timeline.states[clampedIndex],
            nextState: nextIndex > clampedIndex ? $timeline.states[nextIndex] : null,
            isScrubbing
        };
    }
);

// Derived store for progress (0 to 1) - backward compatible
export const progress = derived(
    [timeline, currentIndex],
    ([$timeline, $currentIndex]) => {
        if (!$timeline || $timeline.states.length <= 1) return 0;
        return $currentIndex / ($timeline.states.length - 1);
    }
);

// --- Actions ---

let engine: TimelineEngine | null = null;
let playInterval: any = null;

export async function loadPreset(preset: PresetConfig, options: EngineOptions = { implementation: 'deferred', iterationCap: 100 }) {
    stop();
    currentPreset.set(preset);
    engine = new TimelineEngine();
    engine.loadPreset(preset, options);
    const newTimeline = await engine.runUntilHalt();

    timeline.set(newTimeline);
    timelinePosition.set(0);  // Use float position
    transitionMode.set('smooth');
}

export async function loadPresetById(id: string, options: EngineOptions = { implementation: 'deferred', iterationCap: 100 }) {
    const { getPresetById } = await import('../presets');
    const preset = getPresetById(id);
    if (preset) {
        await loadPreset(preset, options);
    }
}

export function goToStep(index: number, instant = false) {
    const tl = get(timeline);
    if (!tl) return;

    if (instant) {
        transitionMode.set('instant');
    } else {
        transitionMode.set('smooth');
    }

    const safeIndex = Math.max(0, Math.min(index, tl.states.length - 1));
    timelinePosition.set(safeIndex);  // Use float position (integer value)
}

export function scrubTo(position: number) {
    // Scrubbing to fractional position (enables interpolation)
    const tl = get(timeline);
    if (!tl) return;

    const max = tl.states.length - 1;
    const safePos = Math.max(0, Math.min(position, max));
    timelinePosition.set(safePos);
}

export function nextStep() {
    transitionMode.set('smooth');
    const tl = get(timeline);
    if (!tl) return;
    const current = get(timelinePosition);
    if (Math.floor(current) < tl.states.length - 1) {
        timelinePosition.set(Math.floor(current) + 1);
    } else {
        stop(); // Stop if reached end
    }
}

export function prevStep() {
    transitionMode.set('smooth');
    const current = get(timelinePosition);
    if (Math.floor(current) > 0) {
        timelinePosition.set(Math.floor(current) - 1);
    }
}

export function togglePlay() {
    const playing = get(isPlaying);
    if (playing) {
        stop();
    } else {
        start();
    }
}

function start() {
    const tl = get(timeline);
    if (!tl) return;

    // If at end, restart
    if (Math.floor(get(timelinePosition)) >= tl.states.length - 1) {
        timelinePosition.set(0);
    }

    isPlaying.set(true);
    transitionMode.set('smooth');
    const speed = get(playbackSpeed);

    playInterval = setInterval(() => {
        nextStep();
    }, speed);
}

function stop() {
    isPlaying.set(false);
    if (playInterval) {
        clearInterval(playInterval);
        playInterval = null;
    }
}

export function setSpeed(ms: number) {
    playbackSpeed.set(ms);
    // If playing, restart interval with new speed
    if (get(isPlaying)) {
        stop();
        start();
    }
}
