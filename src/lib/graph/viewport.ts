import type { Rect } from '../engine/types';

/** screen = world * k + (x, y) */
export interface Viewport {
    x: number;
    y: number;
    k: number;
}

export const MIN_ZOOM = 0.05;
export const MAX_ZOOM = 3;
/** Never zoom in further than this when fitting (small graphs stay readable, not huge). */
export const MAX_FIT_ZOOM = 1.5;

export function clampZoom(k: number): number {
    return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, k));
}

/** Viewport that shows `bounds` centered in a `width` x `height` screen. */
export function fitViewport(bounds: Rect, width: number, height: number, padding = 40, maxZoom = MAX_FIT_ZOOM): Viewport {
    if (width <= 0 || height <= 0) return { x: 0, y: 0, k: 1 };
    const bw = Math.max(bounds.width, 1);
    const bh = Math.max(bounds.height, 1);
    const k = clampZoom(Math.min((width - 2 * padding) / bw, (height - 2 * padding) / bh, maxZoom));
    return {
        k,
        x: width / 2 - (bounds.x + bw / 2) * k,
        y: height / 2 - (bounds.y + bh / 2) * k
    };
}

/** Zoom by `factor` keeping the screen point (cx, cy) fixed. */
export function zoomAt(v: Viewport, factor: number, cx: number, cy: number): Viewport {
    const k = clampZoom(v.k * factor);
    const f = k / v.k;
    return { k, x: cx - (cx - v.x) * f, y: cy - (cy - v.y) * f };
}

export function lerpViewport(a: Viewport, b: Viewport, t: number): Viewport {
    // Interpolate zoom geometrically so zooming feels uniform
    const k = a.k * Math.pow(b.k / a.k, t);
    return { k, x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
}

/** World-space rectangle visible on screen. */
export function visibleWorldRect(v: Viewport, width: number, height: number): Rect {
    return { x: -v.x / v.k, y: -v.y / v.k, width: width / v.k, height: height / v.k };
}

/**
 * Should a "follow" camera move to show `bounds`? Yes when part of it is
 * off-screen, or when it has become much smaller than the screen.
 */
export function needsRefit(v: Viewport, bounds: Rect, width: number, height: number, margin = 12): boolean {
    const ideal = fitViewport(bounds, width, height);
    // Already showing the best possible fit (e.g. clamped at MIN_ZOOM): nothing to do
    if (viewportEquals(v, ideal, 1)) return false;
    const vis = visibleWorldRect(v, width, height);
    const m = margin / v.k;
    const outside =
        bounds.x < vis.x + m ||
        bounds.y < vis.y + m ||
        bounds.x + bounds.width > vis.x + vis.width - m ||
        bounds.y + bounds.height > vis.y + vis.height - m;
    if (outside) return true;
    return ideal.k > v.k * 1.6;
}

export function viewportEquals(a: Viewport, b: Viewport, eps = 0.5): boolean {
    return Math.abs(a.x - b.x) < eps && Math.abs(a.y - b.y) < eps && Math.abs(a.k - b.k) < 1e-3;
}
