import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { shell } from 'electron';
import type { MicAccess } from '../shared/types';

const execAsync = promisify(execFile);
const run = (args: string[]) => execAsync('reg', args, { windowsHide: true, timeout: 5000 });

/**
 * Windows' microphone privacy switches. When "Let desktop apps access your microphone" is off,
 * Windows does not refuse the mic: it hands the app a device that records pure silence
 * (live test, 2026-11-05). So a silent mic is checked against these switches.
 * - HKLM ...\microphone: "Microphone access" for the whole device (admin only; we can only report it).
 * - HKCU ...\microphone and \NonPackaged: this user's switch and the desktop-apps switch.
 */
const STORE = 'Software\\Microsoft\\Windows\\CurrentVersion\\CapabilityAccessManager\\ConsentStore\\microphone';
const USER = `HKCU\\${STORE}`;
const DESKTOP = `HKCU\\${STORE}\\NonPackaged`;
const DEVICE = `HKLM\\${STORE}`;

async function read(key: string): Promise<string> {
  try {
    const { stdout } = await run(['query', key, '/v', 'Value']);
    return /Value\s+REG_SZ\s+(\S+)/i.exec(stdout)?.[1] ?? '';
  } catch {
    return ''; // key missing = never switched = allowed
  }
}

export async function micAccess(): Promise<MicAccess> {
  if (process.platform !== 'win32') return 'allowed';
  const [device, user, desktop] = await Promise.all([read(DEVICE), read(USER), read(DESKTOP)]);
  if (device.toLowerCase() === 'deny') return 'blocked-device';
  if (user.toLowerCase() === 'deny' || desktop.toLowerCase() === 'deny') return 'blocked';
  return 'allowed';
}

/** Turns this user's two switches on; the person asked for it with the "İcazə ver" button. */
export async function allowMic(): Promise<MicAccess> {
  if (process.platform !== 'win32') return 'allowed';
  for (const key of [USER, DESKTOP]) await run(['add', key, '/v', 'Value', '/t', 'REG_SZ', '/d', 'Allow', '/f']);
  return micAccess();
}

export function openMicSettings(): Promise<void> {
  return shell.openExternal(
    process.platform === 'win32'
      ? 'ms-settings:privacy-microphone'
      : 'x-apple.systempreferences:com.apple.preference.security?Privacy_Microphone',
  );
}
