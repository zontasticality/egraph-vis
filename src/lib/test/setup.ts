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
}
