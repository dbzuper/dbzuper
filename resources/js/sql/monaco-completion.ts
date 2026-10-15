import type * as Monaco from 'monaco-editor';
import type { Dialect, SchemaSnapshot } from '@/types/schema';
import { completeSql } from './complete';

type Context = {
    snapshot: SchemaSnapshot;
    dialect: Dialect;
    focusedTable: string | null;
};
let registered = false;
let getContext: () => Context | null = () => null;

export function registerSqlCompletion(
    monaco: typeof Monaco,
    contextGetter: () => Context | null,
): void {
    getContext = contextGetter;
    if (registered) return;
    registered = true;
    const kinds = monaco.languages.CompletionItemKind;
    const kindMap = (k: string) =>
        ({
            table: kinds.Struct,
            view: kinds.Interface,
            column: kinds.Field,
            keyword: kinds.Keyword,
            join: kinds.Snippet,
            focused: kinds.Reference,
        })[k] ?? kinds.Text;
    for (const language of ['sql', 'mysql', 'pgsql']) {
        monaco.languages.registerCompletionItemProvider(language, {
            triggerCharacters: ['.', '@', ' '],
            provideCompletionItems: (model, position) => {
                const ctx = getContext();
                if (!ctx) return { suggestions: [] };
                const offset = model.getOffsetAt(position);
                const { items, replaceFrom } = completeSql({
                    text: model.getValue(),
                    offset,
                    ...ctx,
                });
                const start = model.getPositionAt(replaceFrom);
                const range = new monaco.Range(
                    start.lineNumber,
                    start.column,
                    position.lineNumber,
                    position.column,
                );
                return {
                    suggestions: items.map((i) => ({
                        label: i.label,
                        insertText: i.insertText,
                        kind: kindMap(i.kind),
                        detail: i.detail,
                        sortText: i.sortText,
                        range,
                    })),
                };
            },
        });
    }
}
