import { Moon, Monitor, Sun } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { nextAppearance, useAppearance } from '@/hooks/use-appearance';
import type { Appearance } from '@/hooks/use-appearance';

const icons: Record<Appearance, typeof Sun> = {
    dark: Moon,
    light: Sun,
    system: Monitor,
};

/** Cycles the theme dark → light → system; the label names the next state. */
export function ThemeToggle({ className }: { className?: string }) {
    const { appearance, updateAppearance } = useAppearance();
    const Icon = icons[appearance];

    return (
        <Button
            type="button"
            variant="ghost"
            size="icon"
            className={className}
            aria-label={`Theme: ${appearance} (switch to ${nextAppearance(appearance)})`}
            onClick={() => updateAppearance(nextAppearance(appearance))}
        >
            <Icon className="size-4" />
        </Button>
    );
}
