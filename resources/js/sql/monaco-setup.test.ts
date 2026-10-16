import type * as Monaco from 'monaco-editor';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { defineThemes, disposeClosedModels, toHex } from './monaco-setup';

/** A 2D context that accepts hex and oklch() colours, like a browser would, and reports the given pixel. */
function stubCanvas(pixel: [number, number, number], alpha = 255) {
    let fill = '#000000';
    const ctx = {
        clearRect: () => {},
        fillRect: () => {},
        getImageData: () => ({ data: [...pixel, alpha] }),
        get fillStyle() {
            return fill;
        },
        set fillStyle(v: string) {
            if (v === '#000') fill = '#000000';
            else if (v === '#fff') fill = '#ffffff';
            else if (/^(#[0-9a-f]{6}|oklch\(.*\))$/i.test(v)) fill = v;
        },
    };
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(
        ctx as unknown as CanvasRenderingContext2D,
    );
}

afterEach(() => vi.restoreAllMocks());

describe('toHex', () => {
    it('converts a colour the browser accepts', () => {
        stubCanvas([1, 2, 255]);
        expect(toHex('oklch(0.5 0.1 200)', '#abcdef')).toBe('#0102ff');
    });

    it('keeps the alpha of a translucent colour', () => {
        stubCanvas([255, 255, 255], 26);
        expect(toHex('oklch(1 0 0 / 10%)', '#abcdef')).toBe('#ffffff1a');
    });

    it('returns the fallback, not black, for a colour the browser rejects', () => {
        stubCanvas([0, 0, 0]);
        expect(toHex('not-a-colour(1)', '#abcdef')).toBe('#abcdef');
    });

    it('still converts real black', () => {
        stubCanvas([0, 0, 0]);
        expect(toHex('#000000', '#abcdef')).toBe('#000000');
    });
});

describe('disposeClosedModels', () => {
    it('disposes the models of tabs that are gone and keeps the rest', () => {
        const disposed: string[] = [];
        const monaco = {
            Uri: { parse: (path: string) => ({ path }) },
            editor: {
                getModel: (uri: { path: string }) =>
                    uri.path === 'missing'
                        ? null
                        : { dispose: () => disposed.push(uri.path) },
            },
        } as unknown as typeof Monaco;

        disposeClosedModels(monaco, ['a', 'b', 'missing'], ['a', 'c']);

        expect(disposed).toEqual(['b']);
    });
});

describe('defineThemes', () => {
    it('themes the suggest widget and selection for both editor themes', () => {
        const defined: Record<string, Record<string, string>> = {};
        const monaco = {
            editor: {
                defineTheme: (
                    name: string,
                    data: { colors: Record<string, string> },
                ) => {
                    defined[name] = data.colors;
                },
            },
        } as unknown as typeof Monaco;

        defineThemes(monaco);

        for (const name of ['dbsuperb-dark', 'dbsuperb-light']) {
            expect(defined[name]).toMatchObject({
                'editorSuggestWidget.background': expect.any(String),
                'editorSuggestWidget.selectedBackground': expect.any(String),
                'list.activeSelectionBackground': expect.any(String),
                'editor.selectionBackground': expect.any(String),
            });
        }
    });
});
