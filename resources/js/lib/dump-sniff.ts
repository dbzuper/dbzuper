export type DumpEngine = 'mysql' | 'mariadb' | 'pgsql' | 'sqlite';

const HEAD_BYTES = 64 * 1024;

/** Guesses the engine a dump was made on from its first lines. */
export function sniffDumpEngine(head: string): DumpEngine | null {
    const own = /^-- Engine: (mysql|mariadb|pgsql|sqlite)\s*$/m.exec(head);
    if (own) return own[1] as DumpEngine;
    if (/-- PostgreSQL database dump|pg_dump/.test(head)) return 'pgsql';
    if (/-- (MySQL|MariaDB) dump/.test(head)) {
        return /MariaDB/.test(head) ? 'mariadb' : 'mysql';
    }
    if (
        /PRAGMA foreign_keys=OFF;/.test(head) &&
        /BEGIN TRANSACTION;/.test(head)
    ) {
        return 'sqlite';
    }
    return null;
}

async function gunzipHead(bytes: Uint8Array<ArrayBuffer>): Promise<string> {
    const source = new ReadableStream<Uint8Array<ArrayBuffer>>({
        start(controller) {
            controller.enqueue(bytes);
            controller.close();
        },
    });
    const reader = source
        .pipeThrough(new DecompressionStream('gzip'))
        .getReader();
    const chunks: Uint8Array[] = [];
    let length = 0;
    try {
        while (length < HEAD_BYTES) {
            const { done, value } = await reader.read();
            if (done) break;
            chunks.push(value);
            length += value.length;
        }
    } catch {
        // The head ends mid-stream: keep what was decompressed so far.
    }
    reader.cancel().catch(() => {});
    const all = new Uint8Array(length);
    let at = 0;
    for (const c of chunks) {
        all.set(c, at);
        at += c.length;
    }
    return new TextDecoder().decode(all.subarray(0, HEAD_BYTES));
}

/** The first 64 KB of a dump as text, decompressed when the file is gzip. */
export async function readHead(file: File): Promise<string> {
    const raw = new Uint8Array(await file.slice(0, HEAD_BYTES).arrayBuffer());
    if (raw.length >= 2 && raw[0] === 0x1f && raw[1] === 0x8b) {
        return gunzipHead(raw);
    }
    return new TextDecoder().decode(raw);
}
