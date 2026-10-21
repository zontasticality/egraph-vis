import { describe, it, expect, beforeAll, afterEach, vi } from 'vitest';
import ELK from 'elkjs/lib/elk.bundled.js';
import { LayoutManager, buildElkGraph, structureKey, multiClassSets, edgeTargetClass } from '../engine/layout';
import { DEFAULT_LAYOUT_CONFIG } from '../engine/layoutConfig';
import { buildFrame, routeEdge, READ_TIMING, type Frame } from './frame';
import { fitViewport, zoomAt, needsRefit, visibleWorldRect, lerpViewport, MIN_ZOOM } from './viewport';
import { containsPoint, nodeWidth, NODE_HEIGHT } from './geometry';
import { PRESETS } from '../presets';
import { preset, rule, run } from '../test/helpers';
import type { EGraphTimeline, LayoutData, Rect } from '../engine/types';
import { EClassStyleClass } from '../engine/types';
import { ECLASS_STYLES } from '../engine/visualStyles';

const inside = (inner: Rect, outer: Rect, eps = 0.5) =>
    inner.x >= outer.x - eps && inner.y >= outer.y - eps &&
    inner.x + inner.width <= outer.x + outer.width + eps &&
    inner.y + inner.height <= outer.y + outer.height + eps;

const overlaps = (a: Rect, b: Rect) =>
    a.x < b.x + b.width - 0.5 && b.x < a.x + a.width - 0.5 && a.y < b.y + b.height - 0.5 && b.y < a.y + a.height - 0.5;

async function layoutAll(timeline: EGraphTimeline): Promise<LayoutData[]> {
    const lm = new LayoutManager(DEFAULT_LAYOUT_CONFIG, new ELK());
    lm.setTimeline(timeline);
    return Promise.all(timeline.states.map((_, i) => lm.whenReady(i))) as Promise<LayoutData[]>;
}

const paper = PRESETS.find(p => p.id === 'paper-example')!;

describe('layout', () => {
    afterEach(() => vi.restoreAllMocks());
    let timeline: EGraphTimeline;
    let layouts: LayoutData[];
    beforeAll(async () => {
        timeline = run(paper, { implementation: 'deferred', parallelism: 2 }).timeline;
        layouts = await layoutAll(timeline);
    });

    it('lays out every e-node, e-class and multi-class set', () => {
        timeline.states.forEach((s, i) => {
            const l = layouts[i];
            expect(l).toBeDefined();
            for (const c of s.eclasses) {
                expect(l.classes.has(c.id)).toBe(true);
                for (const n of c.nodes) {
                    const r = l.nodes.get(n.id)!;
                    expect(r.width).toBe(nodeWidth(n.op, n.args.length));
                    expect(r.height).toBe(NODE_HEIGHT);
                    expect(inside(r, l.classes.get(c.id)!)).toBe(true);
                }
            }
            for (const [canon, members] of multiClassSets(s)) {
                const sr = l.sets.get(canon)!;
                expect(sr).toBeDefined();
                members.forEach(m => expect(inside(l.classes.get(m)!, sr)).toBe(true));
            }
        });
    });

    it('never overlaps sibling e-nodes or top-level boxes', () => {
        timeline.states.forEach((s, i) => {
            const l = layouts[i];
            for (const c of s.eclasses) {
                const rs = c.nodes.map(n => l.nodes.get(n.id)!);
                for (let x = 0; x < rs.length; x++) for (let y = x + 1; y < rs.length; y++) expect(overlaps(rs[x], rs[y])).toBe(false);
            }
            const sets = multiClassSets(s);
            const inSet = new Set([...sets.values()].flat());
            const tops = [...s.eclasses.filter(c => !inSet.has(c.id)).map(c => l.classes.get(c.id)!), ...[...sets.keys()].map(k => l.sets.get(k)!)];
            for (let x = 0; x < tops.length; x++) for (let y = x + 1; y < tops.length; y++) expect(overlaps(tops[x], tops[y])).toBe(false);
        });
    });

    it('shares layouts between structurally identical snapshots', () => {
        const batches = timeline.states.map((s, i) => [s, i] as const).filter(([s]) => s.phase === 'read-batch');
        const [[s0, i0], [s1, i1]] = batches;
        expect(structureKey(s0)).toBe(structureKey(s1));
        expect(layouts[i0]).toBe(layouts[i1]);
    });

    it('points edges at merged classes until they are compacted', () => {
        const write = timeline.states.find(s => s.phase === 'write' && multiClassSets(s).size > 0)!;
        const classIds = new Set(write.eclasses.map(c => c.id));
        const merged = write.eclasses.find(c => !write.unionFind[c.id].isCanonical)!;
        expect(edgeTargetClass(write, classIds, merged.id)).toBe(merged.id);
        expect(edgeTargetClass(write, new Set(), merged.id)).toBe(write.unionFind[merged.id].canonical);
    });

    it('produces ELK graphs with ports in argument order', () => {
        const g = buildElkGraph(timeline.states[0], DEFAULT_LAYOUT_CONFIG);
        const div = g.children!.find(c => c.id === 'c3')!; // "/" (*(a, 2), 2)
        const ports = div.ports!;
        expect(ports.map(p => p.id)).toEqual(['p3_0', 'p3_1']);
        expect(ports[0].x).toBeLessThan(ports[1].x);
        expect(g.edges!.map(e => e.targets[0])).toEqual(['c0', 'c1', 'c2', 'c1']);
    });

    it('recovers from a hung layout worker', async () => {
        vi.spyOn(console, 'error').mockImplementation(() => {});
        // Regression: one never-settling ELK call blocked every later layout
        let calls = 0;
        const factory = async () => {
            calls++;
            const real = new ELK();
            return calls === 1
                ? { layout: () => new Promise(() => {}), terminateWorker: () => {} }
                : real;
        };
        // Generous timeout: a cold first layout on a slow CI runner must not time out too
        const lm = new LayoutManager(DEFAULT_LAYOUT_CONFIG, factory, { timeoutMs: 1000 });
        lm.setTimeline(timeline);
        // the hung call is abandoned and retried on a fresh worker
        expect(await lm.whenReady(0)).toBeDefined();
        expect(await lm.whenReady(timeline.states.length - 1)).toBeDefined();
        expect(calls).toBe(2);
    });

    it('retries after the worker fails to start', async () => {
        vi.spyOn(console, 'error').mockImplementation(() => {});
        let calls = 0;
        const factory = async () => {
            if (++calls === 1) throw new Error('worker failed to load');
            return new ELK();
        };
        const lm = new LayoutManager(DEFAULT_LAYOUT_CONFIG, factory);
        lm.setTimeline(timeline);
        expect(await lm.whenReady(0)).toBeDefined();
        expect(calls).toBe(2);
    });

    it('gives up on a layout that keeps failing so playback never deadlocks', async () => {
        vi.spyOn(console, 'error').mockImplementation(() => {});
        const broken = { layout: () => Promise.reject(new Error('boom')) };
        const lm = new LayoutManager(DEFAULT_LAYOUT_CONFIG, broken);
        lm.setTimeline(timeline);
        expect(await lm.whenReady(0)).toBeUndefined();
        const all = await Promise.all(timeline.states.map((_, i) => lm.whenReady(i)));
        expect(all.every(l => l === undefined)).toBe(true);
        const p = lm.progress();
        expect(p.done).toBe(p.total);
    });

    it('keeps waiters pending across config changes', async () => {
        // Regression: updateConfig resolved waiters with undefined, so playback ran ahead
        const lm = new LayoutManager(DEFAULT_LAYOUT_CONFIG, new ELK());
        lm.setTimeline(timeline);
        const last = timeline.states.length - 1;
        const pending = lm.whenReady(last);
        lm.updateConfig({ ...DEFAULT_LAYOUT_CONFIG, nodeSpacing: 70 });
        expect(await pending).toBeDefined();
        expect(lm.isReady(last)).toBe(true);
    });

    it('reports progress and keeps going after config changes', async () => {
        const lm = new LayoutManager(DEFAULT_LAYOUT_CONFIG, new ELK());
        lm.setTimeline(timeline);
        await lm.whenReady(timeline.states.length - 1);
        await Promise.all(timeline.states.map((_, i) => lm.whenReady(i)));
        const p = lm.progress();
        expect(p.done).toBe(p.total);
        lm.updateConfig({ ...DEFAULT_LAYOUT_CONFIG, nodeSpacing: 80 });
        expect(lm.isReady(0)).toBe(false);
        expect(await lm.whenReady(0)).toBeDefined();
    });
});

describe('routeEdge', () => {
    const target: Rect = { x: 100, y: 200, width: 120, height: 60 };
    const endOf = (d: string) => d.trim().split(/[\s,]+/).slice(-2).map(Number);

    it('enters downward targets through the top edge', () => {
        for (const routing of ['SPLINES', 'POLYLINE', 'ORTHOGONAL'] as const) {
            const { d, selfLoop } = routeEdge(150, 100, target, routing);
            expect(selfLoop).toBe(false);
            expect(d.startsWith('M 150 100')).toBe(true);
            expect(endOf(d)).toEqual([150, 200]);
        }
        // x is clamped into the box
        expect(endOf(routeEdge(0, 100, target).d)).toEqual([110, 200]);
    });

    it('enters targets above through the bottom edge', () => {
        const [x, y] = endOf(routeEdge(160, 400, target).d);
        expect(y).toBe(260);
        expect(x).toBeGreaterThanOrEqual(110);
    });

    it('loops back into the containing class', () => {
        const { d, selfLoop } = routeEdge(150, 240, target);
        expect(selfLoop).toBe(true);
        expect(endOf(d)[1]).toBe(260);
    });

    it('enters side-by-side targets from the side', () => {
        expect(endOf(routeEdge(20, 230, target).d)[0]).toBe(100);
        expect(endOf(routeEdge(300, 230, target).d)[0]).toBe(220);
    });
});

describe('buildFrame', () => {
    let timeline: EGraphTimeline;
    let layouts: LayoutData[];
    const src = (i: number) => ({ state: timeline.states[i], layout: layouts[i] });

    beforeAll(async () => {
        timeline = run(paper, { implementation: 'deferred', parallelism: 2 }).timeline;
        layouts = await layoutAll(timeline);
    });

    const check = (f: Frame) => {
        const nums = JSON.stringify(f).match(/NaN|Infinity/);
        expect(nums).toBeNull();
        const classIds = new Set(f.classes.map(c => c.id));
        for (const e of f.edges) expect(classIds.has(e.target)).toBe(true);
        // Every edge ends on the boundary of a box as drawn in this frame
        // (regression: edges used to end at a box's start/end position mid-transition)
        for (const e of f.edges) {
            const [x, y] = e.d.trim().split(/[\s,]+/).slice(-2).map(Number);
            const onSomeBox = f.classes.some(c =>
                x >= c.rect.x - 0.6 && x <= c.rect.x + c.rect.width + 0.6 &&
                y >= c.rect.y - 0.6 && y <= c.rect.y + c.rect.height + 0.6);
            expect(onSomeBox, `edge ${e.key} ends at ${x},${y}`).toBe(true);
        }
        for (const n of f.nodes) {
            expect(n.opacity).toBeGreaterThanOrEqual(0);
            expect(n.opacity).toBeLessThanOrEqual(1);
        }
    };

    it('reproduces the snapshot exactly at t = 0 and t = 1', () => {
        for (let i = 0; i + 1 < timeline.states.length; i++) {
            const f0 = buildFrame(src(i), src(i + 1), 0);
            const f1 = buildFrame(src(i), src(i + 1), 1);
            expect(f0).toEqual(buildFrame(src(i), null, 0));
            expect(f1).toEqual(buildFrame(src(i + 1), null, 0));
            for (const n of timeline.states[i].eclasses.flatMap(c => c.nodes)) {
                expect(f0.nodes.find(x => x.id === n.id)!.rect).toEqual(layouts[i].nodes.get(n.id));
            }
            check(f0);
        }
    });

    it('interpolates every transition without dangling edges', () => {
        for (let i = 0; i + 1 < timeline.states.length; i++) {
            for (const t of [0.1, 0.5, 0.9]) check(buildFrame(src(i), src(i + 1), t));
        }
    });

    it('draws one edge per argument', () => {
        for (let i = 0; i < timeline.states.length; i++) {
            const f = buildFrame(src(i), null, 0);
            const args = timeline.states[i].eclasses.flatMap(c => c.nodes).reduce((n, x) => n + x.args.length, 0);
            expect(f.edges.length).toBe(args);
        }
    });

    it('fades new e-nodes in once the workers writing them arrive, and moves existing ones', () => {
        const w = timeline.states.findIndex(s => s.phase === 'write');
        const created = timeline.states[w].metadata.applied!.flatMap(a => a.newNodes);
        expect(created.length).toBeGreaterThan(0);
        const { travelEnd } = READ_TIMING;
        const arriving = buildFrame(src(w - 1), src(w), travelEnd);
        for (const id of created) expect(arriving.nodes.find(n => n.id === id)!.opacity).toBe(0);
        const f = buildFrame(src(w - 1), src(w), 0.7);
        for (const id of created) expect(f.nodes.find(n => n.id === id)!.opacity).toBeCloseTo((0.7 - travelEnd) / (1 - travelEnd));
        const old = timeline.states[w - 1].eclasses[0].nodes[0].id;
        expect(f.nodes.find(n => n.id === old)!.opacity).toBe(1);
    });

    it('slides compacted classes into their canonical class', () => {
        const c = timeline.states.findIndex(s => s.phase === 'compact');
        const { compactedId, activeId } = timeline.states[c].metadata;
        const f = buildFrame(src(c - 1), src(c), 0.5);
        const box = f.classes.find(x => x.id === compactedId)!;
        expect(box.opacity).toBeCloseTo(0.5 * ECLASS_STYLES[EClassStyleClass.Merged].opacity);
        const start = layouts[c - 1].classes.get(compactedId!)!;
        const end = layouts[c].classes.get(activeId!)!;
        expect(box.rect.x).toBeCloseTo((start.x + end.x) / 2);
    });

    it('marks stale edges until repair', () => {
        const w = timeline.states.findIndex(s => s.phase === 'compact');
        const f = buildFrame(src(w), null, 0);
        expect(f.edges.some(e => e.stale)).toBe(true);
        const done = timeline.states.length - 1;
        expect(buildFrame(src(done), null, 0).edges.some(e => e.stale)).toBe(false);
    });

    it('slides deduplicated e-nodes into their twin', async () => {
        const p = preset({ op: 'x', args: [{ op: 'f', args: ['a'] }, { op: 'f', args: ['b'] }] }, [rule('ab', 'a', 'b')]);
        const tl = run(p, { implementation: 'deferred' }).timeline;
        const ls = await layoutAll(tl);
        const r = tl.states.findIndex(s => s.metadata.diffs.some(d => d.type === 'remove'));
        const removal = tl.states[r].metadata.diffs.find(d => d.type === 'remove')!;
        if (removal.type !== 'remove') throw new Error('unreachable');
        const f = buildFrame({ state: tl.states[r - 1], layout: ls[r - 1] }, { state: tl.states[r], layout: ls[r] }, 0.5);
        const ghost = f.nodes.find(n => n.id === removal.nodeId)!;
        expect(ghost.opacity).toBeCloseTo(0.5);
        const end = ls[r].nodes.get(removal.duplicateOf)!;
        const start = ls[r - 1].nodes.get(removal.nodeId)!;
        expect(ghost.rect.x).toBeCloseTo((start.x + end.x) / 2);
    });

    it('renders every preset transition (naive + deferred)', async () => {
        for (const p of PRESETS.filter(p => ['simple-add', 'associativity', 'nested-functions', 'transitive-chain'].includes(p.id))) {
            for (const implementation of ['naive', 'deferred'] as const) {
                const tl = run(p, { implementation, parallelism: 3 }).timeline;
                const ls = await layoutAll(tl);
                for (let i = 0; i + 1 < tl.states.length; i++) {
                    check(buildFrame({ state: tl.states[i], layout: ls[i] }, { state: tl.states[i + 1], layout: ls[i + 1] }, 0.37));
                }
            }
        }
    });
});

describe('parallel matcher animation', () => {
    const pm = PRESETS.find(p => p.id === 'parallel-matching')!;
    let timeline: EGraphTimeline;
    let layouts: LayoutData[];
    const src = (i: number) => ({ state: timeline.states[i], layout: layouts[i] });
    const sorted = (ids: number[]) => [...ids].sort((a, b) => a - b);
    /** Indices of the first iteration's read batches. */
    const reads = () => timeline.states.flatMap((s, i) => (s.phase === 'read-batch' && s.metadata.iteration === 0 ? [i] : []));

    beforeAll(async () => {
        timeline = run(pm, { implementation: 'deferred', parallelism: 4 }).timeline;
        layouts = await layoutAll(timeline);
    });

    it('puts one worker on every e-class of a batch', () => {
        for (const i of reads()) {
            const f = buildFrame(src(i), null, 0);
            const b = timeline.states[i].metadata.batch!;
            expect(f.workers.map(w => w.classId)).toEqual(b.classIds);
            for (const w of f.workers) {
                const r = layouts[i].classes.get(w.classId)!;
                expect(w.y).toBe(r.y); // badge straddles the top edge
                expect(w.x).toBeGreaterThan(r.x);
                expect(w.x).toBeLessThan(r.x + r.width);
                expect(w.scan).toBeNull();
                expect(w.opacity).toBe(1);
            }
            const searching = f.classes.filter(c => c.style === EClassStyleClass.Searching).map(c => c.id);
            expect(sorted(searching)).toEqual(sorted(b.classIds));
            const checked = f.classes.filter(c => c.searched === 1).map(c => c.id);
            expect(sorted(checked)).toEqual(sorted(b.order.slice(0, b.index * b.size)));
            expect(f.tags.map(t => t.rule)).toEqual(timeline.states[i].metadata.matches.map(m => m.rule));
        }
    });

    it('moves the workers together, then scans every e-class at once', () => {
        const [first, second] = reads();
        const hop = buildFrame(src(first), src(second), READ_TIMING.travelEnd / 2);
        const from = timeline.states[first].metadata.batch!.classIds;
        const to = timeline.states[second].metadata.batch!.classIds;
        expect(hop.workers.length).toBe(to.length);
        hop.workers.forEach((w, k) => {
            const a = layouts[first].classes.get(from[k])!;
            const b = layouts[second].classes.get(to[k])!;
            expect(w.x).toBeGreaterThanOrEqual(Math.min(a.x, b.x));
            expect(w.x).toBeLessThanOrEqual(Math.max(a.x + a.width, b.x + b.width));
            expect(w.y).toBeLessThan(Math.max(a.y, b.y)); // hops in an arc
            expect(w.scan!.opacity).toBe(0); // not scanning while moving
        });

        const scanning = buildFrame(src(first), src(second), 0.6);
        const progress = scanning.workers.map(w => w.scan!.progress);
        expect(new Set(progress).size).toBe(1); // in lock-step
        expect(progress[0]).toBeGreaterThan(0);
        expect(progress[0]).toBeLessThan(1);
        scanning.workers.forEach((w, k) => expect(w.scan!.rect).toEqual(layouts[second].classes.get(to[k])));
    });

    it('lights up a match (and tags it) when the beam reaches its root', () => {
        const i = reads().slice(1).find(i => timeline.states[i].metadata.matches.length > 0)!;
        const m = timeline.states[i].metadata.matches[0];
        const root = m.nodes[0];
        const cls = layouts[i].classes.get(m.eclassId)!;
        const node = layouts[i].nodes.get(root)!;
        const fy = (node.y + node.height / 2 - cls.y) / cls.height;
        const found = READ_TIMING.scanStart + fy * (READ_TIMING.scanEnd - READ_TIMING.scanStart);

        const fill = (f: Frame) => f.nodes.find(n => n.id === root)!.fill;
        const before = buildFrame(src(i - 1), src(i), found - 0.02);
        const after = buildFrame(src(i - 1), src(i), Math.min(0.99, found + 0.12));
        expect(fill(before)).toBe(fill(buildFrame(src(i - 1), null, 0)));
        expect(fill(after)).toBe(fill(buildFrame(src(i), null, 0)));
        expect(before.tags.some(t => t.key === `${i}:0`)).toBe(false);
        expect(after.tags.find(t => t.key === `${i}:0`)!.opacity).toBe(1);
    });

    it('brings workers in at the first batch and out after the last', () => {
        const rs = reads();
        const first = rs[0];
        const appear = buildFrame(src(first - 1), src(first), 0.1);
        expect(appear.workers.length).toBe(4);
        appear.workers.forEach(w => expect(w.opacity).toBeGreaterThan(0));
        appear.workers.forEach(w => expect(w.opacity).toBeLessThan(1));

        // After the last batch the workers move on to writing...
        const last = rs[rs.length - 1];
        expect(timeline.states[last + 1].phase).toBe('write');
        const toWrite = buildFrame(src(last), src(last + 1), READ_TIMING.travelEnd);
        expect(toWrite.workers.length).toBeGreaterThan(0);
        toWrite.workers.forEach(w => expect(w.opacity).toBe(1));
        toWrite.workers.forEach(w => expect(w.writing).toBe(1));
        toWrite.workers.forEach(w => expect(w.scan).toBeNull());
        toWrite.tags.forEach(t => expect(t.opacity).toBe(0)); // lifted off into the writelist
        toWrite.classes.forEach(c => expect(c.searched).toBe(0));

        // ...and leave when the rebuild (sequential) starts
        let w = last + 1;
        while (timeline.states[w + 1].phase === 'write') w++;
        const leave = buildFrame(src(w), src(w + 1), READ_TIMING.travelEnd);
        leave.workers.forEach(x => expect(x.opacity).toBe(0));
        expect(buildFrame(src(w + 1), null, 0).workers).toEqual([]);
    });

    it('puts one write worker on the e-class each writelist entry targets', () => {
        for (const [i, s] of timeline.states.entries()) {
            if (s.phase !== 'write') continue;
            const wl = s.metadata.writelist!;
            const f = buildFrame(src(i), null, 0);
            expect(f.workers.length).toBe(wl.nextIndex - wl.batchStart!);
            expect(f.workers.length).toBeLessThanOrEqual(4);
            for (const a of s.metadata.applied!) expect(f.workers[a.worker].classId).toBe(a.targetClass);
            f.workers.forEach(x => expect(x.writing).toBe(1));
        }
    });

    it('stays well-formed through every read transition (any worker count)', async () => {
        for (const parallelism of [1, 3, 32]) {
            const tl = run(pm, { implementation: 'deferred', parallelism }).timeline;
            const ls = await layoutAll(tl);
            for (let i = 0; i + 1 < tl.states.length; i++) {
                for (const t of [0.2, 0.5, 0.8]) {
                    const f = buildFrame({ state: tl.states[i], layout: ls[i] }, { state: tl.states[i + 1], layout: ls[i + 1] }, t);
                    expect(JSON.stringify(f).match(/NaN|Infinity/)).toBeNull();
                    expect(f.workers.length).toBeLessThanOrEqual(parallelism);
                    for (const w of f.workers) {
                        expect(w.opacity).toBeGreaterThanOrEqual(0);
                        expect(w.opacity).toBeLessThanOrEqual(1);
                        if (w.scan) expect(w.scan.progress).toBeLessThanOrEqual(1);
                    }
                    for (const tag of f.tags) expect(tag.opacity).toBeGreaterThan(-1e-9);
                }
            }
        }
    });

    it('draws nothing extra outside the parallel phases', () => {
        for (let i = 0; i < timeline.states.length; i++) {
            const phase = timeline.states[i].phase;
            if (phase === 'read-batch') continue;
            const f = buildFrame(src(i), null, 0);
            if (phase !== 'write') expect(f.workers).toEqual([]);
            expect(f.tags).toEqual([]);
            expect(f.classes.every(c => c.searched === 0 && c.style !== EClassStyleClass.Searching)).toBe(true);
        }
    });
});

describe('viewport', () => {
    const bounds: Rect = { x: 100, y: 50, width: 400, height: 200 };

    it('fits bounds centered with padding', () => {
        const v = fitViewport(bounds, 1000, 600, 40, 10);
        const vis = visibleWorldRect(v, 1000, 600);
        expect(inside(bounds, vis)).toBe(true);
        expect(v.k).toBeCloseTo(Math.min(920 / 400, 520 / 200));
        // centered
        expect(vis.x + vis.width / 2).toBeCloseTo(300);
        expect(vis.y + vis.height / 2).toBeCloseTo(150);
    });

    it('caps the zoom for small graphs', () => {
        expect(fitViewport({ x: 0, y: 0, width: 10, height: 10 }, 1000, 600).k).toBe(1.5);
    });

    it('zooms around the cursor', () => {
        const v = { x: 10, y: 20, k: 1 };
        const z = zoomAt(v, 2, 100, 100);
        // world point under the cursor stays put
        expect((100 - v.x) / v.k).toBeCloseTo((100 - z.x) / z.k);
        expect((100 - v.y) / v.k).toBeCloseTo((100 - z.y) / z.k);
    });

    it('asks for a refit when content leaves the screen', () => {
        const v = fitViewport(bounds, 1000, 600);
        expect(needsRefit(v, bounds, 1000, 600)).toBe(false);
        expect(needsRefit(v, { ...bounds, width: 4000 }, 1000, 600)).toBe(true);
    });

    it('settles when the graph cannot fit even at minimum zoom', () => {
        // Regression: the follow camera re-animated forever for huge graphs
        const huge: Rect = { x: 0, y: 0, width: 14013, height: 6897 };
        const v = fitViewport(huge, 700, 450);
        expect(v.k).toBe(MIN_ZOOM);
        expect(needsRefit(v, huge, 700, 450)).toBe(false);
    });

    it('interpolates zoom geometrically', () => {
        const m = lerpViewport({ x: 0, y: 0, k: 1 }, { x: 0, y: 0, k: 4 }, 0.5);
        expect(m.k).toBeCloseTo(2);
    });

    it('contains points', () => {
        expect(containsPoint(bounds, 100, 50)).toBe(true);
        expect(containsPoint(bounds, 99, 50)).toBe(false);
    });
});
