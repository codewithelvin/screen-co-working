import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test } from '@playwright/test';
import {
  allVoicesMuted,
  type AppHandle,
  CANTEEN_WIFI,
  createRoom,
  DEAD_SERVER,
  drawOn,
  joinByCode,
  launch,
  OFFICE_WIFI,
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

  // Watching folds the sidebar away for space; the header button brings it back.
  await expect(host.page.locator('.sidebar')).toHaveCount(0);
  await host.page.getByRole('button', { name: 'Yan paneli göstər' }).click();
  await host.page.locator('.person-row', { hasText: 'Aysel' }).getByRole('button').click();
  await host.page.getByText('Paylaşımı dayandır').click();
  await expect(guest.page.getByText('Ekranınız paylaşılır')).toHaveCount(0, { timeout: 10_000 });
  await expect(host.page.getByText('Hələ heç kim ekranını paylaşmır')).toBeVisible({ timeout: 10_000 });
  // The share is over, so the sidebar is back by itself.
  await expect(host.page.locator('.sidebar')).toBeVisible();
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

test('voice: three at one desk share a room mic, the one in the canteen talks', async () => {
  const elvin = await launch('Elvin', undefined, OFFICE_WIFI);
  const aysel = await launch('Aysel', undefined, OFFICE_WIFI);
  const murad = await launch('Murad', undefined, OFFICE_WIFI);
  const nigar = await launch('Nigar', undefined, CANTEEN_WIFI);
  apps.push(elvin, aysel, murad, nigar);

  const code = await createRoom(elvin.page, 'Səs otağı');
  for (const a of [aysel, murad, nigar]) await joinByCode(a.page, code);
  await expect(elvin.page.locator('.person-row')).toHaveCount(4);

  // Elvin joined first, so his laptop is the desk's room mic; Aysel and Murad stay silent.
  await expect(elvin.page.getByText('Otaq mikrofonu', { exact: true })).toBeVisible({ timeout: 20_000 });
  for (const a of [aysel, murad]) {
    await expect(a.page.getByRole('button', { name: 'Otaq mikrofonunu götür' })).toBeVisible({ timeout: 20_000 });
    await expect(a.page.getByRole('button', { name: 'Mikrofonu aç' })).toHaveCount(0);
  }
  // Nigar in the canteen may talk; her mic starts muted.
  const nigarMic = nigar.page.getByRole('button', { name: 'Mikrofonu aç' });
  await expect(nigarMic).toBeVisible({ timeout: 20_000 });
  await expect(nigar.page.getByText('Otaq mikrofonu', { exact: true })).toHaveCount(0);

  await nigarMic.click();
  await expect(nigar.page.getByRole('button', { name: 'Mikrofonu bağla' })).toBeVisible();
  await expect(elvin.page.locator('.person-row', { hasText: 'Nigar' }).locator('.mic-icon')).toBeVisible();

  // Only the room-mic laptop plays her voice; the others at the desk hear it from there.
  await expect.poll(() => elvin.page.locator('audio').count()).toBeGreaterThan(0);
  expect(await allVoicesMuted(elvin.page)).toBe(false);
  await expect.poll(() => aysel.page.locator('audio').count()).toBeGreaterThan(0);
  expect(await allVoicesMuted(aysel.page)).toBe(true);

  // Elvin talks for the desk; then Aysel takes the room mic over and Elvin's mic goes off.
  await elvin.page.getByRole('button', { name: 'Mikrofonu aç' }).click();
  await expect(nigar.page.locator('.person-row', { hasText: 'Elvin' }).locator('.mic-icon')).toBeVisible();
  await aysel.page.getByRole('button', { name: 'Otaq mikrofonunu götür' }).click();
  await expect(aysel.page.getByText('Otaq mikrofonu', { exact: true })).toBeVisible({ timeout: 20_000 });
  await expect(elvin.page.getByRole('button', { name: 'Otaq mikrofonunu götür' })).toBeVisible({ timeout: 20_000 });
  await expect(nigar.page.locator('.person-row', { hasText: 'Elvin' }).locator('.mic-icon')).toHaveCount(0);
  expect(await allVoicesMuted(elvin.page)).toBe(true);
});

test('server refuses an app below the minimum version and the app blocks until it updates', async () => {
  // The test stack serves deploy/updates; raise the minimum there and put it back afterwards.
  const manifest = join(__dirname, '..', '..', '..', 'deploy', 'updates', 'latest.json');
  const original = readFileSync(manifest, 'utf8');
  writeFileSync(manifest, JSON.stringify({ ...JSON.parse(original), minVersion: '99.0.0' }));
  try {
    const a = await launch('Elvin');
    apps.push(a);
    await a.page.locator('.section-head button').first().click();
    await a.page.locator('.ant-modal input').fill('Köhnə versiya');
    await a.page.getByRole('button', { name: 'Yarat' }).click();
    await expect(a.page.getByText('Yeni versiya tələb olunur')).toBeVisible();
    await expect(a.page.getByText(/Bu versiya \(v[\d.]+\) artıq dəstəklənmir/)).toBeVisible();
    await expect(a.page.locator('.stage-head')).toHaveCount(0);
  } finally {
    writeFileSync(manifest, original);
  }
});
