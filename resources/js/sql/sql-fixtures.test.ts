import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { Dialect } from '@/types/schema';
import { classify } from './classifier';
import { splitStatements } from './splitter';

const load = (name: string) =>
    JSON.parse(
        readFileSync(
            resolve(process.cwd(), 'tests/fixtures/sql', name),
            'utf8',
        ),
    );

describe('shared split fixtures (parity with PHP)', () => {
    for (const c of load('split-cases.json') as {
        name: string;
        dialect: Dialect;
        sql: string;
        statements: string[];
    }[]) {
        it(c.name, () => {
            expect(splitStatements(c.sql, c.dialect).map((s) => s.sql)).toEqual(
                c.statements,
            );
        });
    }
});

describe('shared classify fixtures (parity with PHP)', () => {
    for (const c of load('classify-cases.json') as {
        dialect: Dialect;
        sql: string;
        kind: string;
        target?: string;
    }[]) {
        it(`${c.dialect}: ${c.sql}`, () => {
            const r = classify(c.sql, c.dialect);
            expect([r.kind, r.target]).toEqual([c.kind, c.target ?? null]);
        });
    }
});
