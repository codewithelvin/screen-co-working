import { type ChildProcessWithoutNullStreams, execFile, spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createInterface } from 'node:readline';
import { promisify } from 'node:util';
import type { AccessPoint, WifiScan } from '../shared/types';

const run = promisify(execFile);
const MAX_APS = 20;

/**
 * Wi-Fi fingerprint for proximity (D37): visible access points with signal 0..100.
 * BSSIDs are hashed before they leave the machine. An empty list (wired PC, no permission)
 * makes the server treat the person as alone; `status` tells the UI why.
 */
export async function wifiFingerprint(): Promise<WifiScan> {
  if (process.env.SCW_FAKE_WIFI) return { status: 'ok', aps: fake(process.env.SCW_FAKE_WIFI) };
  try {
    const scan: RawScan =
      process.platform === 'win32'
        ? await windows()
        : process.platform === 'linux'
          ? { status: 'ok', aps: await linux() }
          : { status: 'unavailable', aps: [] };
    const aps = scan.aps
      .sort((a, b) => b.s - a.s)
      .slice(0, MAX_APS)
      .map((p) => ({ h: hash(p.bssid), s: p.s }));
    return { status: scan.status, aps };
  } catch {
    return { status: 'unavailable', aps: [] };
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

interface RawScan {
  status: WifiScan['status'];
  aps: Raw[];
}

// ---------- Windows ----------
//
// `netsh wlan show networks` only prints Windows' cached list, which is barely refreshed while the
// PC is connected: in the office it showed 1 access point where a real scan finds 8 (2026-11-05).
// So a hidden PowerShell helper calls the Wi-Fi API itself: each request returns the BSS list of
// the previous scan (at most ~20 s old) and starts the next scan, so nothing waits. On Windows 11
// 24H2+ the API needs "Let desktop apps access your location"; without it the helper says "denied".

const HELPER = String.raw`
$src = @'
using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;
using System.Text;
using System.Threading;
public static class ScwWlan {
  [DllImport("wlanapi.dll")] static extern int WlanOpenHandle(uint v, IntPtr r, out uint nv, out IntPtr h);
  [DllImport("wlanapi.dll")] static extern int WlanEnumInterfaces(IntPtr h, IntPtr r, out IntPtr list);
  [DllImport("wlanapi.dll")] static extern int WlanScan(IntPtr h, ref Guid g, IntPtr ssid, IntPtr ie, IntPtr r);
  [DllImport("wlanapi.dll")] static extern int WlanGetNetworkBssList(IntPtr h, ref Guid g, IntPtr ssid, int type, bool sec, IntPtr r, out IntPtr list);
  [DllImport("wlanapi.dll")] static extern void WlanFreeMemory(IntPtr p);
  static IntPtr handle = IntPtr.Zero;
  static bool scanned = false;
  static List<Guid> Interfaces() {
    var result = new List<Guid>();
    IntPtr list;
    if (WlanEnumInterfaces(handle, IntPtr.Zero, out list) != 0) return result;
    int n = Marshal.ReadInt32(list);
    for (int i = 0; i < n; i++) result.Add((Guid)Marshal.PtrToStructure(list + 8 + i * 532, typeof(Guid)));
    WlanFreeMemory(list);
    return result;
  }
  public static string Next() {
    if (handle == IntPtr.Zero) {
      uint nv;
      if (WlanOpenHandle(2, IntPtr.Zero, out nv, out handle) != 0) { handle = IntPtr.Zero; return "{\"status\":\"unavailable\"}"; }
    }
    var ifaces = Interfaces();
    if (ifaces.Count == 0) return "{\"status\":\"no-wifi\"}";
    if (!scanned) {
      for (int i = 0; i < ifaces.Count; i++) { Guid g = ifaces[i]; WlanScan(handle, ref g, IntPtr.Zero, IntPtr.Zero, IntPtr.Zero); }
      Thread.Sleep(4000);
      scanned = true;
    }
    var sb = new StringBuilder();
    bool denied = false;
    int count = 0;
    for (int i = 0; i < ifaces.Count; i++) {
      Guid g = ifaces[i];
      IntPtr bl;
      int rc = WlanGetNetworkBssList(handle, ref g, IntPtr.Zero, 3, false, IntPtr.Zero, out bl);
      if (rc == 5) { denied = true; continue; }
      if (rc != 0) continue;
      int cnt = Marshal.ReadInt32(bl, 4);
      for (int k = 0; k < cnt; k++) {
        IntPtr e = bl + 8 + k * 360;
        byte[] mac = new byte[6];
        Marshal.Copy(e + 40, mac, 0, 6);
        int link = Marshal.ReadInt32(e + 60);
        if (count++ > 0) sb.Append(",");
        sb.Append("{\"b\":\"" + BitConverter.ToString(mac).Replace("-", ":") + "\",\"s\":" + link + "}");
      }
      WlanFreeMemory(bl);
    }
    for (int i = 0; i < ifaces.Count; i++) { Guid g = ifaces[i]; WlanScan(handle, ref g, IntPtr.Zero, IntPtr.Zero, IntPtr.Zero); }
    if (count == 0 && denied) return "{\"status\":\"denied\"}";
    return "{\"status\":\"ok\",\"aps\":[" + sb.ToString() + "]}";
  }
}
'@
Add-Type -TypeDefinition $src
while ($null -ne ($line = [Console]::In.ReadLine())) {
  try { [Console]::Out.WriteLine([ScwWlan]::Next()) } catch { [Console]::Out.WriteLine('{"status":"unavailable"}') }
  [Console]::Out.Flush()
}
`;

let helper: ChildProcessWithoutNullStreams | null = null;
const waiting: ((line: string) => void)[] = [];

function startHelper(): ChildProcessWithoutNullStreams {
  const file = join(tmpdir(), 'scw-wifi-scan-v1.ps1');
  writeFileSync(file, HELPER);
  const child = spawn(
    'powershell.exe',
    ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', file],
    { windowsHide: true },
  );
  createInterface({ input: child.stdout }).on('line', (line) => waiting.shift()?.(line));
  child.on('exit', () => {
    helper = null;
    for (const w of waiting.splice(0)) w('{"status":"unavailable"}');
  });
  return child;
}

async function windows(): Promise<RawScan> {
  helper ??= startHelper();
  const line = await new Promise<string>((resolve) => {
    const timer = setTimeout(() => resolve('timeout'), 20_000);
    waiting.push((l) => {
      clearTimeout(timer);
      resolve(l);
    });
    helper?.stdin.write('scan\n');
  });
  try {
    const r = JSON.parse(line) as { status: WifiScan['status']; aps?: { b: string; s: number }[] };
    if (r.status === 'ok') return { status: 'ok', aps: (r.aps ?? []).map((p) => ({ bssid: p.b, s: Math.min(100, p.s) })) };
    if (r.status !== 'unavailable') return { status: r.status, aps: [] };
  } catch {
    // timeout or garbage: fall through to netsh
  }
  return { status: 'ok', aps: await netsh() };
}

/** Fallback: `netsh wlan show networks mode=bssid` (cached list): "BSSID 1 : f4:e2:..." then "Signal : 83%". */
async function netsh(): Promise<Raw[]> {
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

export function stopWifiHelper(): void {
  helper?.kill();
  helper = null;
}

/** `nmcli -t -f BSSID,SIGNAL dev wifi list`: "F4\:E2\:C6\:E9\:02\:9B:83" (colons in the BSSID escaped). */
async function linux(): Promise<Raw[]> {
  const { stdout } = await run('nmcli', ['-t', '-f', 'BSSID,SIGNAL', 'dev', 'wifi', 'list', '--rescan', 'auto'], {
    timeout: 8000,
  });
  return stdout
    .split('\n')
    .map((line) => /^((?:[0-9A-F]{2}\\:){5}[0-9A-F]{2}):(\d{1,3})$/i.exec(line.trim()))
    .filter((m): m is RegExpExecArray => m !== null)
    .map((m) => ({ bssid: m[1].replace(/\\/g, ''), s: Number(m[2]) }));
}
