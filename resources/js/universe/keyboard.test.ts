import { beforeEach, describe, expect, it } from 'vitest';
import { handleEscape } from './keyboard';
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
