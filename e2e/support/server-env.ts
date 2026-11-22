import { execFileSync } from 'node:child_process';
import path from 'node:path';

export const appDb = path.resolve('database/e2e.sqlite');
export const demoDir = path.resolve('storage/app/demo');
const setupCode = path.resolve('storage/framework/testing/e2e-setup-code');

/**
 * Run the e2e server with OPcache, like a production PHP setup. The ini files are added through
 * PHP_INI_SCAN_DIR; the leading empty entry keeps PHP's default scan directory. The extension is only
 * loaded by us when php.ini has not loaded it already (loading it twice prints a warning).
 */
function opcacheLoaded(): boolean {
    try {
        return (
            execFileSync(
                'php',
                ['-r', "echo extension_loaded('Zend OPcache') ? '1' : '0';"],
                { stdio: ['ignore', 'pipe', 'ignore'] },
            )
                .toString()
                .trim() === '1'
        );
    } catch {
        // A missing or broken php is reported by Playwright's webServer startup instead.
        return false;
    }
}

function phpIniScanDir(): string {
    const loaded = opcacheLoaded();
    const dirs = [path.resolve('e2e/php')];
    if (!loaded) dirs.push(path.resolve('e2e/php/load-opcache'));
    return ['', ...dirs].join(path.delimiter);
}

/** The environment of the e2e web server and the transfers queue worker: same databases and settings. */
export const serverEnv: Record<string, string> = {
    DB_DATABASE: appDb,
    DBZUPER_SQLITE_PATHS: demoDir,
    // Its own setup code, so a run never touches the dev install's (see SETUP_CODE in e2e/support/auth.ts).
    DBZUPER_SETUP_CODE_PATH: setupCode,
    APP_ENV: 'local',
    // Inertia DevTools writes every request to storage/inertia-devtools, which slows the
    // single-threaded `php -S` server; production has it off.
    INERTIA_DEVTOOLS_ENABLED: 'false',
    // Every spec uses the API as the same user, back to back; the default 120 a minute is for one person.
    DBZUPER_API_PER_MINUTE: '1000',
    PHP_INI_SCAN_DIR: phpIniScanDir(),
    // The Docker image's SQLite lock settings: with several server workers, a DEFERRED
    // transaction that reads and then writes (the API rate limiter's counter) fails at once
    // with "database is locked" instead of waiting for busy_timeout.
    DB_JOURNAL_MODE: 'WAL',
    DB_TRANSACTION_MODE: 'IMMEDIATE',
    // `php -S` can fork workers (so the schema and layout requests run in parallel) except
    // on Windows, where forking is not supported.
    ...(process.platform !== 'win32' ? { PHP_CLI_SERVER_WORKERS: '4' } : {}),
};
