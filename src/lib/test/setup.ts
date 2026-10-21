/**
 * Global test setup: DOM matchers and the browser APIs jsdom lacks.
 */
import '@testing-library/jest-dom/vitest';

if (typeof window !== 'undefined') {
    if (!('ResizeObserver' in window)) {
        class ResizeObserverStub {
            observe() {}
            unobserve() {}
            disconnect() {}
        }
        (globalThis as any).ResizeObserver = ResizeObserverStub;
    }
    if (!Element.prototype.scrollIntoView) {
        Element.prototype.scrollIntoView = () => {};
    }
    if (!window.matchMedia) {
        window.matchMedia = ((query: string) => ({
            matches: false,
            media: query,
            onchange: null,
            addEventListener() {},
            removeEventListener() {},
            addListener() {},
            removeListener() {},
            dispatchEvent: () => false
        })) as typeof window.matchMedia;
    }
    // jsdom has no 2D canvas (and logs an error when asked for one)
    HTMLCanvasElement.prototype.getContext = (() => null) as typeof HTMLCanvasElement.prototype.getContext;
}
