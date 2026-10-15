import type { UniverseColors } from './reducers';

const read = (style: CSSStyleDeclaration, name: string, fallback: string) =>
    style.getPropertyValue(name).trim() || fallback;

export function readUniverseColors(el: HTMLElement): UniverseColors {
    const s = getComputedStyle(el);
    return {
        accent: read(s, '--universe-accent', '#2dd4bf'),
        dimNode: read(s, '--universe-node-dim', '#1f2633'),
        edge: read(s, '--universe-edge', 'rgba(148,163,184,0.32)'),
        edgeInferred: read(
            s,
            '--universe-edge-inferred',
            'rgba(148,163,184,0.14)',
        ),
        edgeDim: read(s, '--universe-edge-dim', 'rgba(148,163,184,0.05)'),
        label: read(s, '--universe-label', '#e2e8f0'),
        background: read(s, '--universe-bg', '#0b0e14'),
    };
}
