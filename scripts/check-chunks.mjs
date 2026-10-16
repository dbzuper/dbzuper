#!/usr/bin/env node
// Fails the build when a heavy library ends up in a chunk that loads eagerly.
//
// Method: vite.config.ts writes public/build/chunk-modules.json (chunk file -> source module ids).
// public/build/manifest.json gives the import graph. From the app entry we follow only static `imports`
// (never `dynamicImports`), and do the same from every page entry, because Inertia loads a page chunk
// together with its static imports before it renders. Any module of a banned package inside those
// eager sets is a failure. Node only, no dependencies.
import { readFileSync } from 'node:fs';
import path from 'node:path';

const buildDir = path.resolve(process.argv[2] ?? 'public/build');
const manifest = JSON.parse(
    readFileSync(path.join(buildDir, 'manifest.json'), 'utf8'),
);
const modules = JSON.parse(
    readFileSync(path.join(buildDir, 'chunk-modules.json'), 'utf8'),
);

const banned = [
    'sigma',
    'graphology',
    'monaco-editor',
    '@monaco-editor',
    'react-data-grid',
    '@xyflow',
];
// Module ids are normalised to forward slashes; the last node_modules segment names the package
// (so pnpm-style nested paths still match).
const bannedPackage = (id) => {
    const parts = id
        .replaceAll(String.fromCharCode(92), '/')
        .split('/node_modules/');
    if (parts.length < 2) return null;
    const rest = parts[parts.length - 1];
    return banned.find((b) => rest === b || rest.startsWith(`${b}/`)) ?? null;
};

// Workspace pages are the ones that may fetch heavy chunks, but only lazily: their eager
// graph must stay clean too, so a library never rides along with the page itself.
const entries = Object.entries(manifest).filter(
    ([key, chunk]) => chunk.isEntry || key.startsWith('resources/js/pages/'),
);

const failures = [];
for (const [key, entry] of entries) {
    if (!entry.file.endsWith('.js')) continue;
    const seen = new Set();
    const walk = (k) => {
        if (seen.has(k)) return;
        seen.add(k);
        for (const next of manifest[k]?.imports ?? []) walk(next);
    };
    walk(key);
    for (const k of seen) {
        const file = manifest[k].file;
        for (const id of modules[file] ?? []) {
            if (bannedPackage(id)) {
                failures.push(
                    `${key} eagerly loads ${file} which contains ${id.replace(/^.*node_modules\//, '')}`,
                );
                break;
            }
        }
    }
}

if (failures.length > 0) {
    console.error(
        'check-chunks: heavy libraries leaked into eager chunks:\n  ' +
            [...new Set(failures)].join('\n  '),
    );
    process.exit(1);
}
console.log(
    `check-chunks: ${entries.length} entries clean (no ${banned.join(', ')} in their eager imports)`,
);
