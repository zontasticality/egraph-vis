import { writable, derived, get } from 'svelte/store';
import type { EGraphTimeline, EGraphState, PresetConfig, EngineOptions } from '../engine/types';
import { TimelineEngine } from '../engine/timeline';

// --- Stores ---

export const timeline = writable<EGraphTimeline | null>(null);
export const currentIndex = writable<number>(0);
export const isPlaying = writable<boolean>(false);
export const playbackSpeed = writable<number>(1000); // ms per step

// Derived store for the current state
export const currentState = derived(
    [timeline, currentIndex],
    ([$timeline, $currentIndex]) => {
        if (!$timeline || $timeline.states.length === 0) return null;
        // Clamp index to be safe
        const index = Math.max(0, Math.min($currentIndex, $timeline.states.length - 1));
        return $timeline.states[index];
    }
);

// Derived store for progress (0 to 1)
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

export function loadPreset(preset: PresetConfig, options: EngineOptions = { implementation: 'naive', iterationCap: 10 }) {
    stop();
    engine = new TimelineEngine();
    engine.loadPreset(preset, options);
    const newTimeline = engine.runUntilHalt();

    timeline.set(newTimeline);
    currentIndex.set(0);
}

export function goToStep(index: number) {
    const tl = get(timeline);
    if (!tl) return;
    const safeIndex = Math.max(0, Math.min(index, tl.states.length - 1));
    currentIndex.set(safeIndex);
}

export function nextStep() {
    const tl = get(timeline);
    if (!tl) return;
    const current = get(currentIndex);
    if (current < tl.states.length - 1) {
        currentIndex.set(current + 1);
    } else {
        stop(); // Stop if reached end
    }
}

export function prevStep() {
    const current = get(currentIndex);
    if (current > 0) {
        currentIndex.set(current - 1);
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
    if (get(currentIndex) >= tl.states.length - 1) {
        currentIndex.set(0);
    }

    isPlaying.set(true);
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
