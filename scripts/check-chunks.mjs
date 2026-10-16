#!/usr/bin/env node
// Fails the build when a heavy library ends up in a chunk that loads eagerly.
//
// Method: vite.config.ts writes public/build/chunk-modules.json (chunk file -> source module ids).
// public/build/manifest.json gives the import graph. From the app entry we follow only static `imports`
// (never `dynamicImports`), and do the same from every page entry, because Inertia loads a page chunk
// together with its static imports before it renders. Any module of a banned package (sigma, graphology
// and their companions, Monaco, react-data-grid, @xyflow) inside those eager sets is a failure, and so is
// an eager chunk with no module-map entry. The rules live in chunk-rules.mjs. Node only, no dependencies.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { banned, entryKeys, findProblems } from './chunk-rules.mjs';

const buildDir = path.resolve(process.argv[2] ?? 'public/build');
const manifest = JSON.parse(
    readFileSync(path.join(buildDir, 'manifest.json'), 'utf8'),
);
const modules = JSON.parse(
    readFileSync(path.join(buildDir, 'chunk-modules.json'), 'utf8'),
);

const problems = findProblems(manifest, modules);
if (problems.length > 0) {
    console.error(
        'check-chunks: eager chunks are not clean:\n  ' + problems.join('\n  '),
    );
    process.exit(1);
}
console.log(
    `check-chunks: ${entryKeys(manifest).length} entries clean (no ${banned.join(', ')} in their eager imports)`,
);
