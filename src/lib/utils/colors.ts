/**
 * Identity colors for e-class / e-node IDs and color interpolation helpers.
 *
 * IDs are spread around the hue circle by the golden angle so that nearby IDs
 * (which are usually shown next to each other) get clearly distinct colors.
 */

const GOLDEN_ANGLE = 137.508;

function idHue(id: number | string): number {
    let n = typeof id === 'number' ? id : hashString(id);
    if (!Number.isFinite(n)) n = 0;
    return (((n * GOLDEN_ANGLE + 200) % 360) + 360) % 360;
}

function hashString(s: string): number {
    let hash = 0;
    for (let i = 0; i < s.length; i++) hash = (hash * 31 + s.charCodeAt(i)) | 0;
    return Math.abs(hash);
}

/** Saturated, readable-on-white color for an ID (text, borders). */
export function getColorForId(id: number | string): string {
    return hslToHex(idHue(id), 0.62, 0.42);
}

/** Light tint for an ID (backgrounds). */
export function getLightColorForId(id: number | string): string {
    return hslToHex(idHue(id), 0.75, 0.94);
}

export function hslToHex(h: number, s: number, l: number): string {
    const k = (n: number) => (n + h / 30) % 12;
    const a = s * Math.min(l, 1 - l);
    const f = (n: number) => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
    return rgbToHex([f(0) * 255, f(8) * 255, f(4) * 255]);
}

export function hexToRgb(hex: string): [number, number, number] {
    let h = hex.trim().replace('#', '');
    if (h.length === 3) h = h.split('').map(c => c + c).join('');
    const n = parseInt(h, 16);
    if (h.length !== 6 || Number.isNaN(n)) throw new Error(`Invalid hex color: ${hex}`);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

export function rgbToHex([r, g, b]: [number, number, number]): string {
    const c = (v: number) => Math.round(Math.max(0, Math.min(255, v))).toString(16).padStart(2, '0');
    return `#${c(r)}${c(g)}${c(b)}`;
}

/** Linear interpolation between two hex colors (returns hex). */
export function mixColor(a: string, b: string, t: number): string {
    if (t <= 0 || a === b) return a;
    if (t >= 1) return b;
    const [r1, g1, b1] = hexToRgb(a);
    const [r2, g2, b2] = hexToRgb(b);
    return rgbToHex([r1 + (r2 - r1) * t, g1 + (g2 - g1) * t, b1 + (b2 - b1) * t]);
}

/**
 * Interpolate between two colors using CSS color-mix (works for any CSS color).
 */
export function interpolateColor(color1: string, color2: string, progress: number): string {
    if (progress <= 0.01) return color1;
    if (progress >= 0.99) return color2;
    const p1 = Math.round((1 - progress) * 100);
    const p2 = Math.round(progress * 100);
    return `color-mix(in srgb, ${color1} ${p1}%, ${color2} ${p2}%)`;
}

/**
 * Linearly interpolate between two opacity values.
 */
export function interpolateOpacity(opacity1: number, opacity2: number, progress: number): number {
    return opacity1 + (opacity2 - opacity1) * progress;
}
