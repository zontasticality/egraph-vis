import type { EGraphState, Implementation, Phase } from '../engine/types';
import { PHASE_COLORS } from '../engine/visualStyles';
import { segmentSpan, segmentWork, stepSpan, type WorkKind, type WorkSegment } from '../engine/work';

/**
 * Model of the timeline scrub bar.
 *
 * Positions are in step units (0 … states.length - 1). The stretch between
 * step i-1 and step i is the animation of what step i does, so it is drawn in
 * step i's phase color: the bar under the playhead always matches what the
 * graph is animating.
 */

/** A run of consecutive transitions into snapshots of the same phase. */
export interface TrackRun {
    from: number;
    to: number;
    phase: Phase;
    color: string;
}

export interface TrackModel {
    runs: TrackRun[];
    /** Positions where the phase changes (start of one run, end of the previous). */
    phaseTicks: number[];
    /** Positions where a new equality saturation iteration starts. */
    iterationTicks: Array<{ at: number; iteration: number }>;
    /** Number of transitions (states.length - 1). */
    steps: number;
}

export function buildTrackModel(states: Pick<EGraphState, 'phase' | 'metadata'>[]): TrackModel {
    const runs: TrackRun[] = [];
    const phaseTicks: number[] = [];
    const iterationTicks: TrackModel['iterationTicks'] = [];

    for (let i = 1; i < states.length; i++) {
        const phase = states[i].phase;
        const last = runs[runs.length - 1];
        if (last && last.phase === phase) {
            last.to = i;
        } else {
            if (last) phaseTicks.push(i - 1);
            runs.push({ from: i - 1, to: i, phase, color: PHASE_COLORS[phase] });
        }
        const iteration = states[i].metadata.iteration;
        if (iteration !== states[i - 1].metadata.iteration && states[i].phase !== 'done') {
            iterationTicks.push({ at: i - 1, iteration });
        }
    }

    return { runs, phaseTicks, iterationTicks, steps: Math.max(0, states.length - 1) };
}

/** Minimum on-screen width of one step for per-step separators to be drawn. */
export const MIN_STEP_PX = 5;
/** Minimum spacing between two iteration labels. */
export const MIN_LABEL_PX = 18;

/** Iteration ticks whose labels fit without overlapping (the rest keep their tick only). */
export function labeledIterations(model: TrackModel, pxPerStep: number): Set<number> {
    const out = new Set<number>();
    let lastX = -Infinity;
    for (const tick of model.iterationTicks) {
        const x = tick.at * pxPerStep;
        if (x - lastX >= MIN_LABEL_PX) {
            out.add(tick.at);
            lastX = x;
        }
    }
    return out;
}

/** Step whose transition contains `position` (the step being animated), for hover hints. */
export function stepAt(position: number, steps: number): number {
    if (steps <= 0) return 0;
    return Math.min(steps, Math.max(1, Math.ceil(position - 1e-6)));
}

// ─── Time scale ──────────────────────────────────────────────────────────

/**
 * Maps timeline positions to the bar. With `bias` 0 every step is equally
 * wide; with `bias` 1 each step is as wide as its measured execution time
 * (in between, the two blend, so switching modes can be animated).
 */
export interface TimeScale {
    /** Fraction of the bar (0…1) at each state. */
    xs: number[];
    /** Execution time (ms) at each state, if timing is known. */
    times: number[] | null;
    /** Total execution time (ms), 0 without timing. */
    total: number;
    toX(position: number): number;
    toPosition(x: number): number;
    /** Execution time (ms) at a position (0 without timing). */
    timeAt(position: number): number;
    positionAtTime(ms: number): number;
}

function cumulative(values: number[]): number[] {
    const out = [0];
    for (let i = 1; i < values.length; i++) out.push(out[i - 1] + values[i]);
    return out;
}

/** Linear interpolation inside the piecewise-linear map position → `ys`. */
function at(ys: number[], position: number): number {
    const n = ys.length - 1;
    if (n <= 0) return 0;
    const p = Math.min(Math.max(position, 0), n);
    const i = Math.min(Math.floor(p), n - 1);
    return ys[i] + (p - i) * (ys[i + 1] - ys[i]);
}

/** Inverse of {@link at} for non-decreasing `ys` (flat stretches map to their end). */
function inverse(ys: number[], y: number): number {
    const n = ys.length - 1;
    if (n <= 0) return 0;
    if (y <= ys[0]) return 0;
    if (y >= ys[n]) return n;
    let lo = 0, hi = n; // last index with ys[i] <= y
    while (lo < hi) {
        const mid = Math.ceil((lo + hi) / 2);
        if (ys[mid] <= y) lo = mid;
        else hi = mid - 1;
    }
    if (lo >= n) return n;
    const w = ys[lo + 1] - ys[lo];
    return w > 0 ? lo + (y - ys[lo]) / w : lo;
}

/** `spans[i]`: execution time of the transition into state i (`spans[0]` is ignored). */
export function buildTimeScale(stateCount: number, spans: number[] | null, bias: number): TimeScale {
    const n = Math.max(0, stateCount - 1);
    const timed = !!spans && spans.length === stateCount;
    const times = timed ? cumulative(spans!.map((s, i) => (i === 0 ? 0 : Math.max(0, s)))) : null;
    const total = times ? times[n] : 0;
    const b = timed && total > 0 ? Math.min(1, Math.max(0, bias)) : 0;

    const weights = [0];
    for (let i = 1; i <= n; i++) weights.push((1 - b) / n + (b > 0 ? (b * Math.max(0, spans![i])) / total : 0));
    const xs = cumulative(weights);
    if (n > 0) for (let i = 0; i <= n; i++) xs[i] /= xs[n] || 1;

    return {
        xs,
        times,
        total,
        toX: p => at(xs, p),
        toPosition: x => inverse(xs, x),
        timeAt: p => (times ? at(times, p) : 0),
        positionAtTime: ms => (times ? inverse(times, ms) : 0)
    };
}

/** "63 µs", "1.54 ms", "850 ns": three significant digits at most. */
export function formatDuration(ms: number): string {
    const fmt = (v: number) => String(Number(v.toPrecision(3)));
    const a = Math.abs(ms);
    if (a === 0) return '0';
    if (a >= 1000) return `${fmt(ms / 1000)} s`;
    if (a >= 1) return `${fmt(ms)} ms`;
    if (a >= 0.001) return `${fmt(ms * 1000)} µs`;
    return `${fmt(ms * 1e6)} ns`;
}

/** Round tick values (1, 2 or 5 × 10^k) at least `minGapPx` apart on a bar `widthPx` wide. */
export function timeTicks(total: number, widthPx: number, minGapPx = 70): number[] {
    if (!(total > 0) || widthPx <= 0) return [];
    const raw = (total * minGapPx) / widthPx;
    const pow = Math.pow(10, Math.floor(Math.log10(raw)));
    const step = [1, 2, 5, 10].map(m => m * pow).find(s => s >= raw)!;
    const ticks: number[] = [];
    for (let v = 0; v <= total * (1 + 1e-9); v += step) ticks.push(Number(v.toPrecision(12)));
    return ticks;
}

// ─── Bar geometry ────────────────────────────────────────────────────────

export interface TrackRect {
    x: number;
    y: number;
    width: number;
    height: number;
    color: string;
    alpha: number;
}

/** Steps narrower than this (px) are drawn as one block instead of per-worker lanes. */
export const MIN_LANE_STEP_PX = 2;

/** Color of a kind of work (read work keeps the naive/deferred read colors). */
export function workColor(kind: WorkKind, implementation: Implementation): string {
    switch (kind) {
        case 'read': return PHASE_COLORS[implementation === 'naive' ? 'read' : 'read-batch'];
        case 'init': return PHASE_COLORS.init;
        default: return PHASE_COLORS[kind];
    }
}

export interface LaneParams {
    steps: WorkSegment[][];
    scale: TimeScale;
    width: number;
    height: number;
    implementation: Implementation;
}

/**
 * What every transition did, drawn to scale: sequential work fills the bar's
 * height; parallel work gets one row per worker, solid while that worker was
 * busy and faint while it waited for the slowest one. Rects are in px from the
 * bar's top-left corner.
 */
export function laneRects({ steps, scale, width, height, implementation }: LaneParams): TrackRect[] {
    const out: TrackRect[] = [];
    let narrow: TrackRect | null = null;
    const flushNarrow = () => {
        if (narrow) out.push(narrow);
        narrow = null;
    };

    for (let i = 1; i < steps.length && i < scale.xs.length; i++) {
        const x0 = scale.xs[i - 1] * width;
        const w = (scale.xs[i] - scale.xs[i - 1]) * width;
        const segs = steps[i].filter(s => segmentSpan(s) > 0);
        const span = stepSpan(segs);
        if (w <= 0 || span <= 0) continue;

        if (w < MIN_LANE_STEP_PX) {
            // Too narrow for lanes: one block in the color of its main work (merged with neighbors)
            const main = segs.reduce((a, b) => (segmentSpan(b) > segmentSpan(a) ? b : a));
            const color = workColor(main.kind, implementation);
            if (narrow && narrow.color === color && Math.abs(narrow.x + narrow.width - x0) < 1e-6) narrow.width += w;
            else {
                flushNarrow();
                narrow = { x: x0, y: 0, width: w, height, color, alpha: 1 };
            }
            continue;
        }
        flushNarrow();

        let x = x0;
        for (const seg of segs) {
            const segSpan = segmentSpan(seg);
            const sw = (segSpan / span) * w;
            const color = workColor(seg.kind, implementation);
            if (seg.workers <= 1) {
                out.push({ x, y: 0, width: sw, height, color, alpha: 1 });
            } else {
                out.push({ x, y: 0, width: sw, height, color, alpha: 0.22 });
                const row = height / seg.workers;
                const gap = row >= 2.5 ? 0.5 : 0;
                seg.lanes.forEach((d, lane) => {
                    if (d <= 0) return;
                    out.push({ x, y: lane * row, width: (d / segSpan) * sw, height: row - gap, color, alpha: 1 });
                });
            }
            x += sw;
        }
    }
    flushNarrow();
    return out;
}

/** Busy share of the workers during the parallel work of a step (null if it had none). */
export function utilization(segments: WorkSegment[]): number | null {
    let busy = 0, capacity = 0;
    for (const s of segments) {
        if (s.workers <= 1) continue;
        busy += segmentWork(s);
        capacity += segmentSpan(s) * s.workers;
    }
    return capacity > 0 ? busy / capacity : null;
}
