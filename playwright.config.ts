import { defineConfig } from '@playwright/test';
import path from 'node:path';

const appDb = path.resolve('database/e2e.sqlite');
const demoDir = path.resolve('storage/app/demo');

export default defineConfig({
    testDir: './e2e',
    globalSetup: './e2e/global-setup.ts',
    use: { baseURL: 'http://127.0.0.1:8123' },
    webServer: {
        command: 'php artisan serve --host=127.0.0.1 --port=8123',
        url: 'http://127.0.0.1:8123/up',
        reuseExistingServer: false,
        env: { DB_DATABASE: appDb, DBSUPERB_SQLITE_PATHS: demoDir, APP_ENV: 'local' },
    },
});
