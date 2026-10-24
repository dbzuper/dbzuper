import { useRovingRadios } from '@/hooks/use-roving-radios';
import type { ThemeName } from '@/hooks/use-theme';
import { THEMES, useColorTheme } from '@/hooks/use-theme';
import { cn } from '@/lib/utils';

const THEME_NAMES = THEMES.map((t) => t.name);

/**
 * A miniature workspace in a theme's own colours and shell (canvas, gap, radius, shadow at a third of
 * their size): a sidebar strip, three grid rows and a status bar. It has no text, so Graphite's fonts
 * need not be loaded for it.
 */
function ThemeMiniature({ theme }: { theme: ThemeName }) {
    return (
        <span
            data-theme={theme}
            aria-hidden
            className="flex h-24 gap-[calc(var(--shell-gap)/3)] overflow-hidden rounded-md border border-border bg-shell p-[calc(var(--shell-gap)/3)]"
        >
            <span className="w-1/4 rounded-[calc(var(--panel-radius)/3)] border-r border-[var(--chrome-edge)] bg-sidebar shadow-[var(--sidebar-shadow)]">
                <span className="m-1.5 block h-1 w-2/3 rounded-full bg-sidebar-primary" />
                <span className="mx-1.5 block h-1 w-1/2 rounded-full bg-sidebar-accent" />
            </span>
            <span className="flex flex-1 flex-col overflow-hidden rounded-[calc(var(--panel-radius)/3)] bg-background shadow-[var(--panel-shadow)]">
                <span className="flex-1 space-y-1 p-1.5">
                    <span className="block h-2 rounded-sm bg-muted" />
                    <span className="block h-2 rounded-sm border border-border bg-card" />
                    <span className="flex h-2 gap-1">
                        <span className="w-1/3 rounded-sm bg-primary" />
                        <span className="flex-1 rounded-sm bg-muted" />
                    </span>
                </span>
                <span className="block h-2 border-t border-border bg-sidebar" />
            </span>
        </span>
    );
}

/** The settings page's theme picker: one miniature per theme; a click applies it at once. */
export function ThemeCards({ className }: { className?: string }) {
    const { theme, updateTheme } = useColorTheme();
    const radio = useRovingRadios(THEME_NAMES, theme);

    return (
        <div
            role="radiogroup"
            aria-label="Theme"
            className={cn('grid max-w-xl grid-cols-3 gap-3', className)}
        >
            {THEMES.map(({ name, label }, i) => (
                <button
                    key={name}
                    type="button"
                    role="radio"
                    aria-checked={theme === name}
                    onClick={() => updateTheme(name)}
                    className={cn(
                        'space-y-2 rounded-lg p-1.5 text-left transition-colors',
                        theme === name
                            ? 'ring-2 ring-primary'
                            : 'ring-1 ring-border hover:bg-accent',
                    )}
                    {...radio(i)}
                >
                    <ThemeMiniature theme={name} />
                    <span className="block px-0.5 text-sm font-medium">
                        {label}
                    </span>
                </button>
            ))}
        </div>
    );
}
