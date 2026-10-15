import Editor, { type OnMount } from '@monaco-editor/react';
import type * as Monaco from 'monaco-editor';
import { useEffect, useState } from 'react';
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

    useEffect(() => {
        void setupMonaco().then(() => setReady(true));
    }, []);

    useEffect(() => {
        const observer = new MutationObserver(() =>
            setDark(document.documentElement.classList.contains('dark')),
        );
        observer.observe(document.documentElement, {
            attributes: true,
            attributeFilter: ['class'],
        });
        return () => observer.disconnect();
    }, []);

    useEffect(() => {
        if (!ready) return;
        void setupMonaco().then((monaco) => {
            defineThemes(monaco);
            monaco.editor.setTheme(dark ? 'dbsuperb-dark' : 'dbsuperb-light');
        });
    }, [ready, dark]);

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
            theme={dark ? 'dbsuperb-dark' : 'dbsuperb-light'}
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
