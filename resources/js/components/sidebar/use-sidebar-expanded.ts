import { useSidebar } from '@/components/ui/sidebar';

/** False while the desktop sidebar is collapsed to icons; the mobile sheet always shows in full. */
export function useSidebarExpanded(): boolean {
    const { state, isMobile } = useSidebar();
    return isMobile || state === 'expanded';
}

/** The colour of a connection's dot, falling back to the universe accent. */
export const dotColor = (color: string | null) =>
    color ?? 'var(--universe-accent)';
