/**
 * Execution-time measurements for the timeline shown, plus the same preset
 * under the other implementations (naive, deferred with 1 and with P workers)
 * for comparison. All of them are benchmarked together (interleaved runs) so
 * their times are comparable. Benchmarks only run while the scrub bar is in
 * time mode.
 */
import { writable, get } from 'svelte/store';
import { runBenchmarks } from '../engine/benchmarkClient';
import { transitionSpans, type Benchmark } from '../engine/benchmark';
import type { EngineOptions, PresetConfig } from '../engine/types';
import { timeline, loadedConfig, timeScaleMode, executionSpans } from './timelineStore';

export interface BenchSlot {
    label: string;
    options: EngineOptions;
    status: 'running' | 'ready' | 'error';
    result?: Benchmark;
    error?: string;
}

export interface ExecutionTiming {
    /** The timeline shown. */
    current: BenchSlot;
    /** Naive, deferred ×1 and deferred ×P (P > 1 only), in that order. The current one is among them. */
    compare: BenchSlot[];
    /** Index of the current configuration in `compare`. */
    currentIndex: number;
    parallelism: number;
}

export const executionTiming = writable<ExecutionTiming | null>(null);

/** Measurement budget (ms) for the timeline shown and its comparisons together. */
export const BUDGET_MS = 900;

const CACHE_LIMIT = 24;
const cache = new Map<string, Promise<Benchmark[]>>();

function normalize(options: EngineOptions): EngineOptions {
    const deferred = options.implementation === 'deferred';
    return {
        ...options,
        implementation: options.implementation,
        parallelism: deferred ? Math.max(1, Math.floor(options.parallelism ?? 1)) : 1
    };
}

function configKey(preset: PresetConfig, options: EngineOptions): string {
    const o = normalize(options);
    return JSON.stringify([preset.root, preset.rewrites, o.implementation, o.parallelism, o.iterationCap, o.maxNodes, o.maxSteps, o.seed]);
}

export function labelOf(options: EngineOptions): string {
    const o = normalize(options);
    return o.implementation === 'naive' ? 'Naive' : `Deferred ×${o.parallelism}`;
}

function measure(preset: PresetConfig, configs: EngineOptions[]): Promise<Benchmark[]> {
    const key = JSON.stringify(configs.map(c => configKey(preset, c)));
    let job = cache.get(key);
    if (!job) {
        job = runBenchmarks(preset, configs.map(normalize), { budgetMs: BUDGET_MS });
        job.catch(() => cache.delete(key));
        cache.set(key, job);
        while (cache.size > CACHE_LIMIT) cache.delete(cache.keys().next().value!);
    }
    return job;
}

/** The configurations to compare for a timeline computed with `options`. */
export function comparisonConfigs(options: EngineOptions, parallelism: number): EngineOptions[] {
    const base = { ...options };
    const configs: EngineOptions[] = [
        { ...base, implementation: 'naive', parallelism: 1 },
        { ...base, implementation: 'deferred', parallelism: 1 }
    ];
    if (parallelism > 1) configs.push({ ...base, implementation: 'deferred', parallelism });
    return configs;
}

let generation = 0;
let shownKey: string | null = null;
let debounce: ReturnType<typeof setTimeout> | undefined;

/** Benchmark the timeline shown (and its comparisons) if not done already. */
function refresh() {
    const config = get(loadedConfig);
    const tl = get(timeline);
    if (get(timeScaleMode) !== 'time' || !config || !tl) return;
    const key = configKey(config.preset, config.options);
    if (key === shownKey) return;
    shownKey = key;
    const gen = ++generation;

    const { preset, options } = config;
    const current = normalize(options);
    // Workers to compare with: the ones selected (also remembered in naive mode)
    const parallelism = Math.max(1, Math.floor(options.parallelism ?? 1));
    const configs = comparisonConfigs(options, parallelism);
    const currentKey = configKey(preset, current);
    const currentIndex = Math.max(0, configs.findIndex(c => configKey(preset, c) === currentKey));
    const slot = (o: EngineOptions): BenchSlot => ({ label: labelOf(o), options: normalize(o), status: 'running' });

    const state: ExecutionTiming = {
        current: slot(current),
        compare: configs.map(slot),
        currentIndex,
        parallelism
    };
    executionTiming.set(state);

    const phases = tl.states.map(s => s.phase);
    void (async () => {
        try {
            const results = await measure(preset, configs);
            if (gen !== generation) return;
            const mine = results[currentIndex];
            const aligned = mine.phases.length === phases.length && mine.phases.every((p, i) => p === phases[i]);
            if (!aligned) throw new Error('The benchmark does not match the timeline');
            const compare = state.compare.map((slot, i): BenchSlot => ({ ...slot, status: 'ready', result: results[i] }));
            executionTiming.set({ ...state, current: compare[currentIndex], compare });
            executionSpans.set(transitionSpans(mine));
        } catch (e) {
            if (gen !== generation) return;
            const failed = (slot: BenchSlot): BenchSlot => ({ ...slot, status: 'error', error: (e as Error).message });
            executionTiming.set({ ...state, current: failed(state.current), compare: state.compare.map(failed) });
        }
    })();
}

function schedule() {
    clearTimeout(debounce);
    // A new timeline invalidates what is shown right away; measuring waits for edits to settle
    const config = get(loadedConfig);
    if (!config || configKey(config.preset, config.options) !== shownKey) {
        shownKey = null;
        generation++;
        executionTiming.set(null);
    } else {
        // Same configuration re-run: its measurements still apply
        const result = get(executionTiming)?.current.result;
        if (result && result.phases.length === get(timeline)?.states.length) executionSpans.set(transitionSpans(result));
    }
    debounce = setTimeout(refresh, 200);
}

timeline.subscribe(schedule);
timeScaleMode.subscribe(schedule);

/** For tests: forget cached measurements. */
export function clearBenchmarkCache() {
    cache.clear();
    shownKey = null;
}
