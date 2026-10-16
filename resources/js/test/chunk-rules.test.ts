import { describe, expect, it } from 'vitest';
import { bannedPackage, findProblems } from '../../../scripts/chunk-rules.mjs';

describe('bannedPackage', () => {
    it.each([
        ['C:/app/node_modules/sigma/dist/sigma.mjs', 'sigma'],
        ['C:/app/node_modules/sigma-extra/index.js', 'sigma'],
        ['C:/app/node_modules/@sigma/edge-curve/dist/x.js', '@sigma/'],
        ['C:/app/node_modules/graphology/dist/graphology.mjs', 'graphology'],
        ['C:/app/node_modules/graphology-utils/index.js', 'graphology'],
        [
            'C:/app/node_modules/graphology-layout-forceatlas2/index.js',
            'graphology',
        ],
        [
            'C:/app/node_modules/graphology-communities-louvain/index.js',
            'graphology',
        ],
        [
            'C:/app/node_modules/monaco-editor/esm/vs/editor/editor.api.js',
            'monaco-editor',
        ],
        [
            'C:/app/node_modules/@monaco-editor/react/dist/index.mjs',
            '@monaco-editor/',
        ],
        ['C:/app/node_modules/react-data-grid/lib/index.js', 'react-data-grid'],
        [
            'C:/app/node_modules/react-data-grid/lib/styles.css',
            'react-data-grid',
        ],
        [
            'C:/app/node_modules/react-data-grid-extras/index.js',
            'react-data-grid',
        ],
        ['C:/app/node_modules/@xyflow/react/dist/esm/index.js', '@xyflow/'],
        ['C:\\app\\node_modules\\graphology-utils\\is-graph.js', 'graphology'],
        ['/a/node_modules/.pnpm/x@1/node_modules/sigma/index.js', 'sigma'],
        [
            '/a/node_modules/foo/node_modules/@xyflow/system/index.js',
            '@xyflow/',
        ],
    ])('flags %s', (id, expected) => {
        expect(bannedPackage(id)).toBe(expected);
    });

    it.each([
        'C:/app/resources/js/universe/graph.ts',
        'C:/app/node_modules/react/index.js',
        'C:/app/node_modules/sigmoid/index.js',
        'C:/app/node_modules/graphologyish/index.js',
        'C:/app/node_modules/@radix-ui/react-dialog/dist/index.mjs',
        'C:/app/resources/js/sigma/node_modules.ts',
    ])('ignores %s', (id) => {
        expect(bannedPackage(id)).toBeNull();
    });
});

describe('findProblems', () => {
    const manifest = {
        'resources/js/app.tsx': {
            file: 'assets/app.js',
            isEntry: true,
            imports: ['_shared.js'],
            dynamicImports: ['lazy.js'],
        },
        '_shared.js': { file: 'assets/shared.js' },
        'lazy.js': { file: 'assets/lazy.js' },
    };

    it('passes when only a dynamic import holds a banned library', () => {
        const modules = {
            'assets/app.js': ['/a/resources/js/app.tsx'],
            'assets/shared.js': ['/a/node_modules/react/index.js'],
            'assets/lazy.js': ['/a/node_modules/sigma/index.js'],
        };
        expect(findProblems(manifest, modules)).toEqual([]);
    });

    it('fails on a banned companion in a static import', () => {
        const modules = {
            'assets/app.js': [],
            'assets/shared.js': ['/a/node_modules/graphology-utils/x.js'],
        };
        expect(findProblems(manifest, modules)).toEqual([
            expect.stringContaining('graphology-utils/x.js'),
        ]);
    });

    it('fails loudly when an eager chunk has no module-map entry', () => {
        const modules = { 'assets/app.js': [] };
        expect(findProblems(manifest, modules)).toEqual([
            expect.stringContaining('no entry in chunk-modules.json'),
        ]);
    });
});
