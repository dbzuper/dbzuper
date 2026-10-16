import { describe, expect, it } from 'vitest';
import { browseKeyAction, isTypingTarget } from './shortcuts';

const key = (
    key: string,
    mods: Partial<{
        ctrlKey: boolean;
        metaKey: boolean;
        altKey: boolean;
        shiftKey: boolean;
        code: string;
        repeat: boolean;
    }> = {},
) => ({
    key,
    ctrlKey: false,
    metaKey: false,
    altKey: false,
    shiftKey: false,
    ...mods,
});
const idle = { typing: false, tableTabActive: true };
const typing = { typing: true, tableTabActive: true };

describe('browseKeyAction', () => {
    it('maps the global shortcuts even while typing', () => {
        expect(browseKeyAction(key('p', { ctrlKey: true }), typing)).toEqual({
            type: 'quickOpen',
        });
        expect(browseKeyAction(key('P', { metaKey: true }), typing)).toEqual({
            type: 'quickOpen',
        });
        expect(browseKeyAction(key('b', { ctrlKey: true }), typing)).toEqual({
            type: 'toggleSidebar',
        });
    });
    it('ignores tab and search keys while typing', () => {
        expect(browseKeyAction(key('/'), typing)).toBeNull();
        expect(browseKeyAction(key('w', { altKey: true }), typing)).toBeNull();
        expect(browseKeyAction(key('/'), idle)).toEqual({
            type: 'focusSearch',
        });
    });
    it('maps tab navigation with Alt', () => {
        expect(browseKeyAction(key('w', { altKey: true }), idle)).toEqual({
            type: 'closeTab',
        });
        expect(
            browseKeyAction(key('w', { altKey: true, repeat: true }), idle),
        ).toBeNull();
        expect(
            browseKeyAction(key('¡', { altKey: true, code: 'Digit1' }), idle),
        ).toEqual({ type: 'jumpTab', index: 0 });
        expect(
            browseKeyAction(key('PageDown', { altKey: true }), idle),
        ).toEqual({ type: 'cycleTab', dir: 1 });
        expect(browseKeyAction(key('PageUp', { altKey: true }), idle)).toEqual({
            type: 'cycleTab',
            dir: -1,
        });
    });
    it('takes Ctrl+F only on a table tab', () => {
        expect(browseKeyAction(key('f', { ctrlKey: true }), idle)).toEqual({
            type: 'focusFilter',
        });
        expect(
            browseKeyAction(key('f', { ctrlKey: true }), {
                typing: false,
                tableTabActive: false,
            }),
        ).toBeNull();
    });
    it('leaves Ctrl+F to the browser while typing', () => {
        expect(browseKeyAction(key('f', { ctrlKey: true }), typing)).toBeNull();
    });
    it('leaves other keys alone', () => {
        expect(browseKeyAction(key('a'), idle)).toBeNull();
        expect(
            browseKeyAction(key('p', { ctrlKey: true, altKey: true }), idle),
        ).toBeNull();
    });
});

describe('isTypingTarget', () => {
    it('recognises inputs, textareas, selects, contenteditable and Monaco', () => {
        const input = document.createElement('input');
        const div = document.createElement('div');
        div.contentEditable = 'true';
        const monaco = document.createElement('div');
        monaco.className = 'monaco-editor';
        const inner = document.createElement('textarea');
        monaco.appendChild(inner);
        expect(
            [
                input,
                document.createElement('textarea'),
                document.createElement('select'),
                div,
                inner,
            ].every(isTypingTarget),
        ).toBe(true);
        expect(isTypingTarget(document.createElement('button'))).toBe(false);
        expect(isTypingTarget(null)).toBe(false);
    });
});
