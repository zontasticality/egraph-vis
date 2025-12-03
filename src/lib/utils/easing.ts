/**
 * Easing functions for animations.
 * 
 * All easing functions take a value t in [0, 1] and return an eased value in [0, 1].
 * See https://easings.net/ for visualizations.
 */

/**
 * Exponential ease-in: stays close to 0 until late in the transition.
 * Makes transitions feel more responsive - they "stick" to current state longer.
 * 
 * @param t Progress value from 0 to 1
 * @returns Eased value from 0 to 1
 */
export function easeInExpo(t: number): number {
    if (t <= 0) return 0;
    if (t >= 1) return 1;
    // Exponential: 2^(10(t-1))
    // At t=0.5, this gives ~0.03 (still very close to start)
    // At t=0.8, this gives ~0.25
    // At t=0.95, this gives ~0.76
    return Math.pow(2, 10 * (t - 1));
}

/**
 * Exponential ease-out: fast start, slow end.
 * 
 * @param t Progress value from 0 to 1
 * @returns Eased value from 0 to 1
 */
export function easeOutExpo(t: number): number {
    if (t <= 0) return 0;
    if (t >= 1) return 1;
    return 1 - Math.pow(2, -10 * t);
}

/**
 * Exponential ease-in-out: slow start, fast middle, slow end.
 * 
 * @param t Progress value from 0 to 1
 * @returns Eased value from 0 to 1
 */
export function easeInOutExpo(t: number): number {
    if (t <= 0) return 0;
    if (t >= 1) return 1;

    if (t < 0.5) {
        return Math.pow(2, 20 * t - 10) / 2;
    }
    return (2 - Math.pow(2, -20 * t + 10)) / 2;
}

/**
 * Linear easing (no easing).
 * 
 * @param t Progress value from 0 to 1
 * @returns Same value (no transformation)
 */
export function linear(t: number): number {
    return Math.max(0, Math.min(1, t));
}
