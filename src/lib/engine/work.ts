/**
 * Work accounting: how long each piece of the algorithm takes.
 *
 * The engine times every task a worker performs (searching one e-class for
 * all rules, applying one writelist entry, one compaction or repair step) and
 * groups the tasks into segments. The segments recorded between two snapshots
 * are the work that produced the second snapshot, i.e. the work animated by the
 * transition into it.
 */
import type { Phase } from './types';

/** Stages of equality saturation, for timing. */
export type WorkKind = 'init' | 'read' | 'write' | 'compact' | 'repair';

/**
 * A stretch of work. Sequential work has one lane. Parallel work runs in
 * lock-step on `workers` workers: `lanes[w]` is the time (ms) worker w was
 * busy, and the segment lasts until the slowest one is done.
 */
export interface WorkSegment {
    kind: WorkKind;
    lanes: number[];
    workers: number;
}

/** Wall-clock duration of a segment (the slowest lane). */
export function segmentSpan(segment: WorkSegment): number {
    let max = 0;
    for (const d of segment.lanes) if (d > max) max = d;
    return max;
}

/** Total busy time of all lanes (CPU time). */
export function segmentWork(segment: WorkSegment): number {
    let sum = 0;
    for (const d of segment.lanes) sum += d;
    return sum;
}

export function stepSpan(segments: WorkSegment[]): number {
    let sum = 0;
    for (const s of segments) sum += segmentSpan(s);
    return sum;
}

/** The kind of work a snapshot phase does. */
export function workKindOf(phase: Phase): WorkKind | null {
    switch (phase) {
        case 'init': return 'init';
        case 'read':
        case 'read-batch': return 'read';
        case 'write': return 'write';
        case 'compact': return 'compact';
        case 'repair': return 'repair';
        case 'done': return null;
    }
}

export type Clock = () => number;

export const defaultClock: Clock = () => performance.now();

/**
 * Average cost of timing nothing (`t0 = clock(); clock() - t0`). Reading the
 * clock takes ~0.1 µs in browsers, as long as a small task, so every timed
 * region is corrected by it. Individual corrected samples can be negative on
 * a coarse clock; their mean is still unbiased.
 */
export function clockOverhead(clock: Clock = defaultClock, samples = 20000): number {
    let sum = 0;
    for (let i = 0; i < samples; i++) {
        const t0 = clock();
        sum += clock() - t0;
    }
    return sum / samples;
}

/** Collects timed work and hands it out one snapshot at a time. */
export class WorkLog {
    private pending: WorkSegment[] = [];
    readonly steps: WorkSegment[][] = [];

    /** `overhead`: cost of an empty timed region, subtracted from every measurement. */
    constructor(readonly clock: Clock = defaultClock, readonly overhead = 0) {}

    /** Time since `t0` (a reading of `clock`), corrected for the cost of reading the clock. */
    since(t0: number): number {
        return this.clock() - t0 - this.overhead;
    }

    /** Run `fn` and record its duration as sequential work. */
    time<T>(kind: WorkKind, fn: () => T): T {
        const t0 = this.clock();
        const out = fn();
        this.sequential(kind, this.since(t0));
        return out;
    }

    sequential(kind: WorkKind, ms: number) {
        const last = this.pending[this.pending.length - 1];
        if (last && last.kind === kind && last.workers === 1) last.lanes[0] += ms;
        else this.pending.push({ kind, lanes: [ms], workers: 1 });
    }

    /** One lock-step round on `workers` workers (`lanes` may be shorter when some are idle). */
    parallel(kind: WorkKind, lanes: number[], workers: number) {
        if (lanes.length === 0) return;
        if (workers <= 1) this.sequential(kind, lanes.reduce((a, b) => a + b, 0));
        else this.pending.push({ kind, lanes, workers });
    }

    /** Add work to the step that was closed last (bookkeeping that finishes it off). */
    amend(kind: WorkKind, ms: number) {
        const step = this.steps[this.steps.length - 1];
        if (!step || this.pending.length > 0) return this.sequential(kind, ms);
        const last = step[step.length - 1];
        if (last && last.kind === kind && last.workers === 1) last.lanes[0] += ms;
        else step.push({ kind, lanes: [ms], workers: 1 });
    }

    /** Close the current step: everything recorded since the last call belongs to it. */
    flush(): WorkSegment[] {
        const segments = this.pending;
        this.pending = [];
        this.steps.push(segments);
        return segments;
    }
}
