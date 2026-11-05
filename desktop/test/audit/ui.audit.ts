import { test } from '@playwright/test';
import { createRoom, joinByCode, launch, OFFICE_WIFI, shareFirstScreen } from '../e2e/helpers';
import { auditContrast } from './contrast';

// Not part of the suite: `npx playwright test -c test/audit` prints contrast failures and saves screenshots.
test('contrast and font sizes across the main screens', async ({}, info) => {
  const out = (n: string) => info.outputPath(`${n}.png`);
  const a = await launch('Elvin', undefined, OFFICE_WIFI);
  const b = await launch('Aysel Məmmədova', undefined, OFFICE_WIFI);
  const c = await launch('Murad', undefined, OFFICE_WIFI);
  const report = async (name: string, page = a.page) => {
    await page.waitForTimeout(800);
    await page.screenshot({ path: out(name) });
    const r = await auditContrast(page);
    console.log(`\n== ${name}: sizes ${JSON.stringify(r.sizes)}`);
    for (const f of r.fails) console.log(`  ${f.ratio} ${f.size}px ${f.fg} on ${f.bg}  "${f.text}"`);
  };
  try {
    await report('empty');
    await a.page.locator('.section-head button').first().click();
    await report('create-modal');
    await a.page.keyboard.press('Escape');
    const code = await createRoom(a.page, 'Dizayn otağı');
    await joinByCode(b.page, code);
    await joinByCode(c.page, code);
    await a.page.getByText('Otaq mikrofonu', { exact: true }).waitFor({ timeout: 20_000 });
    await report('room-roommic');
    await b.page.getByRole('button', { name: 'Otaq mikrofonunu götür' }).waitFor({ timeout: 20_000 });
    await report('room-group', b.page);
    await a.page.getByRole('button', { name: 'Ekranımı paylaş' }).click();
    await report('picker');
    await shareFirstScreen(a.page);
    await report('presenting');
    await b.page.locator('video').waitFor();
    await report('viewer', b.page);
    await a.page.getByRole('button', { name: 'Fasilə' }).click();
    await report('paused-viewer', b.page);
  } finally {
    for (const x of [a, b, c]) await x.app.close().catch(() => undefined);
  }
});
