import { randomBytes } from 'node:crypto';
import { gzipSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { readHead, sniffDumpEngine } from './dump-sniff';

describe('sniffDumpEngine', () => {
    it.each([
        ['-- Engine: sqlite\n-- MySQL dump', 'sqlite'],
        ['-- Engine: pgsql\n', 'pgsql'],
        ['--\n-- PostgreSQL database dump\n--', 'pgsql'],
        ['-- Dumped by pg_dump version 16', 'pgsql'],
        ['-- MySQL dump 10.13  Distrib 8.0.36', 'mysql'],
        ['-- MySQL dump 10.19  Distrib 10.11.6-MariaDB', 'mariadb'],
        ['-- MariaDB dump 10.19', 'mariadb'],
        [
            'PRAGMA foreign_keys=OFF;\nBEGIN TRANSACTION;\nCREATE TABLE t(a);',
            'sqlite',
        ],
        ['PRAGMA foreign_keys=OFF;\n', null],
        ['SELECT 1;', null],
        ['', null],
    ])('%j -> %s', (head, expected) => {
        expect(sniffDumpEngine(head)).toBe(expected);
    });
});

describe('readHead', () => {
    it('reads plain text', async () => {
        const f = new File(['-- MySQL dump 10.13\n'], 'a.sql');
        expect(await readHead(f)).toBe('-- MySQL dump 10.13\n');
    });

    it('reads only 64 KB', async () => {
        const f = new File(['a'.repeat(100_000)], 'a.sql');
        expect((await readHead(f)).length).toBe(64 * 1024);
    });

    it('gunzips a gzip file', async () => {
        const f = new File(
            [new Uint8Array(gzipSync('-- PostgreSQL database dump\n'))],
            'a.sql.gz',
        );
        expect(await readHead(f)).toContain('PostgreSQL database dump');
    });

    it('survives a head cut off mid gzip stream', async () => {
        const noise = randomBytes(300_000);
        const gz = gzipSync(
            Buffer.concat([Buffer.from('-- MySQL dump 10.13\n'), noise]),
        );
        expect(gz.length).toBeGreaterThan(64 * 1024);
        const head = await readHead(new File([new Uint8Array(gz)], 'a.gz'));
        expect(head.startsWith('-- MySQL dump 10.13')).toBe(true);
    });
});
