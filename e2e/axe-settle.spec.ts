import { expect, test } from '@playwright/test';
import { settleStyles } from './support/axe';

// No login needed: these run on a static page.
test('settleStyles ignores infinite animations and waits for finite transitions', async ({
    page,
}) => {
    await page.setContent(`
        <style>
            @keyframes spin { to { transform: rotate(360deg) } }
            #spinner { animation: spin 1s linear infinite }
            #box { color: red; transition: color 200ms linear }
            #box.on { color: blue }
        </style>
        <div id="spinner">o</div><div id="box">x</div>`);
    await page.evaluate(() => {
        void document.body.offsetHeight;
        document.getElementById('box')!.classList.add('on');
    });
    const start = Date.now();
    await settleStyles(page);
    expect(Date.now() - start).toBeLessThan(1_500);
    expect(
        await page.evaluate(
            () => getComputedStyle(document.getElementById('box')!).color,
        ),
    ).toBe('rgb(0, 0, 255)');
});

test('settleStyles fails loudly instead of hanging on a very long transition', async ({
    page,
}) => {
    await page.setContent(`
        <style>#box { color: red; transition: color 30s linear } #box.on { color: blue }</style>
        <div id="box">x</div>`);
    await page.evaluate(() => {
        void document.body.offsetHeight;
        document.getElementById('box')!.classList.add('on');
    });
    await expect(settleStyles(page)).rejects.toThrow(
        /did not settle.*transition color/,
    );
});
