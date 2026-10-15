import { loader } from '@monaco-editor/react';

let ready: Promise<typeof import('monaco-editor')> | null = null;

/** Loads Monaco from the app bundle (never from a CDN) with a local editor worker. */
export function setupMonaco(): Promise<typeof import('monaco-editor')> {
    ready ??= (async () => {
        // monaco-editor 0.57 maps `monaco-editor/*` to `esm/vs/*.js`.
        const [monaco, { default: EditorWorker }] = await Promise.all([
            import('monaco-editor/editor/editor.api'),
            import('monaco-editor/editor/editor.worker?worker'),
        ]);
        await Promise.all([
            import('monaco-editor/languages/definitions/sql/register'),
            import('monaco-editor/languages/definitions/mysql/register'),
            import('monaco-editor/languages/definitions/pgsql/register'),
        ]);
        (self as unknown as { MonacoEnvironment: unknown }).MonacoEnvironment =
            { getWorker: () => new EditorWorker() };
        monaco.editor.defineTheme('dbsuperb-dark', {
            base: 'vs-dark',
            inherit: true,
            rules: [],
            colors: { 'editor.background': '#0b0e14' },
        });
        monaco.editor.defineTheme('dbsuperb-light', {
            base: 'vs',
            inherit: true,
            rules: [],
            colors: { 'editor.background': '#fbfaf7' },
        });
        loader.config({ monaco });
        return monaco as unknown as typeof import('monaco-editor');
    })();
    return ready;
}

export const languageFor = (dialect: string) =>
    dialect === 'pgsql' ? 'pgsql' : dialect === 'sqlite' ? 'sql' : 'mysql';
