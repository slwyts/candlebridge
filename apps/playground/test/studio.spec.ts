import { test, expect, type Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import type { Candle } from 'candlebridge';

async function download(page: Page, name: string) {
  const wait = page.waitForEvent('download');
  await page.getByRole('button', { name, exact: true }).click();
  const file = await wait;
  return readFile((await file.path())!, 'utf8');
}
const mode = (page: Page, name: string) =>
  page.getByRole('navigation').getByRole('button', { name, exact: true }).click();
const status = (page: Page) => page.locator('.status');
const full = async (page: Page): Promise<{ candles: Candle[] }> =>
  JSON.parse(await download(page, 'Export JSON (with paths)'));
test.beforeEach(async ({ page }) => {
  await page.goto('./');
  await expect(status(page)).toContainText('Generated 2,016 bars');
});

test('production worker, repeatable seeds, chart frames, bilingual canvas and exports', async ({
  page,
  context
}) => {
  const failures: string[] = [];
  page.on('pageerror', (error) => failures.push(error.message));
  await expect(page.getByRole('img', { name: 'Synthetic OHLC, EMA and MACD' })).toBeVisible();
  await page.getByRole('button', { name: '5m', exact: true }).click();
  await expect(page.getByRole('button', { name: '5m', exact: true })).toHaveAttribute('aria-pressed', 'true');
  const readout = await page.locator('.ohlc-readout').innerText();
  await page.getByRole('button', { name: '中文' }).click();
  await expect(page.getByRole('heading', { name: 'K 线实验台.' })).toBeVisible();
  await expect(page.locator('.ohlc-readout')).toHaveText(readout);
  await page.getByRole('button', { name: 'English' }).click();
  await mode(page, 'Import / Export');
  const one = await full(page);
  expect(one.candles.at(-1)?.close).toBe(135);
  const csv = await download(page, 'Export CSV');
  expect(csv.split('\n')).toHaveLength(2017);
  expect(JSON.parse(await download(page, 'Export JSON (OHLC only)')).candles[0].execution).toBeUndefined();
  const legacy = JSON.parse(await download(page, 'Export legacy JSON (klines)'));
  expect(legacy.klines[0].openPrice).toBe(100);
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await page.getByRole('button', { name: 'Copy Code' }).click();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toContain('"seed": 20261007');
  await mode(page, 'Generate');
  await page.locator('form').getByRole('button', { name: 'Generate', exact: true }).click();
  await expect(status(page)).toContainText('Generated 2,016 bars');
  await mode(page, 'Import / Export');
  expect((await full(page)).candles).toEqual(one.candles);
  await mode(page, 'Generate');
  await page.getByRole('button', { name: 'New Seed' }).click();
  await expect(status(page)).toContainText('Generated 2,016 bars');
  await mode(page, 'Import / Export');
  const other = (await full(page)).candles;
  expect(other.at(-1)?.close).toBe(135);
  expect(other[0].execution!.points).not.toEqual(one.candles[0].execution!.points);
  expect(failures).toEqual([]);
});

test('imports a historical plan, edits using the pointer, exports and restores the actual edited path', async ({
  page
}) => {
  await mode(page, 'Import / Export');
  const input = page.locator('input[type=file]');
  await input.setInputFiles({
    name: 'demo.json',
    mimeType: 'application/json',
    buffer: Buffer.from(
      JSON.stringify({
        startTime: '2001-01-01T00:00:00Z',
        symbol: 'DEMO',
        intervalSeconds: 300,
        klines: [
          [100, 103, 99, 102],
          [102, 104, 101, 103],
          [103, 106, 101, 105]
        ]
      })
    )
  });
  await expect(status(page)).toHaveText('Imported 3 candles');
  const original = (await full(page)).candles;
  await mode(page, 'Draw');
  const rect = (await page.locator('.draw-canvas').boundingBox())!;
  await page.mouse.move(rect.x + 90, rect.y + rect.height * 0.53);
  await page.mouse.down();
  await page.mouse.move(rect.x + rect.width * 0.49, rect.y + rect.height * 0.4, { steps: 6 });
  await page.mouse.up();
  await expect(status(page)).toHaveText('Drawing applied');
  await mode(page, 'Import / Export');
  await expect(page.locator('pre')).toContainText('parseCandlesJson');
  const edited = await full(page);
  expect(edited.candles[0].close).not.toBe(original[0].close);
  expect(edited.candles[0].close).toBe(edited.candles[1].open);
  expect(edited.candles[0].execution!.points).toHaveLength(4);
  await input.setInputFiles({ name: 'oops.json', mimeType: 'application/json', buffer: Buffer.from('{') });
  await expect(page.getByRole('alert')).toContainText('JSON');
  expect((await full(page)).candles).toEqual(edited.candles);
  await input.setInputFiles({
    name: 'edited.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify(edited))
  });
  await expect(status(page)).toHaveText('Imported 3 candles');
  expect((await full(page)).candles).toEqual(edited.candles);
  await page.getByLabel('Candle #').fill('3');
  await page.getByRole('slider', { name: 'Offset', exact: true }).press('End');
  await expect(page.locator('.inspector-readout')).toContainText('105');
});

test('auto bounds expand for the new endpoint; explicit bounds fail without discarding data', async ({
  page
}) => {
  await page.getByLabel('Target Return %').fill('75');
  await page.locator('form').getByRole('button', { name: 'Generate', exact: true }).click();
  await expect(page.locator('.metrics')).toContainText('100 → 175');
  await page.getByText('Stochastic Model & Bounds', { exact: true }).click();
  await page.getByLabel('Ceiling %').fill('10');
  await page.locator('form').getByRole('button', { name: 'Generate', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText(/target|范围/i);
  await expect(page.locator('.metrics')).toContainText('100 → 175');
  await page.getByLabel('Keep explicit bounds').uncheck();
  await page.locator('form').getByRole('button', { name: 'Generate', exact: true }).click();
  await expect(status(page)).toContainText('Generated');
});

test('works at phone width and the site loads its notices from a repository subpath', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByLabel('Presets').selectOption('crash');
  await expect(status(page)).toContainText('Generated 1,440 bars');
  await expect(page.locator('.metrics')).toContainText('-26.00%');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.getByRole('link', { name: 'Notices' }).click();
  await expect(page).toHaveURL(/\/candlebridge\/third-party-notices\.txt$/);
  await expect(page.locator('body')).toContainText('TradingView, Inc.');
});

test('can page a long scenario at minute resolution without changing the base series', async ({ page }) => {
  await page.getByLabel('Presets').selectOption('month');
  await expect(status(page)).toContainText('Generated 8,640 bars');
  await page.getByRole('button', { name: '1m', exact: true }).click();
  await expect(page.locator('.view-pages')).toContainText('1–6000 / 43200');
  await page.getByRole('button', { name: 'Next page' }).click();
  await expect(page.locator('.view-pages')).toContainText('6001–12000 / 43200');
  await expect(page.locator('.meta')).toContainText('8,640 bars');
});
