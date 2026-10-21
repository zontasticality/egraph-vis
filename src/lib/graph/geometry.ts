/**
 * Shared sizing rules for the graph view. The layout engine (ELK) and the
 * renderer must agree on these, so they live in one place.
 */
import type { Rect } from '../engine/types';

export const NODE_HEIGHT = 32;
const NODE_MIN_WIDTH = 34;
const CHAR_WIDTH = 8.6; // 14px bold monospace
const PORT_GAP = 14;

/** Padding inside e-class boxes (top leaves room for the id label). */
export const CLASS_PADDING = { top: 22, right: 10, bottom: 10, left: 10 };
/** Padding inside union-find set boxes (deferred mode, pending merges). */
export const SET_PADDING = { top: 24, right: 10, bottom: 10, left: 10 };

export function nodeWidth(op: string, arity: number): number {
    return Math.max(NODE_MIN_WIDTH, Math.ceil(op.length * CHAR_WIDTH + 18), (arity + 1) * PORT_GAP);
}

/** X offset (relative to the node's left edge) of argument port `i`. */
export function portOffset(width: number, arity: number, i: number): number {
    return (width * (i + 1)) / (arity + 1);
}

export function lerp(a: number, b: number, t: number): number {
    return a + (b - a) * t;
}

export function lerpRect(a: Rect, b: Rect, t: number): Rect {
    if (t <= 0) return a;
    if (t >= 1) return b;
    return {
        x: lerp(a.x, b.x, t),
        y: lerp(a.y, b.y, t),
        width: lerp(a.width, b.width, t),
        height: lerp(a.height, b.height, t)
    };
}

export function unionRects(rects: Rect[]): Rect | undefined {
    if (rects.length === 0) return undefined;
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const r of rects) {
        x0 = Math.min(x0, r.x);
        y0 = Math.min(y0, r.y);
        x1 = Math.max(x1, r.x + r.width);
        y1 = Math.max(y1, r.y + r.height);
    }
    return { x: x0, y: y0, width: x1 - x0, height: y1 - y0 };
}

export function padRect(r: Rect, p: { top: number; right: number; bottom: number; left: number }): Rect {
    return { x: r.x - p.left, y: r.y - p.top, width: r.width + p.left + p.right, height: r.height + p.top + p.bottom };
}

export function containsPoint(r: Rect, x: number, y: number): boolean {
    return x >= r.x && x <= r.x + r.width && y >= r.y && y <= r.y + r.height;
}

export function rectCenter(r: Rect): { x: number; y: number } {
    return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
}
