// Simple hash function to map IDs to a color palette
export function getColorForId(id: number | string): string {
    const colors = [
        '#ef4444', // red-500
        '#f97316', // orange-500
        '#eab308', // yellow-500
        '#22c55e', // green-500
        '#06b6d4', // cyan-500
        '#3b82f6', // blue-500
        '#8b5cf6', // violet-500
        '#d946ef', // fuchsia-500
        '#f43f5e', // rose-500
    ];

    const strId = String(id);
    let hash = 0;
    for (let i = 0; i < strId.length; i++) {
        hash = strId.charCodeAt(i) + ((hash << 5) - hash);
    }

    const index = Math.abs(hash) % colors.length;
    return colors[index];
}

export function getLightColorForId(id: number | string): string {
    // Lighter versions for backgrounds
    const colors = [
        '#fee2e2', // red-100
        '#ffedd5', // orange-100
        '#fef9c3', // yellow-100
        '#dcfce7', // green-100
        '#cffafe', // cyan-100
        '#dbeafe', // blue-100
        '#ede9fe', // violet-100
        '#fae8ff', // fuchsia-100
        '#ffe4e6', // rose-100
    ];

    const strId = String(id);
    let hash = 0;
    for (let i = 0; i < strId.length; i++) {
        hash = strId.charCodeAt(i) + ((hash << 5) - hash);
    }

    const index = Math.abs(hash) % colors.length;
    return colors[index];
}

/**
 * Interpolate between two colors using CSS color-mix (GPU-accelerated).
 * 
 * @param color1 Starting color (CSS color string)
 * @param color2 Ending color (CSS color string)
 * @param progress Interpolation progress from 0 to 1
 * @returns CSS color-mix expression
 */
export function interpolateColor(
    color1: string,
    color2: string,
    progress: number,
): string {
    if (progress <= 0.01) return color1;
    if (progress >= 0.99) return color2;

    // Convert progress to percentage
    const p1 = Math.round((1 - progress) * 100);
    const p2 = Math.round(progress * 100);

    // Use CSS color-mix for GPU-accelerated blending
    return `color-mix(in srgb, ${color1} ${p1}%, ${color2} ${p2}%)`;
}

/**
 * Linearly interpolate between two opacity values.
 * 
 * @param opacity1 Starting opacity (0-1)
 * @param opacity2 Ending opacity (0-1)
 * @param progress Interpolation progress from 0 to 1
 * @returns Interpolated opacity value
 */
export function interpolateOpacity(
    opacity1: number,
    opacity2: number,
    progress: number,
): number {
    return opacity1 + (opacity2 - opacity1) * progress;
}
