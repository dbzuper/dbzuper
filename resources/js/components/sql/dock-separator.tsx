import { useRef } from 'react';
import {
    DOCK_MAX_HEIGHT,
    DOCK_MIN_HEIGHT,
    useWorkspace,
} from '@/universe/store';

/** One Arrow press moves the dock edge by this many px. */
const KEY_STEP = 24;

/** The drag handle above the SQL dock. It is also a keyboard-operable separator. */
export function DockSeparator() {
    const height = useWorkspace((s) => s.dockHeight);
    const setHeight = useWorkspace((s) => s.setDockHeight);
    const drag = useRef<{ y: number; height: number } | null>(null);

    const onPointerDown = (e: React.PointerEvent) => {
        drag.current = {
            y: e.clientY,
            height: useWorkspace.getState().dockHeight,
        };
        (e.target as HTMLElement).setPointerCapture(e.pointerId);
    };
    const onPointerMove = (e: React.PointerEvent) => {
        if (!drag.current) return;
        setHeight(drag.current.height + (drag.current.y - e.clientY));
    };
    const onPointerEnd = () => {
        drag.current = null;
    };
    // The dock grows upwards, so Arrow Up moves the separator up (taller dock).
    const onKeyDown = (e: React.KeyboardEvent) => {
        if (e.key !== 'ArrowUp' && e.key !== 'ArrowDown') return;
        e.preventDefault();
        const current = useWorkspace.getState().dockHeight;
        setHeight(current + (e.key === 'ArrowUp' ? KEY_STEP : -KEY_STEP));
    };

    return (
        <div
            role="separator"
            tabIndex={0}
            aria-orientation="horizontal"
            aria-label="Resize SQL editor"
            aria-valuenow={height}
            aria-valuemin={DOCK_MIN_HEIGHT}
            aria-valuemax={DOCK_MAX_HEIGHT}
            className="h-1.5 cursor-row-resize bg-border/60 hover:bg-[var(--universe-accent)]"
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerEnd}
            onPointerCancel={onPointerEnd}
            onLostPointerCapture={onPointerEnd}
            onKeyDown={onKeyDown}
        />
    );
}
