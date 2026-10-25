import type { LucideIcon } from 'lucide-react';
import { Monitor, Moon, Palette, Sun } from 'lucide-react';
import { useId } from 'react';
import type { ReactNode } from 'react';
import { Button } from '@/components/ui/button';
import {
    Popover,
    PopoverContent,
    PopoverTrigger,
} from '@/components/ui/popover';
import type { Appearance } from '@/hooks/use-appearance';
import { useAppearance } from '@/hooks/use-appearance';
import { useRovingRadios } from '@/hooks/use-roving-radios';
import type { ThemeName } from '@/hooks/use-theme';
import { THEMES, useColorTheme } from '@/hooks/use-theme';
import { cn } from '@/lib/utils';

const MODES: readonly { value: Appearance; label: string; icon: LucideIcon }[] =
    [
        { value: 'light', label: 'Light', icon: Sun },
        { value: 'dark', label: 'Dark', icon: Moon },
        { value: 'system', label: 'System', icon: Monitor },
    ];

const THEME_NAMES = THEMES.map((t) => t.name);
const MODE_VALUES = MODES.map((m) => m.value);

/**
 * Three dots in a theme's own colours: the wrapper's data-theme re-declares the tokens, and the mode
 * cascades in from the page (`.dark [data-theme=…]`).
 */
export function ThemeSwatch({ theme }: { theme: ThemeName }) {
    return (
        <span
            data-theme={theme}
            aria-hidden
            className="inline-flex shrink-0 items-center gap-0.5 rounded-full border border-border bg-background p-0.5"
        >
            <span className="size-2.5 rounded-full border border-border bg-background" />
            <span className="size-2.5 rounded-full border border-sidebar-border bg-sidebar" />
            <span className="size-2.5 rounded-full bg-primary" />
        </span>
    );
}

const radioClass = (checked: boolean) =>
    cn(
        'flex flex-1 items-center justify-center gap-1.5 rounded-md px-2 py-1.5 text-xs transition-colors',
        checked
            ? 'bg-card text-foreground shadow-xs ring-1 ring-border'
            : 'text-muted-foreground hover:bg-accent hover:text-foreground',
    );

function Group({ label, children }: { label: string; children: ReactNode }) {
    const id = useId();

    return (
        <div className="space-y-1.5">
            <div id={id} className="text-xs font-medium text-muted-foreground">
                {label}
            </div>
            <div
                role="radiogroup"
                aria-labelledby={id}
                className="flex gap-1 rounded-lg bg-muted p-1"
            >
                {children}
            </div>
        </div>
    );
}

/** The header's appearance control: pick a colour theme and a light/dark mode; changes apply at once. */
export function AppearanceMenu({ className }: { className?: string }) {
    const { theme, updateTheme } = useColorTheme();
    const { appearance, updateAppearance } = useAppearance();
    const themeRadio = useRovingRadios(THEME_NAMES, theme);
    const modeRadio = useRovingRadios(MODE_VALUES, appearance);

    return (
        <Popover>
            <PopoverTrigger asChild>
                <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className={className}
                    aria-label="Appearance"
                >
                    <Palette className="size-4" />
                </Button>
            </PopoverTrigger>
            <PopoverContent align="end" className="w-80 space-y-3 p-3">
                <Group label="Theme">
                    {THEMES.map(({ name, label }, i) => (
                        <button
                            key={name}
                            type="button"
                            role="radio"
                            aria-checked={theme === name}
                            className={cn(
                                radioClass(theme === name),
                                'flex-col',
                            )}
                            onClick={() => updateTheme(name)}
                            {...themeRadio(i)}
                        >
                            <ThemeSwatch theme={name} />
                            {label}
                        </button>
                    ))}
                </Group>
                <Group label="Mode">
                    {MODES.map(({ value, label, icon: Icon }, i) => (
                        <button
                            key={value}
                            type="button"
                            role="radio"
                            aria-checked={appearance === value}
                            className={radioClass(appearance === value)}
                            onClick={() => updateAppearance(value)}
                            {...modeRadio(i)}
                        >
                            <Icon className="size-3.5" />
                            {label}
                        </button>
                    ))}
                </Group>
            </PopoverContent>
        </Popover>
    );
}
