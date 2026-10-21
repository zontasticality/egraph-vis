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
 */
import type { EGraphState, LayoutData, Rect, Phase, EClassViewModel } from '../engine/types';
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

export interface Frame {
    sets: FrameSet[];
    classes: FrameClass[];
    nodes: FrameNode[];
    edges: FrameEdge[];
    bounds: Rect;
}

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

    // --- e-classes ---
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
            rect = lerpRect(shrink(end, 0.6), end, t);
            opacity = t;
        }

        const lookA = inA ? classLook(A, id) : null;
        const lookB = inB ? classLook(B!, id) : null;
        const from = lookA ?? lookB!;
        const to = lookB ?? lookA!;
        classes.push({
            id,
            canonical: canonicalOf(B && t >= 0.5 && inB ? B : A, id),
            rect,
            opacity: opacity * lerp(from.opacity, to.opacity, t),
            fill: mixColor(from.fill, to.fill, t),
            stroke: mixColor(from.stroke, to.stroke, t),
            strokeWidth: lerp(from.strokeWidth, to.strokeWidth, t),
            dashed: t < 0.5 ? from.dashed : to.dashed,
            style: t < 0.5 ? from.style : to.style
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
            rect = lerpRect(start, rectB!, t);
            opacity = t;
        }
        sets.push({ id, members: (membersB ?? membersA)!, rect, opacity });
    }

    // --- e-nodes ---
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
            rect = lerpRect(shrink(rb!, 0.4), rb!, Math.min(1, t * 1.5));
            opacity = t;
        }

        const styleA = ea ? nodeStyleOf(A, id) : undefined;
        const styleB = eb ? nodeStyleOf(B!, id) : undefined;
        const from = NODE_STYLES[styleA ?? styleB!];
        const to = NODE_STYLES[styleB ?? styleA!];
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
            fill: mixColor(from.fill, to.fill, t),
            stroke: mixColor(from.stroke, to.stroke, t),
            text: mixColor(from.text, to.text, t),
            dashed: t < 0.5 ? from.dashed : to.dashed,
            style: (t < 0.5 ? styleA ?? styleB : styleB ?? styleA)!
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

    const bounds = unionRects([
        ...classes.map(c => c.rect),
        ...sets.map(s => s.rect)
    ]) ?? { x: 0, y: 0, width: 0, height: 0 };

    return { sets, classes, nodes, edges, bounds };
}
