// Inertia treats every history entry that carries its `page` as its own and re-mounts the
// page on Back/Forward. A listener on `window` fires in registration order (capture does not
// help on the window itself), so the guard has to be installed before Inertia starts. It does
// nothing until a page registers a handler; a handler returns true when it applied the entry,
// and Inertia's own listener then never sees the event.
type Handler = (event: PopStateEvent) => boolean;

let handler: Handler | null = null;

if (typeof window !== 'undefined') {
    window.addEventListener('popstate', (event) => {
        if (handler?.(event)) event.stopImmediatePropagation();
    });
}

export function setPopstateHandler(next: Handler | null) {
    handler = next;
}
