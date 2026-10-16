import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = 'resources/js';
const RAW =
    /(amber|emerald|green|red|yellow|blue|slate|zinc|gray|neutral|stone|teal|sky|cyan|indigo|violet|purple|pink|rose|orange|lime)-[0-9]{2,3}|text-(black|white)\b|bg-(black|white)\b|--color-(teal|neutral)/;

/** Excluded on purpose (each with a reason). */
const EXCLUDED = [
    // Generated Wayfinder route helpers: no styling.
    `${ROOT}/actions`,
    `${ROOT}/routes`,
];

/** Individual lines kept on purpose. */
const ALLOWED = [
    // shadcn primitives: modal scrims and white text on the destructive fill.
    'ui/dialog.tsx:bg-black/80',
    'ui/sheet.tsx:bg-black/80',
    'ui/badge.tsx:bg-destructive text-white',
    'ui/button.tsx:bg-destructive text-white',
    // A QR code needs a white quiet zone in either theme to stay scannable.
    'two-factor-setup-modal.tsx:bg-white',
    // Modal scrim: black at 40% is the conventional overlay in both themes.
    'command-palette.tsx:bg-black/40',
];

function sources(dir: string): string[] {
    return readdirSync(dir).flatMap((name) => {
        const full = path.posix.join(dir, name);
        if (EXCLUDED.includes(full)) return [];
        if (statSync(full).isDirectory()) return sources(full);
        return /\.(ts|tsx)$/.test(name) && !/\.test\.(ts|tsx)$/.test(name)
            ? [full]
            : [];
    });
}

describe('theme tokens only', () => {
    it('uses no raw palette colours in app source', () => {
        const hits = sources(ROOT).flatMap((file) =>
            readFileSync(file, 'utf8')
                .split('\n')
                .flatMap((line, i) =>
                    RAW.test(line) &&
                    !ALLOWED.some((a) => {
                        const [f, frag] = a.split(':');
                        return file.endsWith(f) && line.includes(frag);
                    })
                        ? [`${file}:${i + 1}: ${line.trim()}`]
                        : [],
                ),
        );
        expect(hits).toEqual([]);
    });
});
