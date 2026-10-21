import { describe, it, expect } from 'vitest';
import {
    buildTrackModel, labeledIterations, stepAt, MIN_LABEL_PX,
    buildTimeScale, formatDuration, timeTicks, laneRects, utilization, workColor, MIN_LANE_STEP_PX
} from './timelineTrack';
import type { WorkSegment } from '../engine/work';
import { PHASE_COLORS } from '../engine/visualStyles';
import { PRESETS } from '../presets';
import { run } from '../test/helpers';
import type { EGraphState, Phase } from '../engine/types';

const states = (spec: Array<[Phase, number]>) =>
    spec.map(([phase, iteration]) => ({ phase, metadata: { iteration } }) as EGraphState);

describe('timeline track model', () => {
    const model = buildTrackModel(states([
        ['init', 0],
        ['read-batch', 0], ['read-batch', 0],
        ['write', 0], ['write', 0],
        ['compact', 0], ['repair', 0],
        ['read-batch', 1], ['write', 1], ['repair', 1],
        ['read-batch', 2],
        ['done', 2]
    ]));

    it('colors each transition by the phase it animates into', () => {
        expect(model.runs.map(r => [r.from, r.to, r.phase])).toEqual([
            [0, 2, 'read-batch'],
            [2, 4, 'write'],
            [4, 5, 'compact'],
            [5, 6, 'repair'],
            [6, 7, 'read-batch'],
            [7, 8, 'write'],
            [8, 9, 'repair'],
            [9, 10, 'read-batch'],
            [10, 11, 'done']
        ]);
        model.runs.forEach(r => expect(r.color).toBe(PHASE_COLORS[r.phase]));
        expect(model.steps).toBe(11);
    });

    it('ticks phase changes and iteration starts', () => {
        expect(model.phaseTicks).toEqual([2, 4, 5, 6, 7, 8, 9, 10]);
        expect(model.iterationTicks).toEqual([{ at: 6, iteration: 1 }, { at: 9, iteration: 2 }]);
    });

    it('only labels iterations that have room', () => {
        expect([...labeledIterations(model, 10)]).toEqual([6, 9]);
        expect([...labeledIterations(model, (MIN_LABEL_PX - 1) / 3)]).toEqual([6]);
    });

    it('maps a position to the step being animated', () => {
        expect(stepAt(0, 11)).toBe(1);
        expect(stepAt(0.3, 11)).toBe(1);
        expect(stepAt(1, 11)).toBe(1);
        expect(stepAt(1.01, 11)).toBe(2);
        expect(stepAt(99, 11)).toBe(11);
        expect(stepAt(0.5, 0)).toBe(0);
    });

    it('matches the animation under every point of real timelines', () => {
        for (const p of PRESETS.slice(0, 5)) {
            for (const implementation of ['naive', 'deferred'] as const) {
                const tl = run(p, { implementation, parallelism: 2 }).timeline;
                const m = buildTrackModel(tl.states);
                expect(m.runs[0].from).toBe(0);
                expect(m.runs[m.runs.length - 1].to).toBe(tl.states.length - 1);
                for (let i = 1; i < tl.states.length; i++) {
                    const mid = i - 0.5;
                    const r = m.runs.find(r => r.from <= mid && mid <= r.to)!;
                    expect(r.phase).toBe(tl.states[i].phase);
                }
            }
        }
    });
});

describe('time scale', () => {
    const spans = [0, 1, 3, 0, 4]; // the third transition takes no measurable time

    it('spaces steps evenly without timing (or with bias 0)', () => {
        for (const scale of [buildTimeScale(5, null, 1), buildTimeScale(5, spans, 0)]) {
            expect(scale.xs).toEqual([0, 0.25, 0.5, 0.75, 1]);
            expect(scale.toX(1.5)).toBeCloseTo(0.375);
            expect(scale.toPosition(0.375)).toBeCloseTo(1.5);
        }
        expect(buildTimeScale(5, null, 1).total).toBe(0);
        expect(buildTimeScale(5, null, 1).timeAt(2)).toBe(0);
    });

    it('sizes steps by execution time with bias 1', () => {
        const scale = buildTimeScale(5, spans, 1);
        expect(scale.total).toBe(8);
        expect(scale.times).toEqual([0, 1, 4, 4, 8]);
        expect(scale.xs).toEqual([0, 1 / 8, 4 / 8, 4 / 8, 1]);
        expect(scale.timeAt(1.5)).toBeCloseTo(2.5);
        expect(scale.positionAtTime(2.5)).toBeCloseTo(1.5);
        // An instant step has no width: x lands past it
        expect(scale.toPosition(0.5)).toBe(3);
        expect(scale.toPosition(0.75)).toBeCloseTo(3.5);
        for (const x of [0, 0.1, 0.3, 0.6, 0.99, 1]) expect(scale.toX(scale.toPosition(x))).toBeCloseTo(x, 9);
    });

    it('blends the two layouts in between', () => {
        const even = buildTimeScale(5, spans, 0).xs;
        const timed = buildTimeScale(5, spans, 1).xs;
        const half = buildTimeScale(5, spans, 0.5).xs;
        half.forEach((x, i) => expect(x).toBeCloseTo((even[i] + timed[i]) / 2, 9));
    });

    it('clamps out-of-range positions', () => {
        const scale = buildTimeScale(5, spans, 1);
        expect(scale.toX(-1)).toBe(0);
        expect(scale.toX(9)).toBe(1);
        expect(scale.toPosition(2)).toBe(4);
        expect(buildTimeScale(1, [0], 1).toX(0)).toBe(0);
    });
});

describe('durations and ticks', () => {
    it('formats durations with sensible units', () => {
        expect(formatDuration(0.063)).toBe('63 µs');
        expect(formatDuration(0.0154)).toBe('15.4 µs');
        expect(formatDuration(1.54321)).toBe('1.54 ms');
        expect(formatDuration(2500)).toBe('2.5 s');
        expect(formatDuration(0.00085)).toBe('850 ns');
        expect(formatDuration(0)).toBe('0');
    });

    it('picks round ticks that fit', () => {
        expect(timeTicks(0.063, 600)).toEqual([0, 0.01, 0.02, 0.03, 0.04, 0.05, 0.06]);
        const ticks = timeTicks(4.4, 300);
        expect(ticks).toEqual([0, 2, 4]);
        expect(timeTicks(0, 300)).toEqual([]);
    });
});

describe('lanes', () => {
    const steps: WorkSegment[][] = [
        [{ kind: 'init', lanes: [5], workers: 1 }],
        [{ kind: 'read', lanes: [1, 3], workers: 2 }],
        [{ kind: 'write', lanes: [2], workers: 1 }]
    ];

    it('draws one row per worker for parallel work, to scale', () => {
        const scale = buildTimeScale(3, [0, 3, 2], 1);
        const rects = laneRects({ steps, scale, width: 500, height: 14, implementation: 'deferred' });
        const read = workColor('read', 'deferred');
        expect(rects).toEqual([
            { x: 0, y: 0, width: 300, height: 14, color: read, alpha: 0.22 },   // waiting for the slowest worker
            { x: 0, y: 0, width: 100, height: 6.5, color: read, alpha: 1 },     // worker 1
            { x: 0, y: 7, width: 300, height: 6.5, color: read, alpha: 1 },     // worker 2
            { x: 300, y: 0, width: 200, height: 14, color: workColor('write', 'deferred'), alpha: 1 }
        ]);
    });

    it('merges steps too narrow for lanes', () => {
        const many: WorkSegment[][] = [[], ...Array.from({ length: 400 }, () => [{ kind: 'read', lanes: [1, 1], workers: 2 } as WorkSegment])];
        const scale = buildTimeScale(401, [0, ...Array(400).fill(1)], 1);
        const rects = laneRects({ steps: many, scale, width: 400 * MIN_LANE_STEP_PX * 0.5, height: 10, implementation: 'deferred' });
        expect(rects.length).toBe(1);
        expect(rects[0].width).toBeCloseTo(400);
    });

    it('measures how busy the workers were', () => {
        expect(utilization(steps[1])).toBeCloseTo(4 / 6);
        expect(utilization(steps[2])).toBeNull();
    });
});
