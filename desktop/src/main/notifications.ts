import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import type { NotifyMuteResult } from '../shared/types';
import { load, save } from './settings';

const execAsync = promisify(execFile);
// No console window: reg.exe started from a GUI app would otherwise flash one.
const run = (cmd: string, args: string[]) => execAsync(cmd, args, { windowsHide: true });

/**
 * Hide OS notification pop-ups while sharing (D14). Best effort per OS:
 * - Windows: the "Get notifications from apps" switch (ToastEnabled).
 * - Linux GNOME: org.gnome.desktop.notifications show-banners.
 * - macOS: apps cannot switch on Do Not Disturb, so the UI shows a reminder instead.
 * The previous value is stored in settings so a crash still gets restored on next start.
 */
const WIN_KEY = 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\PushNotifications';

async function winGet(): Promise<string> {
  try {
    const { stdout } = await run('reg', ['query', WIN_KEY, '/v', 'ToastEnabled']);
    const m = /ToastEnabled\s+REG_DWORD\s+0x(\d+)/i.exec(stdout);
    return m ? String(parseInt(m[1], 16)) : '1';
  } catch {
    return '1';
  }
}

async function winSet(value: string): Promise<void> {
  await run('reg', ['add', WIN_KEY, '/v', 'ToastEnabled', '/t', 'REG_DWORD', '/d', value, '/f']);
}

async function gnomeGet(): Promise<string> {
  const { stdout } = await run('gsettings', ['get', 'org.gnome.desktop.notifications', 'show-banners']);
  return stdout.trim();
}

async function gnomeSet(value: string): Promise<void> {
  await run('gsettings', ['set', 'org.gnome.desktop.notifications', 'show-banners', value]);
}

export async function muteNotifications(mute: boolean): Promise<NotifyMuteResult> {
  if (process.platform === 'darwin') return 'unsupported';
  try {
    if (mute) {
      if (load().notifyBackup !== undefined) return 'ok';
      const before = process.platform === 'win32' ? await winGet() : await gnomeGet();
      save({ notifyBackup: before });
      if (process.platform === 'win32') await winSet('0');
      else await gnomeSet('false');
    } else {
      await restoreNotifications();
    }
    return 'ok';
  } catch {
    return process.platform === 'linux' ? 'unsupported' : 'failed';
  }
}

export async function restoreNotifications(): Promise<void> {
  const backup = load().notifyBackup;
  if (backup === undefined) return;
  try {
    if (process.platform === 'win32') await winSet(backup);
    else if (process.platform === 'linux') await gnomeSet(backup);
  } finally {
    save({ notifyBackup: undefined });
  }
}
