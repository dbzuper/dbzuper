import { execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

export default function globalSetup() {
    const appDb = path.resolve('database/e2e.sqlite');
    // The server runs it in WAL mode (playwright.config.ts): a stale -wal file would be replayed into
    // the new database.
    for (const file of [appDb, `${appDb}-wal`, `${appDb}-shm`]) {
        fs.rmSync(file, { force: true });
    }
    // A session saved by an earlier run belongs to the app database removed above.
    fs.rmSync(path.resolve('storage/framework/testing/e2e-auth.json'), {
        force: true,
    });
    // A setup code left by an earlier run would still be valid; start each run with a fresh one.
    fs.rmSync(path.resolve('storage/framework/testing/e2e-setup-code'), {
        force: true,
    });
    fs.writeFileSync(appDb, '');
    execSync('php artisan migrate --force', {
        stdio: 'inherit',
        env: { ...process.env, DB_DATABASE: appDb },
    });
    execSync('php artisan dbzuper:demo-database --force', {
        stdio: 'inherit',
        env: { ...process.env, DB_DATABASE: appDb },
    });
    execSync(
        `php artisan dbzuper:demo-database ${path.resolve('storage/app/demo/large.sqlite')} --tables=2000 --force`,
        {
            stdio: 'inherit',
            env: { ...process.env, DB_DATABASE: appDb },
        },
    );
}
