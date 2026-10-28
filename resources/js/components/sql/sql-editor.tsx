import Editor, { type OnMount } from '@monaco-editor/react';
import type * as Monaco from 'monaco-editor';
import { useEffect, useState } from 'react';
import { watchThemeChanges } from '@/lib/theme-watch';
import { defineThemes, languageFor, setupMonaco } from '@/sql/monaco-setup';

type Props = {
    /** One Monaco model per path keeps undo history and cursor across tab switches. */
    path: string;
    value: string;
    dialect: string;
    onChange: (sql: string) => void;
    onMount?: (
        editor: Monaco.editor.IStandaloneCodeEditor,
        monaco: typeof Monaco,
    ) => void;
};

export function SqlEditor({ path, value, dialect, onChange, onMount }: Props) {
    const [ready, setReady] = useState(false);
    const [dark, setDark] = useState(() =>
        document.documentElement.classList.contains('dark'),
    );
    // Bumps on every mode or colour-theme change, so the Monaco themes are re-read from the CSS tokens.
    const [themeNonce, setThemeNonce] = useState(0);

    useEffect(() => {
        void setupMonaco().then(() => setReady(true));
    }, []);

    useEffect(() => {
        let theme = document.documentElement.dataset.theme;
        return watchThemeChanges(() => {
            setDark(document.documentElement.classList.contains('dark'));
            const now = document.documentElement.dataset.theme;
            if (now === theme) return;
            theme = now;
            setThemeNonce((n) => n + 1);
        });
    }, []);

    useEffect(() => {
        if (!ready) return;
        void setupMonaco().then((monaco) => {
            defineThemes(monaco);
            monaco.editor.setTheme(dark ? 'dbzuper-dark' : 'dbzuper-light');
        });
    }, [ready, dark, themeNonce]);

    if (!ready)
        return (
            <div className="p-3 text-xs text-muted-foreground">
                Loading editor…
            </div>
        );

    return (
        <Editor
            path={path}
            value={value}
            language={languageFor(dialect)}
            theme={dark ? 'dbzuper-dark' : 'dbzuper-light'}
            onChange={(v) => onChange(v ?? '')}
            onMount={onMount as OnMount}
            options={{
                minimap: { enabled: false },
                fontFamily: 'Geist Mono Variable, ui-monospace, monospace',
                fontSize: 13,
                scrollBeyondLastLine: false,
                automaticLayout: true,
                wordWrap: 'on',
                tabSize: 2,
                renderLineHighlight: 'line',
                fixedOverflowWidgets: true,
            }}
        />
    );
}
