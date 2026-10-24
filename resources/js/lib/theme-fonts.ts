import fontsUrl from '../../css/fonts-graphite.css?url';
import type { ThemeName } from '@/hooks/use-theme';

/** Loads a theme's self-hosted fonts the first time it is needed. Classic and Layered use the default fonts. */
export function loadThemeFonts(theme: ThemeName): void {
    if (theme !== 'graphite' || typeof document === 'undefined') {
        return;
    }

    // Blade already linked it on first paint when the cookie said Graphite, or an earlier switch did.
    if (
        document.querySelector(
            'link[data-theme-fonts="graphite"], link[rel="stylesheet"][href*="fonts-graphite"]',
        )
    ) {
        return;
    }

    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = fontsUrl;
    link.dataset.themeFonts = 'graphite';
    document.head.append(link);
}
