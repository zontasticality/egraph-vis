/**
 * Ground-truth timing of the engine.
 *
 * The algorithm is replayed many times without recording snapshots, and every
 * task is timed in every run (see {@link WorkLog}). Runs are deterministic, so
 * task k of one run is task k of every other run: per-task samples line up and
 * can be averaged. The result has the same shape as the work log, with each
 * lane holding the estimated duration of that task.
 *
 * Reading the clock costs about as much as a small task (~0.1 µs), so that
 * cost is measured first and subtracted from every timed task.
 *
 * Estimator: browser clocks are coarse (5 µs to 100 µs, jittered) while
 * tasks often take a few µs, so a single sample is mostly 0 or one tick. The
 * mean over many runs is still unbiased; it is used for tasks the clock cannot
 * resolve. Tasks lasting several ticks use the interquartile mean instead, which
 * ignores the occasional garbage collection pause. Runs much slower than the
 * typical run (a pause landed in them) are dropped first.
 */
import { TimelineEngine } from './timeline';
import { defaultClock, clockOverhead, type Clock, type WorkKind, type WorkSegment } from './work';
import { segmentSpan, stepSpan } from './work';
import type { EngineOptions, Phase, PresetConfig } from './types';

export interface Benchmark {
    /** `steps[i]`: estimated work that produced snapshot i (ms per lane). */
    steps: WorkSegment[][];
    /** Phase of every snapshot, to check that the benchmark matches a timeline. */
    phases: Phase[];
    /** Measured runs used for the estimate. */
    runs: number;
    /** Smallest clock increment observed (ms). */
    resolution: number;
    /** Cost of reading the clock (ms), subtracted from every task. */
    overhead: number;
    implementation: EngineOptions['implementation'];
    parallelism: number;
}

export interface BenchmarkOptions {
    /** Keep measuring until this much time was spent (ms)... */
    budgetMs?: number;
    /** ...and at least this many runs were measured. */
    minRuns?: number;
    maxRuns?: number;
    /** Untimed runs first, so the code is optimized by the JIT. */
    warmupMs?: number;
    clock?: Clock;
    /**
     * Subtract the cost of reading the clock from every timed task (default:
     * only for the real clock, whose overhead is measured first).
     */
    calibrate?: boolean;
}

/** Smallest positive difference between two clock readings. */
export function clockResolution(clock: Clock = defaultClock, samples = 5): number {
    let best = Infinity;
    for (let s = 0; s < samples; s++) {
        const t0 = clock();
        let t1 = t0;
        for (let i = 0; i < 1e6 && t1 === t0; i++) t1 = clock();
        if (t1 > t0) best = Math.min(best, t1 - t0);
    }
    return Number.isFinite(best) ? best : 0;
}

/** Robust estimate of one task's duration from its samples. */
export function estimateDuration(samples: Float64Array | number[], resolution: number): number {
    const n = samples.length;
    if (n === 0) return 0;
    const sorted = Array.from(samples).sort((a, b) => a - b);
    const q1 = sorted[Math.floor(n * 0.25)];
    if (n >= 8 && q1 >= 3 * resolution) {
        // Well resolved: interquartile mean
        const lo = Math.floor(n * 0.25), hi = Math.ceil(n * 0.75);
        let sum = 0;
        for (let i = lo; i < hi; i++) sum += sorted[i];
        return sum / (hi - lo);
    }
    let sum = 0;
    for (const v of sorted) sum += v;
    return sum / n;
}

interface RunRecord {
    phases: Phase[];
    steps: WorkSegment[][];
}

function runOnce(preset: PresetConfig, options: EngineOptions, clock: Clock, overhead: number): RunRecord {
    const engine = new TimelineEngine({ snapshots: false, clock, clockOverhead: overhead });
    engine.loadPreset(preset, options);
    engine.run();
    return { phases: engine.getPhases(), steps: engine.getWork() };
}

/** Flatten every lane of every segment, in order. */
function flatten(steps: WorkSegment[][]): number[] {
    const out: number[] = [];
    for (const step of steps) for (const seg of step) for (const d of seg.lanes) out.push(d);
    return out;
}

/** Same steps, segments, kinds and lane counts. */
function sameShape(a: WorkSegment[][], b: WorkSegment[][]): boolean {
    if (a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) {
        if (a[i].length !== b[i].length) return false;
        for (let j = 0; j < a[i].length; j++) {
            const x = a[i][j], y = b[i][j];
            if (x.kind !== y.kind || x.workers !== y.workers || x.lanes.length !== y.lanes.length) return false;
        }
    }
    return true;
}

export function benchmark(preset: PresetConfig, options: EngineOptions, opts: BenchmarkOptions = {}): Benchmark {
    return benchmarkAll(preset, [options], opts)[0];
}

/**
 * Benchmark several configurations of one preset together. Their runs are
 * interleaved (one run of each per round), so whatever else the machine is
 * doing meanwhile slows all of them alike and their times stay comparable.
 * `budgetMs` is for all of them; `minRuns`/`maxRuns` are per configuration.
 */
export function benchmarkAll(preset: PresetConfig, configs: EngineOptions[], opts: BenchmarkOptions = {}): Benchmark[] {
    const clock = opts.clock ?? defaultClock;
    const budgetMs = opts.budgetMs ?? 300;
    const minRuns = opts.minRuns ?? 5;
    const maxRuns = Math.max(minRuns, opts.maxRuns ?? 4000);
    const warmupMs = opts.warmupMs ?? 25;
    const resolution = clockResolution(clock);
    const overhead = (opts.calibrate ?? !opts.clock) ? clockOverhead(clock) : 0;

    // Warm up (and learn the shape of the work)
    const references = configs.map(options => runOnce(preset, options, clock, overhead));
    const warmStart = clock();
    for (let i = 0; i < 50 && clock() - warmStart < warmupMs; i++) {
        for (const options of configs) runOnce(preset, options, clock, overhead);
    }

    const samples: Float64Array[][] = configs.map(() => []);
    const totals: number[][] = configs.map(() => []);
    const start = clock();
    let rounds = 0;
    while (rounds < maxRuns && (rounds < minRuns || clock() - start < budgetMs)) {
        configs.forEach((options, c) => {
            const t0 = clock();
            const rec = runOnce(preset, options, clock, overhead);
            totals[c].push(clock() - t0);
            if (!sameShape(rec.steps, references[c].steps)) {
                throw new Error('Benchmark runs differ: the engine is not deterministic for this preset');
            }
            samples[c].push(Float64Array.from(flatten(rec.steps)));
        });
        rounds++;
    }

    return configs.map((options, c) => {
        // Drop runs a pause landed in
        const sortedTotals = totals[c].slice().sort((a, b) => a - b);
        const median = sortedTotals[Math.floor(sortedTotals.length / 2)];
        const limit = median * 1.5 + 3 * resolution;
        let kept = samples[c].filter((_, i) => totals[c][i] <= limit);
        if (kept.length < Math.max(1, Math.floor(samples[c].length / 2))) kept = samples[c];

        // Per-task estimates, written back into the reference shape
        const taskCount = kept[0]?.length ?? 0;
        const column = new Float64Array(kept.length);
        const estimates = new Float64Array(taskCount);
        for (let k = 0; k < taskCount; k++) {
            for (let r = 0; r < kept.length; r++) column[r] = kept[r][k];
            estimates[k] = Math.max(0, estimateDuration(column, resolution));
        }
        let k = 0;
        const steps = references[c].steps.map(step =>
            step.map(seg => ({ kind: seg.kind, workers: seg.workers, lanes: seg.lanes.map(() => estimates[k++]) }))
        );

        return {
            steps,
            phases: references[c].phases,
            runs: kept.length,
            resolution,
            overhead,
            implementation: options.implementation,
            parallelism: options.implementation === 'deferred' ? Math.max(1, Math.floor(options.parallelism ?? 1)) : 1
        };
    });
}

/** Wall-clock time per stage (parallel work counts its slowest worker). */
export interface StageTotals {
    read: number;
    write: number;
    /** compact + repair */
    rebuild: number;
    total: number;
}

export const STAGES = ['read', 'write', 'rebuild'] as const;
export type Stage = (typeof STAGES)[number];

export function stageOf(kind: WorkKind): Stage | null {
    if (kind === 'read' || kind === 'write') return kind;
    if (kind === 'compact' || kind === 'repair') return 'rebuild';
    return null;
}

/** Stage totals of a benchmark; building the initial term is not part of any stage. */
export function stageTotals(b: Pick<Benchmark, 'steps'>): StageTotals {
    const out: StageTotals = { read: 0, write: 0, rebuild: 0, total: 0 };
    for (const step of b.steps) {
        for (const seg of step) {
            const stage = stageOf(seg.kind);
            if (!stage) continue;
            const span = segmentSpan(seg);
            out[stage] += span;
            out.total += span;
        }
    }
    return out;
}

/** Wall-clock time of the transition into each snapshot (`[0]` is 0: nothing animates into the first one). */
export function transitionSpans(b: Pick<Benchmark, 'steps'>): number[] {
    return b.steps.map((step, i) => (i === 0 ? 0 : stepSpan(step)));
}
