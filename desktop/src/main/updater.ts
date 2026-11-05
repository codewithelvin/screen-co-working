import { app } from 'electron';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { chmodSync, createWriteStream, existsSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join } from 'node:path';
import { Readable } from 'node:stream';
import type { ReadableStream as WebReadableStream } from 'node:stream/web';
import { pipeline } from 'node:stream/promises';
import type { UpdateState } from '../shared/types';
import { UPDATE_PUBLIC_KEY } from '../shared/config';
import { isNewer } from '../shared/version';
import { type ServedManifest, verifiedManifest } from './manifest';
import { installKind, programFile } from './portable';

/**
 * Self-update (D19, D45). The LAN server publishes /updates/latest.json (scripts/publish-update.mts).
 * Portable exe and AppImage: download next to the program, check the SHA-256, swap on restart.
 * .deb: download to temp and open the system installer. Homebrew: nothing to download; the user
 * runs `brew upgrade` (the cask lives in the codewithelvin/homebrew-tap repo). The manifest must carry
 * a valid release-key signature (manifest.ts), and each file must match its signed SHA-256.
 */

/** Which latest.json entry this copy downloads; brew has none. */
const fileKey = { portable: 'win', appimage: 'linux', deb: 'deb', brew: null } as const;
const howFor = { portable: 'restart', appimage: 'restart', deb: 'installer', brew: 'brew' } as const;

let state: UpdateState = { status: 'idle' };
let staged: string | null = null;
let required = false;

export async function checkForUpdate(server: string, emit: (s: UpdateState) => void): Promise<void> {
  if (!app.isPackaged || !server || state.status === 'downloading' || state.status === 'ready') return;
  const kind = installKind();
  const key = fileKey[kind];
  const how = howFor[kind];
  const base = `http://${server.replace(/^https?:\/\//, '').replace(/\/+$/, '')}/updates/`;
  try {
    const res = await fetch(base + 'latest.json', { signal: AbortSignal.timeout(5000) });
    if (!res.ok) return;
    // Only a manifest signed with the release key counts; a forged server or file is ignored.
    const manifest = verifiedManifest((await res.json()) as ServedManifest, UPDATE_PUBLIC_KEY);
    if (!isNewer(manifest.version, app.getVersion())) return;
    required = !!manifest.minVersion && isNewer(manifest.minVersion, app.getVersion());
    if (key === null) {
      state = { status: 'ready', version: manifest.version, required, how };
      emit(state);
      return;
    }
    const entry = manifest.files[key];
    if (!entry) return;

    state = { status: 'downloading', version: manifest.version, required };
    emit(state);
    const target = programFile();
    const download = join(kind === 'deb' ? tmpdir() : dirname(target), kind === 'deb' ? basename(entry.file) : `.${basename(entry.file)}.part`);
    const file = await fetch(base + encodeURIComponent(entry.file));
    if (!file.ok || !file.body) throw new Error(`download failed (${file.status})`);
    const hash = createHash('sha256');
    const body = Readable.fromWeb(file.body as WebReadableStream<Uint8Array>);
    body.on('data', (chunk: Buffer) => hash.update(chunk));
    await pipeline(body, createWriteStream(download));
    if (hash.digest('hex') !== entry.sha256.toLowerCase()) {
      rmSync(download, { force: true });
      throw new Error('checksum mismatch');
    }
    staged = download;
    state = { status: 'ready', version: manifest.version, required, how };
    emit(state);
  } catch (e) {
    state = { status: 'error', message: e instanceof Error ? e.message : String(e), required };
    emit(state);
  }
}

/** Replace the program file with the staged download and start the new version. */
export function installUpdate(): void {
  if (!staged || !existsSync(staged)) return;
  if (installKind() === 'deb') {
    // The system installer (Software / gdebi) replaces /opt while we're gone; the user reopens the app.
    spawn('xdg-open', [staged], { detached: true, stdio: 'ignore' }).unref();
    app.exit(0);
    return;
  }
  const target = programFile();
  const pid = process.pid;

  if (process.platform === 'win32') {
    // The exe stays locked until we (and the portable launcher stub) have exited. A detached
    // script retries the move until it succeeds, then relaunches. No pipes: in a hidden,
    // console-less script `tasklist | find` can hang forever. PING is the delay, because
    // timeout.exe needs a console.
    const script = join(tmpdir(), `scw-update-${pid}.cmd`);
    const sleep = `"${join(process.env.SystemRoot ?? 'C:/Windows', 'System32', 'PING.EXE')}" -n 2 127.0.0.1 >nul`;
    writeFileSync(
      script,
      [
        '@echo off',
        'set m=0',
        ':retry',
        sleep,
        `move /Y "${staged}" "${target}" >nul 2>&1 && goto done`,
        'set /a m+=1',
        'if %m% geq 60 goto done',
        sleep,
        'goto retry',
        ':done',
        `start "" "${target}"`,
        'del "%~f0"',
      ].join('\r\n'),
    );
    spawn('cmd.exe', ['/c', script], { detached: true, stdio: 'ignore', windowsHide: true }).unref();
  } else {
    // An AppImage can be replaced while it runs.
    chmodSync(staged, 0o755);
    renameSync(staged, target);
    spawn(target, [], { detached: true, stdio: 'ignore' }).unref();
  }
  // Exit hard: a graceful quit can linger, and the swap script waits for this PID to end.
  app.exit(0);
}
