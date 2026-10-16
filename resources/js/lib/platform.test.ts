import { afterEach, describe, expect, it, vi } from 'vitest';
import { paletteShortcutHint } from './platform';

const stubNavigator = (value: object) =>
    vi.stubGlobal('navigator', { ...value });

describe('paletteShortcutHint', () => {
    afterEach(() => vi.unstubAllGlobals());

    it('reads Ctrl K on Windows and Linux', () => {
        stubNavigator({ platform: 'Win32' });
        expect(paletteShortcutHint()).toBe('Ctrl K');
        stubNavigator({ platform: 'Linux x86_64' });
        expect(paletteShortcutHint()).toBe('Ctrl K');
    });

    it('reads ⌘K on a Mac, by userAgentData or navigator.platform', () => {
        stubNavigator({ platform: 'MacIntel' });
        expect(paletteShortcutHint()).toBe('⌘K');
        stubNavigator({ userAgentData: { platform: 'macOS' }, platform: '' });
        expect(paletteShortcutHint()).toBe('⌘K');
    });

    it('prefers userAgentData over a stale platform string', () => {
        stubNavigator({
            userAgentData: { platform: 'Windows' },
            platform: 'MacIntel',
        });
        expect(paletteShortcutHint()).toBe('Ctrl K');
    });
});
