import { writable, derived, get } from 'svelte/store';
import type { EGraphTimeline, EGraphState, PresetConfig, EngineOptions, Phase } from '../engine/types';
import { TimelineEngine } from '../engine/timeline';
import { layoutManager } from '../engine/layout';

// --- Stores ---

export const timeline = writable<EGraphTimeline | null>(null);
export const engineError = writable<string | null>(null);
export const isPlaying = writable<boolean>(false);
export const playbackSpeed = writable<number>(900); // ms per step
export const transitionMode = writable<'smooth' | 'instant'>('smooth');
export const currentPreset = writable<PresetConfig | null>(null);
/** Preset and options the current timeline was computed with. */
export const loadedConfig = writable<{ preset: PresetConfig; options: EngineOptions } | null>(null);

/**
 * Scrub bar scale: one slot per step, or each step as long as it takes to
 * execute ("time", needs a benchmark). In time mode playback runs in real
 * (scaled) time as well.
 */
export type TimeScaleMode = 'steps' | 'time';
const TIME_SCALE_KEY = 'egraph-vis-time-scale';
function initialTimeScale(): TimeScaleMode {
    try {
        return typeof localStorage !== 'undefined' && localStorage.getItem(TIME_SCALE_KEY) === 'time' ? 'time' : 'steps';
    } catch {
        return 'steps';
    }
}
export const timeScaleMode = writable<TimeScaleMode>(initialTimeScale());
timeScaleMode.subscribe(mode => {
    try {
        if (typeof localStorage !== 'undefined') localStorage.setItem(TIME_SCALE_KEY, mode);
    } catch {
        // storage unavailable
    }
});

/**
 * Measured execution time (ms) of the transition into each snapshot of the
 * current timeline (`[0]` is 0), once benchmarked.
 */
export const executionSpans = writable<number[] | null>(null);

/** Bumped whenever new layouts become available (batched to one bump per frame). */
export const layoutVersion = writable(0);

// Float-based timeline position (enables scrubbing interpolation)
export const timelinePosition = writable<number>(0);

// DERIVED: Integer index
export const currentIndex = derived(timelinePosition, $pos => Math.max(0, Math.floor($pos + 1e-9)));

// DERIVED: Current state
export const currentState = derived(
    [timeline, currentIndex],
    ([$timeline, $currentIndex]) => {
        if (!$timeline || $timeline.states.length === 0) return null;
        const index = Math.max(0, Math.min($currentIndex, $timeline.states.length - 1));
        return $timeline.states[index];
    }
);

/**
 * Step whose transition is on screen: between steps i and i+1 the graph animates
 * what step i+1 does, so text (narration, phase badge, state tables) describes
 * step i+1 as soon as the animation into it starts.
 */
export const displayIndex = derived([timeline, timelinePosition], ([$timeline, $pos]) => {
    if (!$timeline || $timeline.states.length === 0) return 0;
    return Math.max(0, Math.min(Math.ceil($pos - 1e-6), $timeline.states.length - 1));
});

export const displayState = derived([timeline, displayIndex], ([$timeline, $index]) =>
    $timeline && $timeline.states.length > 0 ? $timeline.states[$index] : null
);

export interface ScrubData {
    currentIndex: number;
    nextIndex: number;
    progress: number;
    currentState: EGraphState | null;
    nextState: EGraphState | null;
    isScrubbing: boolean;
}

// DERIVED: Scrubbing data with interpolation info
export const scrubData = derived([timeline, timelinePosition], ([$timeline, $pos]): ScrubData => {
    if (!$timeline || $timeline.states.length === 0) {
        return { currentIndex: 0, nextIndex: 0, progress: 0, currentState: null, nextState: null, isScrubbing: false };
    }
    const maxIndex = $timeline.states.length - 1;
    const clamped = Math.max(0, Math.min($pos, maxIndex));
    const index = Math.min(Math.floor(clamped + 1e-9), maxIndex);
    const progress = Math.max(0, clamped - index);
    const nextIndex = Math.min(index + 1, maxIndex);
    return {
        currentIndex: index,
        nextIndex,
        progress,
        currentState: $timeline.states[index],
        nextState: nextIndex > index ? $timeline.states[nextIndex] : null,
        isScrubbing: progress > 0.001 && nextIndex > index
    };
});

// Derived store for progress (0 to 1)
export const progress = derived([timeline, currentIndex], ([$timeline, $currentIndex]) => {
    if (!$timeline || $timeline.states.length <= 1) return 0;
    return $currentIndex / ($timeline.states.length - 1);
});

// --- Layout wiring ---

let layoutBumpScheduled = false;
layoutManager.subscribe(() => {
    if (layoutBumpScheduled) return;
    layoutBumpScheduled = true;
    const bump = () => {
        layoutBumpScheduled = false;
        layoutVersion.update(n => n + 1);
    };
    if (typeof requestAnimationFrame !== 'undefined') requestAnimationFrame(bump);
    else setTimeout(bump, 0);
});

timeline.subscribe(t => layoutManager.setTimeline(t));
currentIndex.subscribe(i => layoutManager.setFocus(i));

// --- Actions ---

let loadToken = 0;

export const DEFAULT_ENGINE_OPTIONS: EngineOptions = { implementation: 'deferred' };

/**
 * Run the engine for a preset and publish the resulting timeline.
 * Concurrent calls are safe: only the most recent load is published.
 */
export async function loadPreset(preset: PresetConfig, options: EngineOptions = DEFAULT_ENGINE_OPTIONS) {
    const token = ++loadToken;
    stop();
    cancelAnimation();
    engineError.set(null);
    currentPreset.set(preset);

    try {
        const engine = new TimelineEngine();
        engine.loadPreset(preset, options);
        const newTimeline = await engine.runUntilHalt();
        if (token !== loadToken) return;
        timelinePosition.set(0);
        executionSpans.set(null);
        loadedConfig.set({ preset, options });
        timeline.set(newTimeline);
        transitionMode.set('smooth');
    } catch (e: any) {
        if (token !== loadToken) return;
        engineError.set(e?.message ?? String(e));
        executionSpans.set(null);
        loadedConfig.set(null);
        timeline.set(null);
    }
}

export async function loadPresetById(id: string, options: EngineOptions = DEFAULT_ENGINE_OPTIONS) {
    const { getPresetById } = await import('../presets');
    const preset = getPresetById(id);
    if (preset) {
        await loadPreset(preset, options);
    }
}

// --- Position animation ---

let animationFrame: number | null = null;
let animationResolve: (() => void) | null = null;

function cancelAnimation() {
    if (animationFrame !== null && typeof cancelAnimationFrame !== 'undefined') cancelAnimationFrame(animationFrame);
    animationFrame = null;
    animationResolve?.();
    animationResolve = null;
}

const easeInOutCubic = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);

/**
 * Animate the timeline position to `target` over `duration` ms.
 * Resolves when the animation completes or is interrupted.
 */
export function animateTo(target: number, duration = 350): Promise<void> {
    cancelAnimation();
    const from = get(timelinePosition);
    if (duration <= 0 || from === target || typeof requestAnimationFrame === 'undefined') {
        timelinePosition.set(target);
        return Promise.resolve();
    }
    return new Promise(resolve => {
        animationResolve = resolve;
        const start = performance.now();
        const tick = () => {
            // Use one clock for start and now (rAF timestamps may use a different origin)
            const t = Math.max(0, Math.min(1, (performance.now() - start) / duration));
            timelinePosition.set(from + (target - from) * easeInOutCubic(t));
            if (t < 1) {
                animationFrame = requestAnimationFrame(tick);
            } else {
                animationFrame = null;
                animationResolve = null;
                resolve();
            }
        };
        animationFrame = requestAnimationFrame(tick);
    });
}

function maxIndex(): number {
    const tl = get(timeline);
    return tl ? tl.states.length - 1 : 0;
}

/**
 * Duration of the transition between two snapshots for the current speed:
 * 60% of the step time (the rest is a pause to read the result), so slow
 * speeds also slow down the animations themselves.
 */
export function stepDuration(speed = get(playbackSpeed)): number {
    return Math.min(1200, Math.max(60, speed * 0.6));
}

export function goToStep(index: number, instant = false) {
    const tl = get(timeline);
    if (!tl) return;
    transitionMode.set(instant ? 'instant' : 'smooth');
    const safeIndex = Math.max(0, Math.min(index, tl.states.length - 1));
    if (instant) {
        cancelAnimation();
        timelinePosition.set(safeIndex);
    } else {
        void animateTo(safeIndex, Math.abs(safeIndex - get(timelinePosition)) > 1.5 ? 0 : stepDuration());
    }
}

export function scrubTo(position: number) {
    const tl = get(timeline);
    if (!tl) return;
    cancelAnimation();
    transitionMode.set('instant');
    timelinePosition.set(Math.max(0, Math.min(position, tl.states.length - 1)));
}

/** Integer step the position is at (or heading to, while animating). */
function settledIndex(): number {
    return Math.round(get(timelinePosition));
}

export function nextStep() {
    const target = settledIndex() + 1;
    if (target > maxIndex()) {
        stop();
        return;
    }
    goToStep(target);
}

export function prevStep() {
    const target = settledIndex() - 1;
    if (target < 0) return;
    goToStep(target);
}

/** Index of the next snapshot whose phase differs from the current run of phases. */
export function findPhaseBoundary(states: EGraphState[], from: number, direction: 1 | -1): number {
    const phaseAt = (i: number): Phase => states[i].phase;
    let i = from;
    if (direction > 0) {
        const p = phaseAt(i);
        while (i < states.length - 1 && phaseAt(i) === p) i++;
        return i;
    }
    // Backwards: go to the start of the current run, or of the previous run if already there
    if (i > 0 && phaseAt(i - 1) !== phaseAt(i)) i--;
    const p = phaseAt(i);
    while (i > 0 && phaseAt(i - 1) === p) i--;
    return i;
}

export function nextPhase() {
    const tl = get(timeline);
    if (!tl) return;
    goToStep(findPhaseBoundary(tl.states, settledIndex(), 1), true);
}

export function prevPhase() {
    const tl = get(timeline);
    if (!tl) return;
    goToStep(findPhaseBoundary(tl.states, settledIndex(), -1), true);
}

export function togglePlay() {
    if (get(isPlaying)) {
        stop();
    } else {
        start();
    }
}

let playGeneration = 0;
/** Timer between playback steps (separate from step animations, which navigation cancels). */
let playTimer: ReturnType<typeof setTimeout> | null = null;

function start() {
    const tl = get(timeline);
    if (!tl) return;

    // If at end, restart
    if (settledIndex() >= tl.states.length - 1) {
        cancelAnimation();
        timelinePosition.set(0);
    }

    isPlaying.set(true);
    transitionMode.set('smooth');
    const generation = ++playGeneration;

    const spans = get(executionSpans);
    if (get(timeScaleMode) === 'time' && spans && spans.length === tl.states.length) {
        playRealTime(generation, spans);
        return;
    }

    const tick = async () => {
        if (generation !== playGeneration || !get(isPlaying)) return;
        const target = settledIndex() + 1;
        if (target > maxIndex()) {
            stop();
            return;
        }
        // Don't animate into a snapshot whose layout isn't ready yet
        await layoutManager.whenReady(target);
        if (generation !== playGeneration || !get(isPlaying)) return;
        const begun = performance.now();
        await animateTo(target, stepDuration());
        if (generation !== playGeneration || !get(isPlaying)) return;
        const wait = Math.max(0, get(playbackSpeed) - (performance.now() - begun));
        playTimer = setTimeout(tick, wait);
    };
    void tick();
}

/**
 * Playback rate in time mode: execution ms per playback ms. Scaled so the
 * whole run takes as long as step-by-step playback at the same speed, but
 * each step lasts in proportion to its execution time.
 */
export function realTimeRate(spans: number[], speed = get(playbackSpeed)): number {
    const steps = spans.length - 1;
    let total = 0;
    for (let i = 1; i < spans.length; i++) total += spans[i];
    return steps > 0 && total > 0 ? total / (steps * speed) : 0;
}

/** Sweep the playhead at a constant execution-time rate (no pauses between steps). */
function playRealTime(generation: number, spans: number[]) {
    const times = [0];
    for (let i = 1; i < spans.length; i++) times.push(times[i - 1] + Math.max(0, spans[i]));
    const last = spans.length - 1;
    const positionAt = (ms: number) => {
        if (ms >= times[last]) return last;
        let i = 0;
        while (i < last && times[i + 1] <= ms) i++;
        const w = times[i + 1] - times[i];
        return w > 0 ? i + (ms - times[i]) / w : i + 1;
    };
    let pos = get(timelinePosition);
    let clock = (() => {
        const i = Math.min(Math.floor(pos), last - 1);
        return times[i] + (pos - i) * (times[i + 1] - times[i]);
    })();
    let ready = Math.floor(pos);
    let prev = performance.now();
    cancelAnimation();
    // Navigating while playing interrupts the sweep: carry on from where the user went
    animationResolve = () => {
        setTimeout(() => {
            if (generation === playGeneration && get(isPlaying)) playRealTime(generation, spans);
        }, 250);
    };

    const frame = () => {
        animationFrame = null;
        if (generation !== playGeneration || !get(isPlaying)) return;
        const now = performance.now();
        clock += (now - prev) * realTimeRate(spans);
        prev = now;
        pos = positionAt(clock);
        // Don't run into a snapshot whose layout isn't ready yet
        const next = Math.min(last, Math.ceil(pos - 1e-9));
        if (next > ready) {
            if (!layoutManager.isReady(next)) {
                pos = next - 1;
                clock = times[next - 1];
                timelinePosition.set(pos);
                void layoutManager.whenReady(next).then(() => {
                    if (generation !== playGeneration) return;
                    ready = next;
                    prev = performance.now();
                    animationFrame = requestAnimationFrame(frame);
                });
                return;
            }
            ready = next;
        }
        timelinePosition.set(pos);
        if (pos >= last) {
            animationResolve = null;
            stop();
            return;
        }
        animationFrame = requestAnimationFrame(frame);
    };
    animationFrame = requestAnimationFrame(frame);
}

export function stop() {
    playGeneration++;
    isPlaying.set(false);
    if (playTimer !== null) {
        clearTimeout(playTimer);
        playTimer = null;
    }
}

export function setSpeed(ms: number) {
    playbackSpeed.set(ms);
}
