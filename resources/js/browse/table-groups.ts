export type SidebarEntry =
    | { kind: 'table'; name: string; depth: 0 | 1; prefix: string | null }
    | { kind: 'group'; prefix: string; tables: string[] };

/** The leading segment of a table name including its underscore, if any. */
export function groupKey(name: string): string | null {
    const i = name.indexOf('_');
    return i > 0 ? name.slice(0, i + 1) : null;
}

function bucket(names: readonly string[], skip: number) {
    const members = new Map<string, string[]>();
    for (const name of names) {
        const key = groupKey(name.slice(skip));
        if (!key) continue;
        const list = members.get(key);
        if (list) list.push(name);
        else members.set(key, [name]);
    }
    return members;
}

export function groupTables(names: readonly string[]): {
    entries: SidebarEntry[];
    stripped: string | null;
} {
    const first = names.length >= 2 ? groupKey(names[0]) : null;
    const stripped =
        first && names.every((n) => groupKey(n) === first) ? first : null;
    const skip = stripped?.length ?? 0;

    const groups = [...bucket(names, skip)]
        .filter(([, tables]) => tables.length >= 2)
        .map(([key, tables]) => ({
            kind: 'group' as const,
            prefix: (stripped ?? '') + key,
            tables,
        }))
        .sort((a, b) => a.prefix.localeCompare(b.prefix));
    const grouped = new Set(groups.flatMap((g) => g.tables));
    const loose = names.filter((n) => !grouped.has(n));

    const entries: SidebarEntry[] = [];
    let next = 0;
    for (const name of loose) {
        while (
            next < groups.length &&
            groups[next].prefix.localeCompare(name) < 0
        )
            entries.push(groups[next++]);
        entries.push({ kind: 'table', name, depth: 0, prefix: null });
    }
    entries.push(...groups.slice(next));
    return { entries, stripped };
}

export function flattenEntries(
    entries: SidebarEntry[],
    open: ReadonlySet<string>,
): SidebarEntry[] {
    return entries.flatMap((entry): SidebarEntry[] =>
        entry.kind === 'group' && open.has(entry.prefix)
            ? [
                  entry,
                  ...entry.tables.map((name) => ({
                      kind: 'table' as const,
                      name,
                      depth: 1 as const,
                      prefix: entry.prefix,
                  })),
              ]
            : [entry],
    );
}
