// Rules for scripts/check-chunks.mjs, kept separate so they can be unit tested.

/** Packages (and scopes ending in `/`) that must never load eagerly. Companion packages match by prefix. */
export const banned = [
    'sigma',
    '@sigma/',
    'graphology',
    'monaco-editor',
    '@monaco-editor/',
    'react-data-grid',
    '@xyflow/',
];

/**
 * Returns the banned package a module id belongs to, or null. Ids are normalised to forward slashes and the
 * last `node_modules/` segment names the package, so nested and pnpm-style paths still match.
 * A plain entry matches the package itself and its `name-*` companions (graphology-utils,
 * graphology-layout-forceatlas2, ...); an entry ending in `/` matches a whole scope.
 */
export function bannedPackage(id) {
    const parts = id
        .replaceAll(String.fromCharCode(92), '/')
        .split('/node_modules/');
    if (parts.length < 2) return null;
    const rest = parts[parts.length - 1];
    const name = rest.startsWith('@')
        ? rest.split('/').slice(0, 2).join('/')
        : rest.split('/')[0];
    for (const b of banned) {
        if (b.endsWith('/')) {
            if (name.startsWith(b)) return b;
        } else if (name === b || name.startsWith(`${b}-`)) return b;
    }
    return null;
}

/** Entries whose eager (static-import) graph must stay clean: the app entry and every page. */
export function entryKeys(manifest) {
    return Object.entries(manifest)
        .filter(
            ([key, chunk]) =>
                chunk.isEntry || key.startsWith('resources/js/pages/'),
        )
        .map(([key]) => key);
}

/**
 * Walks static `imports` only. Returns one message per problem: a banned module in an eager chunk, or an
 * eager JavaScript chunk missing from the module map (the check would otherwise silently pass it).
 */
export function findProblems(manifest, modules) {
    const problems = new Set();
    for (const key of entryKeys(manifest)) {
        if (!manifest[key].file.endsWith('.js')) continue;
        const seen = new Set();
        const walk = (k) => {
            if (seen.has(k)) return;
            seen.add(k);
            if (!manifest[k]) {
                problems.add(
                    `${key} imports ${k}, which is not in the manifest`,
                );
                return;
            }
            for (const next of manifest[k].imports ?? []) walk(next);
        };
        walk(key);
        for (const k of seen) {
            const file = manifest[k]?.file;
            if (!file?.endsWith('.js')) continue;
            if (!(file in modules)) {
                problems.add(
                    `${key} eagerly loads ${file}, which has no entry in chunk-modules.json (cannot verify it)`,
                );
                continue;
            }
            for (const id of modules[file]) {
                if (bannedPackage(id)) {
                    problems.add(
                        `${key} eagerly loads ${file} which contains ${id.replace(/^.*node_modules\//, '')}`,
                    );
                    break;
                }
            }
        }
    }
    return [...problems];
}
