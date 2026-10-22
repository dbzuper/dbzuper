/**
 * Text whose `backticked` parts (SQL keywords, names) are shown as code, e.g. the matcher's reasons. Text with
 * unbalanced backticks (a name that holds one) is shown as written.
 */
export function CodeText({ text }: { text: string }) {
    const parts = text.split('`');
    if (parts.length % 2 === 0) return <>{text}</>;
    return (
        <>
            {parts.map((part, i) =>
                i % 2 === 1 ? (
                    <code
                        key={i}
                        className="rounded-sm bg-muted px-1 font-mono text-foreground"
                    >
                        {part}
                    </code>
                ) : (
                    part
                ),
            )}
        </>
    );
}
