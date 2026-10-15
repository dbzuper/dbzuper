import type { UniverseSigma } from './universe-canvas';

/** A press on a card that moves less than this is a click (select); further is a pan. */
export const CLICK_SLOP_PX = 4;

/**
 * Lets a drag that starts on a close-up card pan the camera, the way it would on the bare stage.
 *
 * The camera is moved directly rather than by forwarding the pointer events to Sigma's mouse layer:
 * a forwarded press is hit-tested by Sigma, and since every card is centred on its node, a press
 * near a card's middle would start dragging (and pinning) that node instead of panning.
 * Returns a detach function.
 */
export function attachCardPan(
    el: HTMLElement,
    sigma: UniverseSigma,
): () => void {
    let press: { id: number; x: number; y: number } | null = null;
    let last = { x: 0, y: 0 };
    let panning = false;
    let swallowClick = false;

    const down = (e: PointerEvent) => {
        if (e.button !== 0 || e.pointerType === 'touch') return;
        press = { id: e.pointerId, x: e.clientX, y: e.clientY };
        last = { x: e.clientX, y: e.clientY };
        panning = false;
        swallowClick = false;
    };

    const move = (e: PointerEvent) => {
        if (!press || e.pointerId !== press.id) return;
        if (!panning) {
            if (
                Math.hypot(e.clientX - press.x, e.clientY - press.y) <
                CLICK_SLOP_PX
            )
                return;
            panning = true;
            // Keep receiving moves if the pointer outruns the card. Capture on the card itself: the
            // wrapper inherits pointer-events: none from the overlay.
            const target = e.target;
            if (
                target instanceof Element &&
                typeof target.setPointerCapture === 'function' &&
                e.pointerId !== undefined
            )
                target.setPointerCapture(e.pointerId);
        }
        // Same arithmetic as Sigma's own stage drag: the graph point under the pointer stays put.
        const from = sigma.viewportToFramedGraph(last);
        const to = sigma.viewportToFramedGraph({ x: e.clientX, y: e.clientY });
        const camera = sigma.getCamera();
        const state = camera.getState();
        camera.setState({
            x: state.x + from.x - to.x,
            y: state.y + from.y - to.y,
        });
        last = { x: e.clientX, y: e.clientY };
    };

    const up = (e: PointerEvent) => {
        if (!press || e.pointerId !== press.id) return;
        press = null;
        swallowClick = panning;
        panning = false;
    };

    // Capture phase on the wrapper, so the card's own click handler never sees a pan's click.
    const click = (e: MouseEvent) => {
        if (!swallowClick) return;
        swallowClick = false;
        e.stopPropagation();
        e.preventDefault();
    };

    el.addEventListener('pointerdown', down);
    el.addEventListener('pointermove', move);
    el.addEventListener('pointerup', up);
    el.addEventListener('pointercancel', up);
    el.addEventListener('click', click, true);
    return () => {
        el.removeEventListener('pointerdown', down);
        el.removeEventListener('pointermove', move);
        el.removeEventListener('pointerup', up);
        el.removeEventListener('pointercancel', up);
        el.removeEventListener('click', click, true);
    };
}
