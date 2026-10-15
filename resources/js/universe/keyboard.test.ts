import { beforeEach, describe, expect, it } from 'vitest';
import { escapeHandledElsewhere, handleEscape } from './keyboard';
import { useWorkspace } from './store';

const s = () => useWorkspace.getState();

describe('handleEscape', () => {
    beforeEach(() => s().reset());

    it('clears path, then focus, then selection', () => {
        s().select('a');
        s().setFocus('a');
        s().startPath('a');
        expect(handleEscape(s())).toBe(true);
        expect(s().pathFrom).toBeNull();
        expect(handleEscape(s())).toBe(true);
        expect(s().focus).toBeNull();
        expect(handleEscape(s())).toBe(true);
        expect(s().selected).toBeNull();
        expect(handleEscape(s())).toBe(false);
    });
});

describe('escapeHandledElsewhere', () => {
    const escapeOn = (target: EventTarget, prevent = false) => {
        let seen: KeyboardEvent | null = null;
        const grab = (e: Event) => (seen = e as KeyboardEvent);
        window.addEventListener('keydown', grab);
        const e = new KeyboardEvent('keydown', {
            key: 'Escape',
            bubbles: true,
            cancelable: true,
        });
        if (prevent) e.preventDefault();
        target.dispatchEvent(e);
        window.removeEventListener('keydown', grab);
        return seen!;
    };

    it('defers to layers that already handled the key', () => {
        expect(escapeHandledElsewhere(escapeOn(document.body, true))).toBe(
            true,
        );
    });

    it('ignores Escape typed into text fields', () => {
        for (const tag of ['input', 'textarea', 'select']) {
            const el = document.body.appendChild(document.createElement(tag));
            expect(escapeHandledElsewhere(escapeOn(el))).toBe(true);
            el.remove();
        }
        const editable = document.body.appendChild(
            document.createElement('div'),
        );
        editable.setAttribute('contenteditable', 'true');
        expect(escapeHandledElsewhere(escapeOn(editable))).toBe(true);
        editable.remove();
    });

    it('handles Escape elsewhere on the page', () => {
        const button = document.body.appendChild(
            document.createElement('button'),
        );
        expect(escapeHandledElsewhere(escapeOn(button))).toBe(false);
        button.remove();
    });
});
