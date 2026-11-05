import { expect, test } from '@playwright/test';
import {
  type AppHandle,
  createRoom,
  DEAD_SERVER,
  drawOn,
  joinByCode,
  launch,
  overlayInk,
  shareFirstScreen,
  videoWidth,
} from './helpers';

// Real app instances against the real stack: start the docker test stack first (README "Tests").
test.describe.configure({ mode: 'serial' });

let apps: AppHandle[] = [];
test.afterEach(async ({}, info) => {
  if (info.status !== info.expectedStatus) {
    for (const [i, a] of apps.entries()) {
      const body = await a.page.screenshot().catch(() => null);
      if (body) await info.attach(`app-${i}`, { body, contentType: 'image/png' });
      const text = await a.page.locator('body').innerText().catch(() => '');
      await info.attach(`app-${i}.txt`, { body: text, contentType: 'text/plain' });
    }
  }
  await Promise.all(apps.map((a) => a.app.close().catch(() => undefined)));
  apps = [];
});

test('first run asks only for a name, pre-filled from the login, and connects', async () => {
  const a = await launch(null);
  apps.push(a);
  await expect(a.page.getByText('Xoş gəlmisiniz')).toBeVisible();
  await expect(a.page.getByLabel('Adınız')).not.toHaveValue('');
  await expect(a.page.getByText('Server ünvanı')).toHaveCount(0);
  await a.page.getByLabel('Adınız').fill('Yeni İşçi');
  await a.page.getByRole('button', { name: 'Yadda saxla' }).click();
  await expect(a.page.getByText('Serverə qoşulub')).toBeVisible();
  await expect(a.page.locator('.sidebar-foot')).toContainText('Yeni İşçi');
});

test('room: share, watch, annotate, pause, one presenter, kick', async () => {
  const elvin = await launch('Elvin');
  const aysel = await launch('Aysel');
  apps.push(elvin, aysel);

  const code = await createRoom(elvin.page, 'E2E otağı');
  await joinByCode(aysel.page, code);
  await expect(aysel.page.locator('.person-row')).toHaveCount(2);

  // Elvin joined first, so he is host; he shares the entire screen.
  await expect(elvin.page.locator('.person-row', { hasText: 'Elvin' }).locator('.crown')).toBeVisible();
  await elvin.page.getByRole('button', { name: 'Ekranımı paylaş' }).click();
  await shareFirstScreen(elvin.page);
  await expect(elvin.page.locator('.watchers')).toContainText('Aysel');

  // Aysel gets the screen at full resolution and has no way to start a second share.
  await expect.poll(() => videoWidth(aysel.page), { timeout: 15_000 }).toBeGreaterThan(1000);
  await expect(aysel.page.getByRole('button', { name: 'Ekranımı paylaş' })).toHaveCount(0);

  // Her pen stroke is drawn on the presenter's overlay window.
  await aysel.page.getByText('Qələm').click();
  await drawOn(aysel.page, Array.from({ length: 20 }, (_, i) => [0.2 + i * 0.03, 0.5] as [number, number]), true);
  await expect.poll(() => overlayInk(elvin.app), { timeout: 5_000 }).toBeGreaterThan(100);

  // Pause shows the frozen-frame badge to viewers; resume clears it.
  await elvin.page.getByRole('button', { name: 'Fasilə' }).click();
  await expect(aysel.page.locator('.paused-badge')).toContainText('Fasilə');
  await elvin.page.getByRole('button', { name: 'Davam et' }).click();
  await expect(aysel.page.locator('.paused-badge')).toHaveCount(0);

  // Host removes Aysel.
  await elvin.page.locator('.person-row', { hasText: 'Aysel' }).getByRole('button').click();
  await elvin.page.getByText('Otaqdan çıxart').click();
  await expect(aysel.page.getByText('Otağın sahibi sizi otaqdan çıxartdı.')).toBeVisible();
  await expect(elvin.page.locator('.person-row')).toHaveCount(1);
});

test('host stops someone else’s share', async () => {
  const host = await launch('Elvin');
  const guest = await launch('Aysel');
  apps.push(host, guest);
  const code = await createRoom(host.page, 'Paylaşım dayandırma');
  await joinByCode(guest.page, code);
  await guest.page.getByRole('button', { name: 'Ekranımı paylaş' }).click();
  await shareFirstScreen(guest.page);
  await expect.poll(() => videoWidth(host.page), { timeout: 15_000 }).toBeGreaterThan(1000);

  await host.page.locator('.person-row', { hasText: 'Aysel' }).getByRole('button').click();
  await host.page.getByText('Paylaşımı dayandır').click();
  await expect(guest.page.getByText('Ekranınız paylaşılır')).toHaveCount(0, { timeout: 10_000 });
  await expect(host.page.getByText('Hələ heç kim ekranını paylaşmır')).toBeVisible({ timeout: 10_000 });
});

test('same name gets the computer name; host role passes on when the host leaves', async () => {
  const first = await launch('Elvin');
  const second = await launch('Elvin');
  apps.push(first, second);

  const code = await createRoom(first.page, 'Ad testi');
  await joinByCode(second.page, code);
  const me = second.page.locator('.person-row', { hasText: '(siz)' });
  await expect(me).toContainText(/Elvin \(.+\)/);
  await expect(me.locator('.crown')).toHaveCount(0);

  await first.page.getByRole('button', { name: 'Çıx' }).click();
  await expect(me.locator('.crown')).toBeVisible({ timeout: 15_000 });
  await expect(second.page.getByRole('button', { name: 'Otağı bağla' })).toBeVisible();
});

test('host closes the room for everyone', async () => {
  const host = await launch('Elvin');
  const guest = await launch('Aysel');
  apps.push(host, guest);
  const code = await createRoom(host.page, 'Bağlanan otaq');
  await joinByCode(guest.page, code);
  await expect(guest.page.locator('.person-row')).toHaveCount(2);

  await host.page.getByRole('button', { name: 'Otağı bağla' }).click();
  await host.page.locator('.ant-popconfirm').getByRole('button', { name: 'Bağla' }).click();
  await expect(guest.page.getByText('Otaq bağlandı.')).toBeVisible();
});

test('server down: local P2P share is discovered and watched', async () => {
  const presenter = await launch('Elvin', DEAD_SERVER);
  const viewer = await launch('Aysel', DEAD_SERVER);
  apps.push(presenter, viewer);
  await expect(presenter.page.locator('.sidebar-status')).toContainText('Yerli rejim');

  await presenter.page.getByRole('button', { name: 'Ekranımı yerli paylaş' }).click();
  await presenter.page.locator('.ant-modal input').fill('Yerli test');
  await presenter.page.getByRole('button', { name: 'Ekranı seç' }).click();
  await shareFirstScreen(presenter.page);

  const session = viewer.page.locator('.room-row', { hasText: 'Yerli test' });
  await expect(session).toBeVisible({ timeout: 10_000 });
  await session.click();
  await expect.poll(() => videoWidth(viewer.page), { timeout: 15_000 }).toBeGreaterThan(1000);
  await expect(presenter.page.locator('.watchers')).toContainText('Aysel');

  await presenter.page.getByRole('button', { name: 'Dayandır' }).click();
  await expect(viewer.page.getByText('Təqdimatçı paylaşımı bitirdi.')).toBeVisible();
});
