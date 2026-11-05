import { _electron as electron, type ElectronApplication, type Page } from '@playwright/test';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/** Room API of the test stack (see README "Tests"). */
export const API = process.env.SCW_API ?? '127.0.0.1:18080';
export const DEAD_SERVER = '127.0.0.1:1';

export interface AppHandle {
  app: ElectronApplication;
  page: Page;
}

/**
 * Start an app instance with its own settings folder (SCW_DATA_DIR). The server is fixed in the
 * build; tests point it at the test stack with SCW_SERVER. A null name means first run.
 */
export async function launch(name: string | null, server = API): Promise<AppHandle> {
  const dir = mkdtempSync(join(tmpdir(), 'scw-e2e-'));
  if (name) writeFileSync(join(dir, 'settings.json'), JSON.stringify({ name }));
  const app = await electron.launch({
    args: [join(__dirname, '..', '..')],
    env: { ...process.env, SCW_DATA_DIR: dir, SCW_SERVER: server },
  });
  const page = await app.firstWindow();
  await page.waitForSelector('.layout');
  return { app, page };
}

export async function createRoom(page: Page, title: string): Promise<string> {
  await page.locator('.section-head button').first().click();
  await page.locator('.ant-modal input').fill(title);
  await page.getByRole('button', { name: 'Yarat' }).click();
  const code = page.locator('.stage-head').getByText(/^Kod: /);
  await code.waitFor();
  return (await code.innerText()).replace('Kod: ', '').trim();
}

export async function joinByCode(page: Page, code: string): Promise<void> {
  await page.getByPlaceholder('Otaq kodu').fill(code);
  await page.getByRole('button', { name: 'Qoşul' }).click();
}

export async function shareFirstScreen(page: Page): Promise<void> {
  await page.locator('.screen-card').first().click();
  await page.getByText('Ekranınız paylaşılır').waitFor();
}

export function videoWidth(page: Page): Promise<number> {
  return page.evaluate(() => document.querySelector('video')?.videoWidth ?? 0);
}

/** Fire pointer events on the viewer's annotation canvas, at 0..1 positions. */
export async function drawOn(page: Page, points: [number, number][], pen: boolean): Promise<void> {
  await page.evaluate(
    ({ points, pen }) => {
      const c = document.querySelector('canvas.anno') as HTMLCanvasElement;
      const r = c.getBoundingClientRect();
      const fire = (type: string, [x, y]: [number, number]) =>
        c.dispatchEvent(
          new PointerEvent(type, { bubbles: true, pointerId: 1, clientX: r.left + r.width * x, clientY: r.top + r.height * y }),
        );
      if (pen) fire('pointerdown', points[0]);
      for (const p of points) fire('pointermove', p);
      if (pen) fire('pointerup', points[points.length - 1]);
    },
    { points, pen },
  );
}

/** Number of painted pixels on the presenter's overlay canvas (-1 when there is no overlay). */
export async function overlayInk(app: ElectronApplication): Promise<number> {
  const overlay = app.windows().find((w) => w.url().includes('overlay.html'));
  if (!overlay) return -1;
  return overlay.evaluate(() => {
    const c = document.getElementById('anno') as HTMLCanvasElement;
    const d = c.getContext('2d')!.getImageData(0, 0, c.width, c.height).data;
    let n = 0;
    for (let i = 3; i < d.length; i += 4) if (d[i] > 0) n++;
    return n;
  });
}
