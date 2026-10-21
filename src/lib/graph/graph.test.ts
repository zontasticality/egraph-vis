import { describe, it, expect, beforeAll, afterEach, vi } from 'vitest';
import ELK from 'elkjs/lib/elk.bundled.js';
import { LayoutManager, buildElkGraph, structureKey, multiClassSets, edgeTargetClass } from '../engine/layout';
import { DEFAULT_LAYOUT_CONFIG } from '../engine/layoutConfig';
import { buildFrame, routeEdge, type Frame } from './frame';
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

    it('fades new e-nodes in and moves existing ones', () => {
        const w = timeline.states.findIndex(s => s.phase === 'write');
        const created = timeline.states[w].metadata.applied!.newNodes;
        const f = buildFrame(src(w - 1), src(w), 0.5);
        for (const id of created) expect(f.nodes.find(n => n.id === id)!.opacity).toBeCloseTo(0.5);
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
