import { describe, it, expect } from 'vitest';
import { TimelineEngine } from './timeline';
import { WorkLog, clockOverhead, segmentSpan, segmentWork, stepSpan, workKindOf, type WorkSegment } from './work';
import { benchmark, benchmarkAll, estimateDuration, stageTotals, transitionSpans, clockResolution } from './benchmark';
import { PRESETS } from '../presets';
import { run, partitionSignature } from '../test/helpers';
import type { EngineOptions } from './types';

const byId = (id: string) => PRESETS.find(p => p.id === id)!;

/** A clock that advances one unit per reading: every timed task lasts exactly 1. */
function tickClock() {
    let t = 0;
    return () => t++;
}

describe('work log', () => {
    it('merges consecutive sequential work of one kind', () => {
        const log = new WorkLog(tickClock());
        log.sequential('write', 2);
        log.sequential('write', 3);
        log.sequential('repair', 1);
        log.parallel('read', [1, 4], 1); // one worker: sequential
        expect(log.flush()).toEqual([
            { kind: 'write', lanes: [5], workers: 1 },
            { kind: 'repair', lanes: [1], workers: 1 },
            { kind: 'read', lanes: [5], workers: 1 }
        ]);
        expect(log.flush()).toEqual([]);
        expect(log.steps.length).toBe(2);
    });

    it('keeps lock-step rounds separate', () => {
        const log = new WorkLog(tickClock());
        log.parallel('write', [1, 2], 4);
        log.parallel('write', [3], 4);
        log.parallel('read', [], 4); // nothing to do
        const [a, b] = log.flush();
        expect(a).toEqual({ kind: 'write', lanes: [1, 2], workers: 4 });
        expect(b).toEqual({ kind: 'write', lanes: [3], workers: 4 });
    });

    it('measures spans by the slowest worker', () => {
        const seg: WorkSegment = { kind: 'read', lanes: [1, 5, 2], workers: 4 };
        expect(segmentSpan(seg)).toBe(5);
        expect(segmentWork(seg)).toBe(8);
        expect(stepSpan([seg, { kind: 'write', lanes: [2], workers: 1 }])).toBe(7);
    });
});

describe('engine work accounting', () => {
    const configs: EngineOptions[] = [
        { implementation: 'naive' },
        { implementation: 'deferred', parallelism: 1 },
        { implementation: 'deferred', parallelism: 3 }
    ];

    it('records the work of every snapshot, matching what the snapshot shows', () => {
        for (const p of PRESETS.slice(0, 6)) {
            for (const options of configs) {
                const { engine, timeline } = run(p, options);
                const work = engine.getWork();
                const P = options.implementation === 'deferred' ? options.parallelism! : 1;
                expect(work.length).toBe(timeline.states.length);
                expect(engine.getPhases()).toEqual(timeline.states.map(s => s.phase));
                timeline.states.forEach((s, i) => {
                    const segs = work[i];
                    for (const seg of segs) {
                        expect(seg.lanes.length).toBeLessThanOrEqual(Math.max(1, seg.workers));
                        expect(seg.workers === 1 || seg.workers === P).toBe(true);
                        seg.lanes.forEach(d => expect(d).toBeGreaterThanOrEqual(0));
                    }
                    const own = workKindOf(s.phase);
                    if (s.phase === 'done') {
                        // Only carried work: redundant rewrites or skipped worklist entries
                        segs.forEach(seg => expect(['write', 'repair']).toContain(seg.kind));
                        return;
                    }
                    // The snapshot's own work comes last
                    const last = segs[segs.length - 1];
                    expect(last.kind).toBe(own);
                    if (s.phase === 'read-batch') {
                        expect(segs.length).toBe(1);
                        expect(last.lanes.length).toBe(s.metadata.batch!.classIds.length);
                    }
                    if (s.phase === 'write' && options.implementation === 'deferred') {
                        const wl = s.metadata.writelist!;
                        expect(last.lanes.length).toBe(wl.nextIndex - wl.batchStart!);
                        expect(s.metadata.applied!.length).toBeLessThanOrEqual(P);
                    }
                });
            }
        }
    });

    it('does the same work without recording snapshots', () => {
        for (const p of [byId('paper-example'), byId('distributivity')]) {
            for (const options of configs) {
                const a = new TimelineEngine({ clock: tickClock() });
                a.loadPreset(p, options);
                const timeline = a.run();
                const b = new TimelineEngine({ snapshots: false, clock: tickClock() });
                b.loadPreset(p, options);
                expect(b.run().states).toEqual([]);
                expect(b.getPhases()).toEqual(timeline.states.map(s => s.phase));
                expect(b.getWork()).toEqual(a.getWork());
            }
        }
    });

    it('reaches the same e-graph whatever the number of workers', () => {
        const p = byId('parallel-matching');
        const result = (parallelism: number) => {
            const { engine, timeline } = run(p, { implementation: 'deferred', parallelism });
            const initial = timeline.states[0].unionFind.length;
            return { partition: partitionSignature(engine.getRuntime(), initial), halted: timeline.haltedReason };
        };
        const one = result(1);
        expect(one.halted).toBe('saturated');
        for (const n of [2, 4, 32]) expect(result(n)).toEqual(one);
    });
});

describe('estimating durations', () => {
    it('ignores pauses when the clock resolves the task', () => {
        const samples = [10, 10.2, 9.9, 10.1, 10, 9.8, 10.3, 10, 250, 10.1];
        expect(estimateDuration(samples, 0.001)).toBeCloseTo(10.03, 1);
    });

    it('averages quantized samples of tasks shorter than a clock tick', () => {
        // A 2 µs task timed with a 100 µs clock reads 0 or 100 µs; 2% of readings are 100
        const samples = Array.from({ length: 1000 }, (_, i) => (i % 50 === 0 ? 0.1 : 0));
        expect(estimateDuration(samples, 0.1)).toBeCloseTo(0.002, 6);
    });

    it('subtracts the cost of reading the clock', () => {
        // Every reading costs 0.25: an empty timed region lasts 0.25, which is subtracted
        let t = 0;
        const clock = () => (t += 0.25);
        expect(clockOverhead(clock, 100)).toBeCloseTo(0.25);
        const b = benchmark(byId('simple-add'), { implementation: 'naive' }, { clock, calibrate: true, budgetMs: 1e9, minRuns: 2, maxRuns: 2, warmupMs: 0 });
        expect(b.overhead).toBeCloseTo(0.25);
        for (const step of b.steps) for (const seg of step) seg.lanes.forEach(d => expect(d).toBeCloseTo(0, 9));
    });

    it('handles empty input', () => {
        expect(estimateDuration([], 1)).toBe(0);
    });

    it('finds the clock resolution', () => {
        let t = 0;
        expect(clockResolution(() => (t += 0.25))).toBe(0.25);
        const r = clockResolution();
        expect(r).toBeGreaterThan(0);
        expect(r).toBeLessThan(1);
    });
});

describe('benchmark', () => {
    it('averages every task over many runs, in the shape of the timeline', () => {
        const p = byId('paper-example');
        for (const options of [{ implementation: 'naive' }, { implementation: 'deferred', parallelism: 2 }] as EngineOptions[]) {
            const b = benchmark(p, options, { clock: tickClock(), budgetMs: 1e9, minRuns: 3, maxRuns: 6, warmupMs: 1 });
            const { timeline } = run(p, options);
            expect(b.phases).toEqual(timeline.states.map(s => s.phase));
            expect(b.steps.length).toBe(timeline.states.length);
            expect(b.runs).toBe(6);
            expect(b.resolution).toBe(1);
            // Every task reads exactly one tick with this clock, in every run
            const engine = new TimelineEngine({ clock: tickClock() });
            engine.loadPreset(p, options);
            engine.run();
            expect(b.steps).toEqual(engine.getWork());
            expect(b.parallelism).toBe(options.implementation === 'deferred' ? 2 : 1);
        }
    });

    it('measures several configurations together, one run of each per round', () => {
        const p = byId('parallel-matching');
        const configs: EngineOptions[] = [
            { implementation: 'naive' },
            { implementation: 'deferred', parallelism: 1 },
            { implementation: 'deferred', parallelism: 4 }
        ];
        const order: string[] = [];
        let t = 0;
        const results = benchmarkAll(p, configs, { clock: () => t++, budgetMs: 1e9, minRuns: 3, maxRuns: 3, warmupMs: 0 });
        expect(results.map(r => r.runs)).toEqual([3, 3, 3]);
        results.forEach((r, i) => {
            const engine = new TimelineEngine({ clock: tickClock() });
            engine.loadPreset(p, configs[i]);
            const timeline = engine.run();
            expect(r.phases).toEqual(timeline.states.map(s => s.phase));
            expect(r.steps).toEqual(engine.getWork());
            order.push(`${r.implementation}x${r.parallelism}`);
        });
        expect(order).toEqual(['naivex1', 'deferredx1', 'deferredx4']);
    });

    it('measures real time', () => {
        const b = benchmark(byId('nested-functions'), { implementation: 'deferred', parallelism: 4 }, { budgetMs: 40, minRuns: 5 });
        expect(b.runs).toBeGreaterThanOrEqual(3);
        const totals = stageTotals(b);
        expect(totals.total).toBeGreaterThan(0);
        expect(totals.read).toBeGreaterThan(0);
        expect(totals.total).toBeCloseTo(totals.read + totals.write + totals.rebuild, 9);
    });

    it('sums stages by their slowest worker, leaving out the initial term', () => {
        const steps: WorkSegment[][] = [
            [{ kind: 'init', lanes: [9], workers: 1 }],
            [{ kind: 'read', lanes: [1, 3], workers: 2 }],
            [{ kind: 'write', lanes: [2, 2], workers: 2 }],
            [{ kind: 'compact', lanes: [1], workers: 1 }],
            [{ kind: 'repair', lanes: [4], workers: 1 }],
            [{ kind: 'write', lanes: [0.5], workers: 2 }]
        ];
        expect(stageTotals({ steps })).toEqual({ read: 3, write: 2.5, rebuild: 5, total: 10.5 });
        expect(transitionSpans({ steps })).toEqual([0, 3, 2, 1, 4, 0.5]);
    });
});
