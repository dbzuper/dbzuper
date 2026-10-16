import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { afterEach } from 'vitest';

afterEach(() => cleanup());

// jsdom lacks these browser APIs, which cmdk relies on.
globalThis.ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
};
if (!('scrollIntoView' in Element.prototype)) {
    Object.defineProperty(Element.prototype, 'scrollIntoView', {
        value: function scrollIntoView(this: void) {},
        configurable: true,
        writable: true,
    });
}
// jsdom has no matchMedia; default to "no match" (tests override as needed).
window.matchMedia ??= ((query: string) => ({
    matches: false,
    media: query,
    addEventListener: () => {},
    removeEventListener: () => {},
})) as unknown as typeof window.matchMedia;
