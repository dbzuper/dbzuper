// Rules for scripts/check-chunks.mjs, kept separate so they can be unit tested.

/**
 * Where vite.config.ts writes the chunk -> module ids map (relative to the project root). It stays out of
 * public/ so the web server never serves the list of source modules.
 */
export const chunkModulesFile = 'storage/build/chunk-modules.json';

/** Packages (and scopes ending in `/`) that must never load eagerly. Companion packages match by prefix. */
export const banned = [
    'sigma',
    '@sigma/',
    'graphology',
    'monaco-editor',
    '@monaco-editor/',
    'react-data-grid',
    '@xyflow/',
    'react-day-picker',
    'date-fns',
    '@date-fns/',
    // Graphite's fonts load through their own CSS entry, only while Graphite is active (Geist stays eager).
    '@fontsource-variable/schibsted-grotesk',
    '@fontsource-variable/jetbrains-mono',
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

/** Graphite's font entry: the one place its fonts may be. Every other entry must stay free of them. */
export const lazyFontEntry = 'resources/css/fonts-graphite.css';

/** A Graphite font file (as a CSS url() or an emitted asset name). Family names in tokens do not match. */
const lazyFontFile = /(?:schibsted-grotesk|jetbrains-mono)-[\w-]*\.woff2/;

/**
 * The module rules above only see JavaScript modules, so CSS gets its own check. For every entry but the font
 * entry, collects the stylesheets that load eagerly (a CSS entry's own file, and the `css` of every chunk its
 * static imports reach) and fails when one is the font stylesheet or its content references a Graphite font
 * file (an `@import` into app.css, or a plain JS import of the font CSS merged into a chunk's stylesheet).
 * `assets` are not followed: a JS chunk lists the `?url` reference there without loading it.
 */
export function findFontProblems(manifest, readCss) {
    const problems = new Set();
    for (const key of entryKeys(manifest)) {
        // The `?url` import adds a second manifest key for the same entry, by absolute path.
        const entry = key.replaceAll(String.fromCharCode(92), '/');
        if (entry === lazyFontEntry || entry.endsWith(`/${lazyFontEntry}`))
            continue;
        const seen = new Set();
        const walk = (k) => {
            if (seen.has(k) || !manifest[k]) return;
            seen.add(k);
            for (const next of manifest[k].imports ?? []) walk(next);
        };
        walk(key);
        const stylesheets = new Set();
        for (const k of seen) {
            const chunk = manifest[k];
            if (chunk.file.endsWith('.css')) stylesheets.add(chunk.file);
            for (const css of chunk.css ?? []) stylesheets.add(css);
        }
        for (const file of stylesheets) {
            if (file.includes('fonts-graphite')) {
                problems.add(
                    `${key} eagerly loads ${file}, Graphite's font stylesheet`,
                );
                continue;
            }
            const font = lazyFontFile.exec(readCss(file));
            if (font) {
                problems.add(
                    `${key} eagerly loads ${file}, which references the Graphite font ${font[0]}`,
                );
            }
        }
    }
    return [...problems];
}
