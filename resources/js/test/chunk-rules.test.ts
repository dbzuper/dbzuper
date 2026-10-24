import { describe, expect, it } from 'vitest';
import {
    bannedPackage,
    chunkModulesFile,
    findFontProblems,
    findProblems,
} from '../../../scripts/chunk-rules.mjs';

describe('chunkModulesFile', () => {
    it('is written outside public/, so the web server never serves it', () => {
        expect(chunkModulesFile).not.toMatch(/^(\.\/)?public\//);
        expect(chunkModulesFile.endsWith('chunk-modules.json')).toBe(true);
    });
});

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
        [
            'C:/app/node_modules/react-day-picker/dist/esm/DayPicker.js',
            'react-day-picker',
        ],
        ['C:/app/node_modules/date-fns/addDays.js', 'date-fns'],
        ['C:/app/node_modules/@date-fns/tz/index.js', '@date-fns/'],
        [
            'C:/app/node_modules/@fontsource-variable/schibsted-grotesk/index.css',
            '@fontsource-variable/schibsted-grotesk',
        ],
        [
            'C:/app/node_modules/@fontsource-variable/jetbrains-mono/index.css',
            '@fontsource-variable/jetbrains-mono',
        ],
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
        'C:/app/node_modules/@fontsource-variable/geist/index.css',
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

describe('findFontProblems', () => {
    const fontFace =
        "@font-face{font-family:'Schibsted Grotesk Variable';src:url(/build/assets/schibsted-grotesk-latin-wght-normal-Bb8.woff2)}";

    /** The real build's shape: Graphite's CSS is its own entry, app.tsx only holds its `?url` reference. */
    const manifest = (overrides: Record<string, object> = {}) => ({
        'resources/css/app.css': { file: 'assets/app.css', isEntry: true },
        'resources/js/app.tsx': {
            file: 'assets/app.js',
            isEntry: true,
            imports: ['_shared.js'],
            css: ['assets/app-js.css'],
            assets: [
                'assets/fonts-graphite.css',
                'assets/schibsted-grotesk-latin-wght-normal-Bb8.woff2',
            ],
        },
        '_shared.js': { file: 'assets/shared.js' },
        'resources/js/pages/login.tsx': {
            file: 'assets/login.js',
            imports: ['_shared.js'],
        },
        'resources/css/fonts-graphite.css': {
            file: 'assets/fonts-graphite.css',
            isEntry: true,
            assets: ['assets/schibsted-grotesk-latin-wght-normal-Bb8.woff2'],
        },
        // The `?url` import's second key for the same entry, by absolute path.
        'C:/app/resources/css/fonts-graphite.css': {
            file: 'assets/fonts-graphite.css',
            isEntry: true,
        },
        ...overrides,
    });

    const files: Record<string, string> = {
        'assets/app.css':
            "[data-theme=graphite]{--font-sans:'Schibsted Grotesk Variable',sans-serif}",
        'assets/app-js.css':
            '@font-face{src:url(/build/assets/geist-latin-wght-normal-Bg.woff2)}',
        'assets/fonts-graphite.css': fontFace,
        'assets/shared.css': '',
    };
    const read = (file: string) => files[file] ?? '';

    it('passes on the real shape: the fonts only in their own entry, a ?url reference in app.tsx', () => {
        expect(findFontProblems(manifest(), read)).toEqual([]);
    });

    it("fails when the font stylesheet is in app.tsx's css list", () => {
        const m = manifest();
        m['resources/js/app.tsx'] = {
            ...m['resources/js/app.tsx'],
            css: ['assets/app-js.css', 'assets/fonts-graphite.css'],
        };

        expect(findFontProblems(m, read)).toEqual([
            expect.stringContaining(
                "resources/js/app.tsx eagerly loads assets/fonts-graphite.css, Graphite's font stylesheet",
            ),
        ]);
    });

    it('fails when app.css imports a Graphite font', () => {
        expect(
            findFontProblems(manifest(), (file) =>
                file === 'assets/app.css' ? fontFace : read(file),
            ),
        ).toEqual([
            expect.stringContaining(
                'resources/css/app.css eagerly loads assets/app.css, which references the Graphite font schibsted-grotesk-latin-wght-normal-Bb8.woff2',
            ),
        ]);
    });

    it("fails when a page's static import merges the font CSS into its stylesheet", () => {
        const m = manifest({
            '_shared.js': {
                file: 'assets/shared.js',
                css: ['assets/shared.css'],
            },
        });
        const fonts = (file: string) =>
            file === 'assets/shared.css'
                ? '@font-face{src:url(./jetbrains-mono-latin-wght-normal-B9.woff2)}'
                : read(file);

        expect(findFontProblems(m, fonts)).toEqual([
            expect.stringContaining(
                'resources/js/app.tsx eagerly loads assets/shared.css',
            ),
            expect.stringContaining(
                'resources/js/pages/login.tsx eagerly loads assets/shared.css',
            ),
        ]);
    });
});
