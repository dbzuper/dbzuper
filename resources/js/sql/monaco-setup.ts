import { loader } from '@monaco-editor/react';

let ready: Promise<typeof import('monaco-editor')> | null = null;

/** Resolves any CSS colour (oklch included) to a hex string Monaco accepts. */
function toHex(value: string, fallback: string): string {
    try {
        const ctx = document.createElement('canvas').getContext('2d');
        if (!ctx || !value) return fallback;
        ctx.clearRect(0, 0, 1, 1);
        ctx.fillStyle = '#000';
        ctx.fillStyle = value;
        ctx.fillRect(0, 0, 1, 1);
        const [r, g, b] = ctx.getImageData(0, 0, 1, 1).data;
        return `#${[r, g, b].map((n) => n.toString(16).padStart(2, '0')).join('')}`;
    } catch {
        return fallback;
    }
}

/** (Re)defines the editor themes from the app's CSS tokens, so they follow the dock. */
export function defineThemes(monaco: typeof import('monaco-editor')): void {
    const root = document.documentElement;
    const dark = root.classList.contains('dark');
    const style = getComputedStyle(root);
    const token = (name: string, fallback: string) =>
        toHex(style.getPropertyValue(name).trim(), fallback);
    const colors = {
        'editor.background': token(
            '--background',
            dark ? '#0b0e14' : '#ffffff',
        ),
        'editor.foreground': token(
            '--foreground',
            dark ? '#e2e8f0' : '#1a1a1a',
        ),
    };
    monaco.editor.defineTheme('dbsuperb-dark', {
        base: 'vs-dark',
        inherit: true,
        rules: [],
        colors,
    });
    monaco.editor.defineTheme('dbsuperb-light', {
        base: 'vs',
        inherit: true,
        rules: [],
        colors,
    });
}

/** Loads Monaco from the app bundle (never from a CDN) with a local editor worker. */
export function setupMonaco(): Promise<typeof import('monaco-editor')> {
    ready ??= (async () => {
        // monaco-editor 0.57 maps `monaco-editor/*` to `esm/vs/*.js`.
        const [monaco, { default: EditorWorker }] = await Promise.all([
            import('monaco-editor/editor/editor.api'),
            import('monaco-editor/editor/editor.worker?worker'),
        ]);
        // editor.api ships no editor behaviour; mirror editor.main's contributions
        // (minus the TS/CSS/HTML/JSON language features this app does not use).
        await Promise.all([
            import('../../../node_modules/monaco-editor/esm/vs/base/browser/ui/codicons/codicon/codicon.css'),
            import('../../../node_modules/monaco-editor/esm/vs/base/browser/ui/codicons/codicon/codicon-modifiers.css'),
            import('monaco-editor/editor/contrib/bracketMatching/browser/bracketMatching'),
            import('monaco-editor/editor/contrib/clipboard/browser/clipboard'),
            import('monaco-editor/editor/contrib/comment/browser/comment'),
            import('monaco-editor/editor/contrib/contextmenu/browser/contextmenu'),
            import('monaco-editor/editor/contrib/cursorUndo/browser/cursorUndo'),
            import('monaco-editor/editor/contrib/folding/browser/folding'),
            import('monaco-editor/editor/contrib/hover/browser/hoverContribution'),
            import('monaco-editor/editor/contrib/indentation/browser/indentation'),
            import('monaco-editor/editor/contrib/linesOperations/browser/linesOperations'),
            import('monaco-editor/editor/contrib/multicursor/browser/multicursor'),
            import('monaco-editor/editor/contrib/smartSelect/browser/smartSelect'),
            import('monaco-editor/editor/contrib/snippet/browser/snippetController2'),
            import('monaco-editor/editor/contrib/wordHighlighter/browser/wordHighlighter'),
            import('monaco-editor/editor/contrib/wordOperations/browser/wordOperations'),
            import('monaco-editor/editor/browser/coreCommands'),
            import('monaco-editor/editor/contrib/find/browser/findController'),
            import('monaco-editor/editor/contrib/suggest/browser/suggestController'),
            import('monaco-editor/editor/common/standaloneStrings'),
            import('monaco-editor/languages/definitions/sql/register'),
            import('monaco-editor/languages/definitions/mysql/register'),
            import('monaco-editor/languages/definitions/pgsql/register'),
        ]);
        (self as unknown as { MonacoEnvironment: unknown }).MonacoEnvironment =
            { getWorker: () => new EditorWorker() };
        const api = monaco as unknown as typeof import('monaco-editor');
        defineThemes(api);
        loader.config({ monaco: api });
        return api;
    })();
    return ready;
}

export const languageFor = (dialect: string) =>
    dialect === 'pgsql' ? 'pgsql' : dialect === 'sqlite' ? 'sql' : 'mysql';
