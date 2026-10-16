import inertia from '@inertiajs/vite';
import { wayfinder } from '@laravel/vite-plugin-wayfinder';
import babel from '@rolldown/plugin-babel';
import tailwindcss from '@tailwindcss/vite';
import react, { reactCompilerPreset } from '@vitejs/plugin-react';
import laravel from 'laravel-vite-plugin';
import { defineConfig, lazyPlugins } from 'vite-plus';

// @monaco-editor/loader ships a default CDN URL it never uses once
// loader.config({ monaco }) is set. Blank it so no CDN reference reaches the bundle.
const noMonacoCdn = {
    name: 'dbsuperb:no-monaco-cdn',
    enforce: 'pre' as const,
    transform(code: string, id: string) {
        if (!id.includes('@monaco-editor/loader')) return null;
        return code.replace(/https:\/\/cdn\.jsdelivr\.net[^'"`]*/g, '');
    },
};

// Lists the source modules inside every emitted chunk (chunk file -> module ids) so that
// scripts/check-chunks.mjs can prove which libraries ship in which chunk. Written next to the manifest.
const chunkModules = {
    name: 'dbsuperb:chunk-modules',
    apply: 'build' as const,
    generateBundle(
        _options: unknown,
        bundle: Record<string, { type: string; moduleIds?: string[] }>,
    ) {
        const modules: Record<string, string[]> = {};
        for (const [file, chunk] of Object.entries(bundle)) {
            if (chunk.type === 'chunk') modules[file] = chunk.moduleIds ?? [];
        }
        (
            this as unknown as {
                emitFile(file: {
                    type: 'asset';
                    fileName: string;
                    source: string;
                }): void;
            }
        ).emitFile({
            type: 'asset',
            fileName: 'chunk-modules.json',
            source: JSON.stringify(modules),
        });
    },
};

export default defineConfig({
    plugins: lazyPlugins(() => [
        laravel({
            input: ['resources/css/app.css', 'resources/js/app.tsx'],
            refresh: true,
        }),
        inertia(),
        react(),
        babel({
            presets: [reactCompilerPreset()],
        }),
        tailwindcss(),
        noMonacoCdn,
        chunkModules,
        wayfinder({
            formVariants: true,
        }),
    ]),
    server: {
        watch: {
            ignored: [
                '**/.agents/**',
                '**/.claude/**',
                '**/.cursor/**',
                '**/.junie/**',
                '**/vendor/**',
            ],
        },
    },
    lint: {
        ignorePatterns: [
            'vendor/**',
            'node_modules/**',
            'public/**',
            'bootstrap/ssr/**',
            'tailwind.config.js',
            'resources/js/actions/**',
            'resources/js/components/ui/*',
            'resources/js/routes/**',
            'resources/js/wayfinder/**',
        ],
        options: {
            denyWarnings: true,
            typeAware: true,
        },
    },
    fmt: {
        printWidth: 80,
        tabWidth: 4,
        singleQuote: true,
        semi: true,
        singleAttributePerLine: false,
        htmlWhitespaceSensitivity: 'css',
        ignorePatterns: [
            '.github/**',
            'composer.json',
            'resources/js/components/ui/*',
            'resources/views/mail/*',
        ],
        sortTailwindcss: {
            functions: ['clsx', 'cn', 'cva'],
            stylesheet: 'resources/css/app.css',
        },
    },
});
