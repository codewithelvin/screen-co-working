import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { promisify } from 'node:util';
import type { AccessPoint } from '../shared/types';

const run = promisify(execFile);
const MAX_APS = 20;

/**
 * Wi-Fi fingerprint for proximity (D37): visible access points with signal 0..100.
 * BSSIDs are hashed before they leave the machine. Returns [] when there is no Wi-Fi
 * (wired PC) or the OS doesn't allow a scan (macOS without Location Services): the
 * server then treats the person as alone.
 */
export async function wifiFingerprint(): Promise<AccessPoint[]> {
  if (process.env.SCW_FAKE_WIFI) return fake(process.env.SCW_FAKE_WIFI);
  try {
    const raw = process.platform === 'win32' ? await windows() : process.platform === 'linux' ? await linux() : [];
    return raw
      .sort((a, b) => b.s - a.s)
      .slice(0, MAX_APS)
      .map((p) => ({ h: hash(p.bssid), s: p.s }));
  } catch {
    return [];
  }
}

function hash(bssid: string): string {
  return createHash('sha256').update(`scw-wifi-v1:${bssid.toLowerCase()}`).digest('hex').slice(0, 16);
}

/** Tests: SCW_FAKE_WIFI='[{"b":"aa:bb:..","s":80}]' stands in for a real scan. */
function fake(json: string): AccessPoint[] {
  try {
    return (JSON.parse(json) as { b: string; s: number }[]).map((p) => ({ h: hash(p.b), s: p.s }));
  } catch {
    return [];
  }
}

interface Raw {
  bssid: string;
  s: number;
}

/** `netsh wlan show networks mode=bssid`: "BSSID 1 : f4:e2:..." followed by "Signal : 83%". */
async function windows(): Promise<Raw[]> {
  const { stdout } = await run('netsh', ['wlan', 'show', 'networks', 'mode=bssid'], { windowsHide: true, timeout: 8000 });
  const out: Raw[] = [];
  let bssid: string | null = null;
  for (const line of stdout.split(/\r?\n/)) {
    const b = /^\s*BSSID\s+\d+\s*:\s*([0-9a-f]{2}(?::[0-9a-f]{2}){5})/i.exec(line);
    if (b) {
      bssid = b[1];
      continue;
    }
    const s = /^\s*\S+\s*:\s*(\d{1,3})%\s*$/.exec(line); // "Signal : 83%" (label is localised)
    if (bssid && s) {
      out.push({ bssid, s: Math.min(100, Number(s[1])) });
      bssid = null;
    }
  }
  return out;
}

/** `nmcli -t -f BSSID,SIGNAL dev wifi list`: "F4\:E2\:C6\:E9\:02\:9B:83" (colons in the BSSID escaped). */
async function linux(): Promise<Raw[]> {
  const { stdout } = await run('nmcli', ['-t', '-f', 'BSSID,SIGNAL', 'dev', 'wifi', 'list'], { timeout: 8000 });
  return stdout
    .split('\n')
    .map((line) => /^((?:[0-9A-F]{2}\\:){5}[0-9A-F]{2}):(\d{1,3})$/i.exec(line.trim()))
    .filter((m): m is RegExpExecArray => m !== null)
    .map((m) => ({ bssid: m[1].replace(/\\/g, ''), s: Number(m[2]) }));
}
