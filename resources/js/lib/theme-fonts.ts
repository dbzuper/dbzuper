import type { ThemeName } from '@/hooks/use-theme';

/** Loads a theme's self-hosted fonts the first time it is needed. Classic and Layered use the default fonts. */
export function loadThemeFonts(theme: ThemeName): void {
    // Graphite's fonts arrive in a later change.
    void theme;
}
