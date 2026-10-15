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
function phpIniScanDir(): string {
    const loaded =
        execFileSync('php', [
            '-r',
            "echo extension_loaded('Zend OPcache') ? '1' : '0';",
        ])
            .toString()
            .trim() === '1';
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
    webServer: {
        // --no-reload passes the environment (PHP_INI_SCAN_DIR) through to the `php -S` child.
        command: 'php artisan serve --host=127.0.0.1 --port=8123 --no-reload',
        url: 'http://127.0.0.1:8123/up',
        reuseExistingServer: false,
        env: {
            DB_DATABASE: appDb,
            DBSUPERB_SQLITE_PATHS: demoDir,
            APP_ENV: 'local',
            PHP_INI_SCAN_DIR: phpIniScanDir(),
        },
    },
});
