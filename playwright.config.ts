import { defineConfig } from '@playwright/test';
import { serverEnv } from './e2e/support/server-env';

export default defineConfig({
    testDir: './e2e',
    workers: 1,
    fullyParallel: false,
    globalSetup: './e2e/global-setup.ts',
    // CI keeps a trace of each failure (uploaded as a workflow artifact) to diagnose it from GitHub.
    reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
    use: {
        baseURL: 'http://127.0.0.1:8123',
        trace: process.env.CI ? 'retain-on-failure' : 'off',
    },
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
        env: serverEnv,
    },
});
