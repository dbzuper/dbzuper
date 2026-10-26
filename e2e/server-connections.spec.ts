import { expect, test, type BrowserContext, type Page } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { expectNoA11yViolations } from './support/axe';
import { newSignedInContext } from './support/auth';

// Runs against the MySQL test engine (docker-compose.test.yml); skipped when it isn't up.
test.describe.configure({ mode: 'serial' });

const MYSQL = {
    host: process.env.TEST_MYSQL_HOST ?? '127.0.0.1',
    port: process.env.TEST_MYSQL_PORT ?? '3307',
    user: process.env.TEST_MYSQL_USERNAME ?? 'root',
    password: process.env.TEST_MYSQL_PASSWORD ?? 'secret',
};
const ALPHA = 'dbsuperb_test_e2e_alpha';
const BETA = 'dbsuperb_test_e2e_beta';
const NAME = 'Local MySQL server';
const SHOTS = path.resolve('test-results/server-connections');

/** Runs SQL on the MySQL test server through PHP's PDO (the e2e toolchain has no MySQL client). */
function mysql(sql: string): void {
    execFileSync(
        'php',
        [
            '-r',
            `$p = new PDO('mysql:host=${MYSQL.host};port=${MYSQL.port}', '${MYSQL.user}', getenv('E2E_MYSQL_PASSWORD'));
         foreach (explode(';;', getenv('E2E_SQL')) as $s) { if (trim($s) !== '') $p->exec($s); }`,
        ],
        {
            env: {
                ...process.env,
                E2E_MYSQL_PASSWORD: MYSQL.password,
                E2E_SQL: sql,
            },
            stdio: ['ignore', 'ignore', 'pipe'],
        },
    );
}

function available(): boolean {
    try {
        mysql('SELECT 1');
        return true;
    } catch {
        return false;
    }
}

let context: BrowserContext;
let page: Page;
let connectionPath = '';

test.beforeAll(async ({ browser }) => {
    test.skip(!available(), 'MySQL test server is not running');
    mysql(
        [
            `DROP DATABASE IF EXISTS ${ALPHA}`,
            `DROP DATABASE IF EXISTS ${BETA}`,
            `CREATE DATABASE ${ALPHA}`,
            `CREATE DATABASE ${BETA}`,
            `CREATE TABLE ${ALPHA}.alpha_items (id INT PRIMARY KEY)`,
            `CREATE TABLE ${BETA}.beta_items (id INT PRIMARY KEY)`,
        ].join(';;'),
    );
    ({ context, page } = await newSignedInContext(browser));
});

test.afterAll(async () => {
    await context?.close();
    if (available())
        mysql(
            [
                `DROP DATABASE IF EXISTS ${ALPHA}`,
                `DROP DATABASE IF EXISTS ${BETA}`,
            ].join(';;'),
        );
});

test('saves a MySQL connection without a database', async () => {
    await page.goto('/connections/create');
    await page.getByLabel('Name', { exact: true }).fill(NAME);
    await page.getByLabel('Engine').selectOption('mysql');
    await page.getByLabel('Host', { exact: true }).fill(MYSQL.host);
    await page.getByLabel('Port', { exact: true }).fill(MYSQL.port);
    await expect(page.getByLabel('Database', { exact: true })).toHaveValue('');
    await page.getByLabel('Username', { exact: true }).fill(MYSQL.user);
    await page.getByLabel('Password', { exact: true }).fill(MYSQL.password);
    await page.getByRole('button', { name: 'Add connection' }).click();
    await expect(page).toHaveURL(/\/connections$/);

    await expect(
        page.getByText(`${MYSQL.host}:${MYSQL.port} · All databases`),
    ).toBeVisible();
    const link = page.getByRole('link', { name: `Open ${NAME}` });
    connectionPath = (await link.getAttribute('href')) ?? '';
    expect(connectionPath).toMatch(/^\/c\/\d+$/);
});

test('lists the server databases and opens one', async () => {
    await page.goto(connectionPath);
    const list = page.getByRole('list', { name: 'Databases' });
    await expect(
        list.getByRole('link', { name: new RegExp(ALPHA) }),
    ).toBeVisible();
    await expect(list.getByText('information_schema')).toHaveCount(0);
    await expectNoA11yViolations(page);
    await page.screenshot({ path: `${SHOTS}/database-list.png` });

    await list.getByRole('link', { name: new RegExp(ALPHA) }).click();
    await expect(page).toHaveURL(`${connectionPath}/${ALPHA}`);
    await expect(
        page.getByRole('treeitem', { name: /alpha_items/ }),
    ).toBeVisible();
});

test('switches to another database from the header', async () => {
    await page
        .getByRole('button', { name: new RegExp(`Database: ${ALPHA}`) })
        .click();
    await expect(page.getByRole('menuitem', { name: BETA })).toBeVisible();
    await page.screenshot({ path: `${SHOTS}/switcher.png` });
    await page.getByRole('menuitem', { name: BETA }).click();

    await expect(page).toHaveURL(`${connectionPath}/${BETA}`);
    await expect(
        page.getByRole('treeitem', { name: /beta_items/ }),
    ).toBeVisible();
    await expect(
        page.getByRole('treeitem', { name: /alpha_items/ }),
    ).toHaveCount(0);
});

test('puts the last opened database first', async () => {
    await page.goto(connectionPath);
    const first = page
        .getByRole('list', { name: 'Databases' })
        .getByRole('listitem')
        .first();
    await expect(first).toContainText(BETA);
    await expect(first).toContainText('Last opened');
});
