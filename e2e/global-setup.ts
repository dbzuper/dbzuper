import { execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

export default function globalSetup() {
    const appDb = path.resolve('database/e2e.sqlite');
    fs.rmSync(appDb, { force: true });
    fs.writeFileSync(appDb, '');
    execSync('php artisan migrate --force', { stdio: 'inherit', env: { ...process.env, DB_DATABASE: appDb } });
}
