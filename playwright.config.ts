import { defineConfig } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import path from 'node:path';

const appDb = path.resolve('database/e2e.sqlite');
const demoDir = path.resolve('storage/app/demo');

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

export default defineConfig({
    testDir: './e2e',
    workers: 1,
    fullyParallel: false,
    globalSetup: './e2e/global-setup.ts',
    use: { baseURL: 'http://127.0.0.1:8123' },
    // The foundation spec walks the first-run setup, so it must sign in before any other spec creates
    // the administrator (files otherwise run alphabetically, and browse.spec sorts before it).
    projects: [
        { name: 'setup', testMatch: /foundation\.spec\.ts$/ },
        {
            name: 'e2e',
            testIgnore: /foundation\.spec\.ts$/,
            dependencies: ['setup'],
        },
    ],
    webServer: {
        // --no-reload passes the environment (PHP_INI_SCAN_DIR) through to the `php -S` child.
        command: 'php artisan serve --host=127.0.0.1 --port=8123 --no-reload',
        url: 'http://127.0.0.1:8123/up',
        reuseExistingServer: false,
        env: {
            DB_DATABASE: appDb,
            DBZUPER_SQLITE_PATHS: demoDir,
            APP_ENV: 'local',
            // Inertia DevTools writes every request to storage/inertia-devtools, which slows the
            // single-threaded `php -S` server; production has it off.
            INERTIA_DEVTOOLS_ENABLED: 'false',
            // Every spec uses the API as the same user, back to back; the default 120 a minute is for one person.
            DBZUPER_API_PER_MINUTE: '1000',
            PHP_INI_SCAN_DIR: phpIniScanDir(),
            // `php -S` can fork workers (so the schema and layout requests run in parallel) except
            // on Windows, where forking is not supported.
            ...(process.platform !== 'win32'
                ? { PHP_CLI_SERVER_WORKERS: '4' }
                : {}),
        },
    },
});
