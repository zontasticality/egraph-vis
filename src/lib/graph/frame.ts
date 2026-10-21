/**
 * Frame builder: turns one snapshot (or a blend of two consecutive snapshots)
 * plus their layouts into plain, absolutely positioned shapes for the graph
 * renderer. Pure and deterministic so it can be unit tested.
 *
 * Interpolation rules (t = progress from A to B):
 *  - entities in both snapshots move/resize/recolor linearly;
 *  - entities only in B fade (and grow) in at their B position;
 *  - e-classes only in A (merged away) slide into their canonical class and fade out;
 *  - e-nodes only in A (deduplicated) slide into the e-node they duplicate and fade out;
 *  - edges re-target smoothly when the e-class they point at changes.
 *
 * Deferred mode runs on parallel workers. Read phase: every read-batch
 * snapshot has one worker per searched e-class. Between two batches the
 * workers hop to their next e-class together, then scan beams sweep down all
 * of them at once; e-nodes light up (and a tag with the rule name pops up) when
 * a beam reaches the root of a match. See {@link READ_TIMING}. Write phase: the
 * same workers hop to the e-classes their writelist entries target, and the
 * right-hand sides they add appear once they have arrived.
 */
import type { EGraphState, LayoutData, Rect, Phase, EClassViewModel, MatchEvent } from '../engine/types';
import { NodeStyleClass, EClassStyleClass } from '../engine/types';
import { NODE_STYLES, ECLASS_STYLES, EDGE_COLORS, activeClassColors } from '../engine/visualStyles';
import { edgeTargetClass, multiClassSets } from '../engine/layout';
import { mixColor } from '../utils/colors';
import { lerp, lerpRect, unionRects, padRect, containsPoint, portOffset, SET_PADDING } from './geometry';

export type EdgeRouting = 'SPLINES' | 'POLYLINE' | 'ORTHOGONAL';

export interface FrameSource {
    state: EGraphState;
    layout: LayoutData;
}

export interface FrameNode {
    id: number;
    classId: number;
    op: string;
    args: number[];
    /** Canonical id of each argument in the snapshot this node is drawn from. */
    argCanonical: number[];
    rect: Rect;
    opacity: number;
    fill: string;
    stroke: string;
    text: string;
    dashed: boolean;
    style: NodeStyleClass;
}

export interface FrameClass {
    id: number;
    canonical: number;
    rect: Rect;
    opacity: number;
    fill: string;
    stroke: string;
    strokeWidth: number;
    dashed: boolean;
    style: EClassStyleClass;
    /** Opacity of the "already searched in this read phase" check mark. */
    searched: number;
}

export interface FrameSet {
    id: number;
    members: number[];
    rect: Rect;
    opacity: number;
}

export interface FrameEdge {
    key: string;
    source: number;
    argIndex: number;
    target: number;
    d: string;
    opacity: number;
    stale: boolean;
    selfLoop: boolean;
    color: string;
}

/** A parallel worker (deferred read and write phases). */
export interface FrameWorker {
    /** 0-based worker index. */
    id: number;
    /** E-class being searched or written to (the destination while hopping). */
    classId: number;
    /** 0 = searching (read phase), 1 = applying a rewrite (write phase); blends while switching. */
    writing: number;
    /** Badge center. */
    x: number;
    y: number;
    scale: number;
    opacity: number;
    /** Scan beam sweeping down the searched e-class (only while a batch is being searched). */
    scan: { rect: Rect; progress: number; opacity: number } | null;
}

/** "Found a match" tag shown above the root e-node of a match. */
export interface FrameMatchTag {
    key: string;
    rule: string;
    /** Center of the tag's bottom edge. */
    x: number;
    y: number;
    scale: number;
    opacity: number;
}

export interface Frame {
    sets: FrameSet[];
    classes: FrameClass[];
    nodes: FrameNode[];
    edges: FrameEdge[];
    workers: FrameWorker[];
    tags: FrameMatchTag[];
    bounds: Rect;
}

/**
 * Timing (as fractions of a transition into a read-batch snapshot) of the
 * parallel matching animation: workers hop to their e-class during
 * [0, travelEnd], then all scan beams sweep down during [scanStart, scanEnd].
 */
export const READ_TIMING = { travelEnd: 0.4, scanStart: 0.4, scanEnd: 0.85 } as const;

/** Tags are skipped when a batch finds more matches than this (unreadable clutter). */
export const MAX_MATCH_TAGS = 80;

interface Side {
    state: EGraphState;
    layout: LayoutData;
    classes: Map<number, EClassViewModel>;
    classIds: Set<number>;
    nodes: Map<number, { node: EClassViewModel['nodes'][number]; classId: number }>;
    sets: Map<number, number[]>;
}

function side(src: FrameSource): Side {
    const classes = new Map<number, EClassViewModel>();
    const nodes: Side['nodes'] = new Map();
    for (const c of src.state.eclasses) {
        classes.set(c.id, c);
        for (const n of c.nodes) nodes.set(n.id, { node: n, classId: c.id });
    }
    return {
        state: src.state,
        layout: src.layout,
        classes,
        classIds: new Set(classes.keys()),
        nodes,
        sets: multiClassSets(src.state)
    };
}

const canonicalOf = (s: Side, id: number) => s.state.unionFind[id]?.canonical ?? id;

/** Shrink a rect around its center (used for grow-in effects). */
function shrink(r: Rect, f: number): Rect {
    return { x: r.x + (r.width * (1 - f)) / 2, y: r.y + (r.height * (1 - f)) / 2, width: r.width * f, height: r.height * f };
}

function nodeStyleOf(s: Side, id: number): NodeStyleClass {
    return s.state.visualStates.nodes.get(id)?.styleClass ?? NodeStyleClass.Default;
}

function classLook(s: Side, id: number) {
    const style = s.state.visualStates.eclasses.get(id)?.styleClass ?? EClassStyleClass.Default;
    const base = ECLASS_STYLES[style];
    const active = style === EClassStyleClass.Active ? activeClassColors(s.state.phase as Phase) : null;
    return { style, ...base, ...active };
}

const clamp01 = (v: number) => Math.min(1, Math.max(0, v));
const easeInOut = (u: number) => (u < 0.5 ? 2 * u * u : 1 - Math.pow(-2 * u + 2, 2) / 2);

function readBatch(s: Side | null) {
    return s && s.state.phase === 'read-batch' ? s.state.metadata.batch ?? null : null;
}

/** E-class each worker is busy with in snapshot `s` (index = worker), if workers are active. */
export function workerTargets(s: Pick<Side, 'state'> | null): { classIds: number[]; writing: 0 | 1 } | null {
    if (!s) return null;
    const { phase, implementation, metadata: m } = s.state;
    if (phase === 'read-batch' && m.batch) return { classIds: m.batch.classIds, writing: 0 };
    const wl = m.writelist;
    if (phase === 'write' && implementation === 'deferred' && wl && wl.batchStart !== undefined) {
        const classIds: number[] = [];
        for (let i = wl.batchStart; i < wl.nextIndex; i++) {
            // Redundant entries kept their worker busy too, so they get one
            const applied = m.applied?.find(a => a.entry === i);
            classIds.push(applied ? applied.targetClass : s.state.unionFind[wl.entries[i].targetClass]?.canonical ?? wl.entries[i].targetClass);
        }
        return { classIds, writing: 1 };
    }
    return null;
}

/** E-classes searched by earlier batches of the read phase `s` is in. */
function searchedBefore(s: Side | null): Set<number> {
    const b = readBatch(s);
    return new Set(b ? b.order.slice(0, b.index * b.size) : []);
}

/** Transition progress at which the scan beam reaches the root e-node of a match. */
function foundTime(s: Side, m: MatchEvent): number {
    const { scanStart, scanEnd } = READ_TIMING;
    const cls = s.layout.classes.get(m.eclassId);
    const root = m.nodes.length > 0 ? s.layout.nodes.get(m.nodes[0]) : undefined;
    if (!cls || !root || cls.height <= 0) return scanEnd;
    const fy = clamp01((root.y + root.height / 2 - cls.y) / cls.height);
    return scanStart + fy * (scanEnd - scanStart);
}

/** Badge position of a worker searching the e-class drawn at `r` (straddles its top edge). */
const badgeAt = (r: Rect) => ({ x: r.x + r.width - 22, y: r.y });

// ─── Edge routing ────────────────────────────────────────────────────────

const r1 = (v: number) => Math.round(v * 10) / 10;

/**
 * Path from an argument port (bottom of an e-node) to the boundary of the
 * target e-class. Handles downward edges, back edges (target above) and
 * self-loops (the e-node lives inside its target class).
 */
export function routeEdge(sx: number, sy: number, target: Rect, routing: EdgeRouting = 'SPLINES'): { d: string; selfLoop: boolean } {
    const left = target.x, right = target.x + target.width;
    const top = target.y, bottom = target.y + target.height;
    const clampX = (x: number) => Math.min(Math.max(x, left + 10), Math.max(left + 10, right - 10));

    // Self-loop: leave through the bottom of the class and come back in
    if (containsPoint(target, sx, sy)) {
        const dir = sx + 18 <= right - 6 ? 1 : -1;
        const ex = sx + dir * 18;
        const depth = Math.max(18, bottom - sy + 16);
        const d = routing === 'SPLINES'
            ? `M ${r1(sx)} ${r1(sy)} C ${r1(sx)} ${r1(sy + depth)}, ${r1(ex)} ${r1(sy + depth)}, ${r1(ex)} ${r1(bottom)}`
            : `M ${r1(sx)} ${r1(sy)} L ${r1(sx)} ${r1(bottom + 10)} L ${r1(ex)} ${r1(bottom + 10)} L ${r1(ex)} ${r1(bottom)}`;
        return { d, selfLoop: true };
    }

    // Target below the port: enter through the top edge
    if (top >= sy + 6) {
        const ex = clampX(sx), ey = top;
        if (routing === 'POLYLINE') return { d: `M ${r1(sx)} ${r1(sy)} L ${r1(ex)} ${r1(ey)}`, selfLoop: false };
        if (routing === 'ORTHOGONAL') {
            const my = (sy + ey) / 2;
            return { d: `M ${r1(sx)} ${r1(sy)} L ${r1(sx)} ${r1(my)} L ${r1(ex)} ${r1(my)} L ${r1(ex)} ${r1(ey)}`, selfLoop: false };
        }
        const dy = Math.max(16, (ey - sy) * 0.5);
        return { d: `M ${r1(sx)} ${r1(sy)} C ${r1(sx)} ${r1(sy + dy)}, ${r1(ex)} ${r1(ey - dy)}, ${r1(ex)} ${r1(ey)}`, selfLoop: false };
    }

    // Target above the port (back edge): swing out to the side and enter from below
    if (bottom <= sy - 6) {
        const ex = clampX(sx), ey = bottom;
        const dir = sx >= (left + right) / 2 ? 1 : -1;
        const swing = Math.max(36, Math.abs(sx - ex) * 0.5 + 24);
        if (routing === 'SPLINES') {
            return {
                d: `M ${r1(sx)} ${r1(sy)} C ${r1(sx + dir * swing)} ${r1(sy + 48)}, ${r1(ex + dir * swing)} ${r1(ey + 48)}, ${r1(ex)} ${r1(ey)}`,
                selfLoop: false
            };
        }
        const sideX = dir > 0 ? Math.max(sx, right) + 20 : Math.min(sx, left) - 20;
        const pts: Array<[number, number]> = [[sx, sy], [sx, sy + 12], [sideX, sy + 12], [sideX, ey + 12], [ex, ey + 12], [ex, ey]];
        return { d: 'M ' + pts.map(([x, y]) => `${r1(x)} ${r1(y)}`).join(' L '), selfLoop: false };
    }

    // Side by side: enter through the nearest vertical edge
    const ex = sx < left ? left : right;
    const ey = Math.min(Math.max(sy + 12, top + 10), Math.max(top + 10, bottom - 10));
    if (routing === 'POLYLINE') return { d: `M ${r1(sx)} ${r1(sy)} L ${r1(ex)} ${r1(ey)}`, selfLoop: false };
    if (routing === 'ORTHOGONAL') return { d: `M ${r1(sx)} ${r1(sy)} L ${r1(sx)} ${r1(ey)} L ${r1(ex)} ${r1(ey)}`, selfLoop: false };
    const out = ex === left ? -30 : 30;
    return { d: `M ${r1(sx)} ${r1(sy)} C ${r1(sx)} ${r1(sy + 30)}, ${r1(ex + out)} ${r1(ey)}, ${r1(ex)} ${r1(ey)}`, selfLoop: false };
}

// ─── Frame construction ──────────────────────────────────────────────────

/**
 * Build the frame at progress `t` between snapshot A and snapshot B.
 * With `b = null` (or t = 0) the frame shows A exactly.
 */
export function buildFrame(a: FrameSource, b: FrameSource | null, t: number, routing: EdgeRouting = 'SPLINES'): Frame {
    if (!b || t <= 0) return buildFrame2(side(a), null, 0, routing);
    if (t >= 1) return buildFrame2(side(b), null, 0, routing);
    return buildFrame2(side(a), side(b), t, routing);
}

function buildFrame2(A: Side, B: Side | null, t: number, routing: EdgeRouting): Frame {
    const classes: FrameClass[] = [];
    const nodes: FrameNode[] = [];
    const sets: FrameSet[] = [];
    const edges: FrameEdge[] = [];
    const classRects = new Map<number, Rect>();
    const nodeRects = new Map<number, { rect: Rect; opacity: number }>();

    const batchA = readBatch(A);
    const batchB = readBatch(B);
    const workA = workerTargets(A);
    const workB = workerTargets(B);
    const { travelEnd, scanStart, scanEnd } = READ_TIMING;
    // Writes appear once the workers applying them have arrived
    const appear = workB?.writing ? (u: number) => clamp01((u - travelEnd) / (1 - travelEnd)) : (u: number) => u;

    // --- e-classes ---
    const searchedA = searchedBefore(A);
    const searchedB = searchedBefore(B);
    const classIds = new Set<number>([...A.classIds, ...(B?.classIds ?? [])]);
    for (const id of Array.from(classIds).sort((x, y) => x - y)) {
        const inA = A.classIds.has(id) && A.layout.classes.has(id);
        const inB = !!B && B.classIds.has(id) && B.layout.classes.has(id);
        if (!inA && !inB) continue;

        let rect: Rect;
        let opacity: number;
        if (inA && (!B || inB)) {
            rect = B ? lerpRect(A.layout.classes.get(id)!, B.layout.classes.get(id)!, t) : A.layout.classes.get(id)!;
            opacity = 1;
        } else if (inA) {
            // merged away: slide into the canonical class and fade out
            const end = B!.layout.classes.get(canonicalOf(B!, id)) ?? A.layout.classes.get(id)!;
            rect = lerpRect(A.layout.classes.get(id)!, end, t);
            opacity = 1 - t;
        } else {
            const end = B!.layout.classes.get(id)!;
            rect = lerpRect(shrink(end, 0.6), end, appear(t));
            opacity = appear(t);
        }

        const lookA = inA ? classLook(A, id) : null;
        const lookB = inB ? classLook(B!, id) : null;
        const from = lookA ?? lookB!;
        const to = lookB ?? lookA!;
        // Searching outlines follow the workers: on when one arrives, off as it leaves
        const searching = EClassStyleClass.Searching;
        const ts = to.style === searching && from.style !== searching
            ? clamp01((t - travelEnd / 2) / (travelEnd / 2))
            : from.style === searching && to.style !== searching
                ? clamp01(t / (travelEnd * 0.6))
                : t;
        const checkA = searchedA.has(id) ? 1 : 0;
        const checkB = B ? (searchedB.has(id) ? 1 : 0) : checkA;
        classes.push({
            id,
            canonical: canonicalOf(B && t >= 0.5 && inB ? B : A, id),
            rect,
            opacity: opacity * lerp(from.opacity, to.opacity, ts),
            fill: mixColor(from.fill, to.fill, ts),
            stroke: mixColor(from.stroke, to.stroke, ts),
            strokeWidth: lerp(from.strokeWidth, to.strokeWidth, ts),
            dashed: ts < 0.5 ? from.dashed : to.dashed,
            style: ts < 0.5 ? from.style : to.style,
            searched: lerp(checkA, checkB, clamp01(t / travelEnd))
        });
        classRects.set(id, rect);
    }

    // --- union-find sets (only drawn while they hold several e-classes) ---
    const setIds = new Set<number>([...A.sets.keys(), ...(B?.sets.keys() ?? [])]);
    for (const id of Array.from(setIds).sort((x, y) => x - y)) {
        const membersA = A.sets.get(id);
        const membersB = B?.sets.get(id);
        const rectA = membersA ? A.layout.sets.get(id) : undefined;
        const rectB = membersB ? B!.layout.sets.get(id) : undefined;
        if (!rectA && !rectB) continue;

        let rect: Rect;
        let opacity: number;
        if (rectA && (!B || rectB)) {
            rect = rectB ? lerpRect(rectA, rectB, t) : rectA;
            opacity = 1;
        } else if (rectA) {
            // compacted (or absorbed into another set): shrink onto what replaced it
            const canon = canonicalOf(B!, id);
            const end = B!.layout.sets.get(canon) ?? B!.layout.classes.get(canon) ?? rectA;
            rect = lerpRect(rectA, end, t);
            opacity = 1 - t;
        } else {
            // a union just happened: wrap around where the member classes were
            const before = unionRects(membersB!.map(m => A.layout.classes.get(m)).filter((r): r is Rect => !!r));
            const start = before ? padRect(before, SET_PADDING) : rectB!;
            rect = lerpRect(start, rectB!, appear(t));
            opacity = appear(t);
        }
        sets.push({ id, members: (membersB ?? membersA)!, rect, opacity });
    }

    // --- e-nodes ---
    // Matches of an incoming read batch light up when the scan beam reaches them
    const foundAt = new Map<number, number>();
    if (batchB) {
        for (const m of B!.state.metadata.matches) {
            const tf = foundTime(B!, m);
            for (const n of m.nodes) foundAt.set(n, Math.min(foundAt.get(n) ?? 1, tf));
        }
    }
    const removedInB = new Map<number, number>();
    if (B) {
        for (const d of B.state.metadata.diffs) if (d.type === 'remove') removedInB.set(d.nodeId, d.duplicateOf);
    }
    const nodeIds = new Set<number>([...A.nodes.keys(), ...(B?.nodes.keys() ?? [])]);
    for (const id of Array.from(nodeIds).sort((x, y) => x - y)) {
        const ea = A.nodes.get(id);
        const eb = B?.nodes.get(id);
        const ra = ea ? A.layout.nodes.get(id) : undefined;
        const rb = eb ? B!.layout.nodes.get(id) : undefined;
        if (!ra && !rb) continue;

        let rect: Rect;
        let opacity: number;
        if (ra && (!B || rb)) {
            rect = rb ? lerpRect(ra, rb, t) : ra;
            opacity = 1;
        } else if (ra) {
            const dupOf = removedInB.get(id);
            const end = (dupOf !== undefined ? B!.layout.nodes.get(dupOf) : undefined) ?? ra;
            rect = lerpRect(ra, end, t);
            opacity = 1 - t;
        } else {
            rect = lerpRect(shrink(rb!, 0.4), rb!, Math.min(1, appear(t) * 1.5));
            opacity = appear(t);
        }

        const styleA = ea ? nodeStyleOf(A, id) : undefined;
        const styleB = eb ? nodeStyleOf(B!, id) : undefined;
        const from = NODE_STYLES[styleA ?? styleB!];
        const to = NODE_STYLES[styleB ?? styleA!];
        const matched = NodeStyleClass.MatchedLHS;
        const found = foundAt.get(id);
        const ts = found !== undefined && styleB === matched && styleA !== matched
            ? clamp01((t - found) / 0.08)
            : batchA && styleA === matched && styleB !== matched
                ? clamp01(t / travelEnd)
                : t;
        const entry = (t >= 0.5 ? eb : ea) ?? ea ?? eb!;
        const entrySide = entry === eb ? B! : A;
        nodes.push({
            id,
            classId: entry.classId,
            op: entry.node.op,
            args: entry.node.args,
            argCanonical: entry.node.args.map(a => canonicalOf(entrySide, a)),
            rect,
            opacity,
            fill: mixColor(from.fill, to.fill, ts),
            stroke: mixColor(from.stroke, to.stroke, ts),
            text: mixColor(from.text, to.text, ts),
            dashed: ts < 0.5 ? from.dashed : to.dashed,
            style: (ts < 0.5 ? styleA ?? styleB : styleB ?? styleA)!
        });
        nodeRects.set(id, { rect, opacity });

        // --- edges from this node's argument ports ---
        const arity = entry.node.args.length;
        for (let i = 0; i < arity; i++) {
            const argA = ea?.node.args[i];
            const argB = eb?.node.args[i];
            const targetA = argA !== undefined ? edgeTargetClass(A.state, A.classIds, argA) : undefined;
            const targetB = argB !== undefined && B ? edgeTargetClass(B.state, B.classIds, argB) : undefined;
            // Attach to the target boxes as drawn in this frame (they may be moving/growing)
            const endA = targetA !== undefined ? classRects.get(targetA) ?? A.layout.classes.get(targetA) : undefined;
            const endB = targetB !== undefined ? classRects.get(targetB) ?? B!.layout.classes.get(targetB) : undefined;
            let end: Rect | undefined;
            if (endA && endB && targetA !== targetB) {
                // The old target usually merged into the new one and is drawn sliding into
                // it, so staying attached to it keeps the edge connected throughout.
                end = B!.classIds.has(targetA!) ? lerpRect(endA, endB, t) : endA;
            } else {
                end = endA ?? endB;
            }
            if (!end) continue;

            const staleA = argA !== undefined && canonicalOf(A, argA) !== argA;
            const staleB = argB !== undefined && B ? canonicalOf(B, argB) !== argB : staleA;
            const colorA = staleA ? EDGE_COLORS.stale : EDGE_COLORS.normal;
            const colorB = staleB ? EDGE_COLORS.stale : EDGE_COLORS.normal;
            const sx = rect.x + portOffset(rect.width, arity, i);
            const sy = rect.y + rect.height;
            const route = routeEdge(sx, sy, end, routing);
            const target = (t >= 0.5 ? targetB ?? targetA : targetA ?? targetB)!;
            edges.push({
                key: `${id}:${i}`,
                source: id,
                argIndex: i,
                target,
                d: route.d,
                opacity,
                stale: t < 0.5 ? staleA : staleB,
                selfLoop: route.selfLoop,
                color: mixColor(ea ? colorA : colorB, eb ? colorB : colorA, t)
            });
        }
    }

    // --- parallel workers ---
    const workers: FrameWorker[] = [];
    const sameIteration = !!workA && !!workB && A.state.metadata.iteration === B!.state.metadata.iteration;
    const scanOf = (rect: Rect): FrameWorker['scan'] => ({
        rect,
        progress: clamp01((t - scanStart) / (scanEnd - scanStart)),
        opacity: t < scanStart ? 0 : 1 - clamp01((t - scanEnd) / (1 - scanEnd))
    });
    const workerCount = Math.max(workA?.classIds.length ?? 0, workB?.classIds.length ?? 0);
    for (let w = 0; w < workerCount; w++) {
        const ca = workA?.classIds[w];
        const cb = workB?.classIds[w];
        const ra = ca !== undefined ? classRects.get(ca) : undefined;
        const rb = cb !== undefined ? classRects.get(cb) : undefined;
        const scan = batchB && rb ? scanOf(rb) : null;
        if (!B) {
            if (ra) workers.push({ id: w, classId: ca!, writing: workA!.writing, ...badgeAt(ra), scale: 1, opacity: 1, scan: null });
        } else if (ra && rb && sameIteration) {
            // Hop to the next e-class (all workers move together)
            const u = easeInOut(clamp01(t / travelEnd));
            const pa = badgeAt(ra), pb = badgeAt(rb);
            const hop = Math.sin(Math.PI * u) * Math.min(48, 14 + Math.hypot(pb.x - pa.x, pb.y - pa.y) * 0.15);
            workers.push({
                id: w, classId: cb!, writing: lerp(workA!.writing, workB!.writing, u),
                x: lerp(pa.x, pb.x, u), y: lerp(pa.y, pb.y, u) - hop, scale: 1, opacity: 1, scan
            });
        } else if (rb) {
            // The worker appears on its first e-class
            const u = clamp01(t / (travelEnd * 0.9));
            workers.push({ id: w, classId: cb!, writing: workB!.writing, ...badgeAt(rb), scale: 0.5 + 0.5 * u, opacity: u, scan });
        } else if (ra) {
            // Nothing left to do (phase over, or a short last batch)
            const u = clamp01(t / (travelEnd * 0.9));
            workers.push({ id: w, classId: ca!, writing: workA!.writing, ...badgeAt(ra), scale: 1 - 0.4 * u, opacity: 1 - u, scan: null });
        }
    }

    // --- match tags ---
    const tags: FrameMatchTag[] = [];
    const tagsOf = (s: Side, place: (key: string, rule: string, x: number, y: number, m: MatchEvent) => void) => {
        const matches = s.state.metadata.matches;
        if (matches.length > MAX_MATCH_TAGS) return;
        const stacked = new Map<number, number>();
        matches.forEach((m, i) => {
            const root = m.nodes[0];
            const r = root !== undefined ? nodeRects.get(root)?.rect ?? s.layout.nodes.get(root) : undefined;
            const c = classRects.get(m.eclassId) ?? s.layout.classes.get(m.eclassId);
            if (!c) return;
            // Just above the e-class box (clear of its label and the worker badge), over the root e-node
            const anchor = { x: r ? r.x + r.width / 2 : c.x + c.width / 2, y: c.y - 12 };
            const level = stacked.get(root ?? -1) ?? 0;
            stacked.set(root ?? -1, level + 1);
            place(`${s.state.stepIndex}:${i}`, m.rule, anchor.x, anchor.y - level * 16, m);
        });
    };
    if (batchA) {
        // Settled on a batch: show what it found. Leaving it: the tags lift off into the writelist.
        const u = B ? easeInOut(clamp01(t / travelEnd)) : 0;
        tagsOf(A, (key, rule, x, y) => tags.push({ key, rule, x, y: y - 28 * u, scale: 1, opacity: 1 - u }));
    }
    if (batchB) {
        tagsOf(B!, (key, rule, x, y, m) => {
            const u = clamp01((t - foundTime(B!, m)) / 0.1);
            if (u > 0) tags.push({ key, rule, x, y: y + 6 * (1 - u), scale: 0.7 + 0.3 * u, opacity: u });
        });
    }

    const bounds = unionRects([
        ...classes.map(c => c.rect),
        ...sets.map(s => s.rect)
    ]) ?? { x: 0, y: 0, width: 0, height: 0 };

    return { sets, classes, nodes, edges, workers, tags, bounds };
}
