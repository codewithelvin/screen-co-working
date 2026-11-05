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
import { isNewer } from '../shared/version';
import { programFile } from './portable';

/**
 * Self-update for the portable builds (D19). electron-updater cannot update a portable
 * Windows exe, so the app does it itself: the LAN server publishes /updates/latest.json
 * (written by scripts/publish-update.ts), the app downloads its own platform's file next
 * to itself, checks the SHA-256, and swaps it in on restart.
 */
interface Manifest {
  version: string;
  files: Partial<Record<'win' | 'linux' | 'mac', { file: string; sha256: string }>>;
}

const platformKey = { win32: 'win', linux: 'linux', darwin: 'mac' } as const;

let state: UpdateState = { status: 'idle' };
let staged: string | null = null;

export async function checkForUpdate(server: string, emit: (s: UpdateState) => void): Promise<void> {
  if (!app.isPackaged || !server || state.status === 'downloading' || state.status === 'ready') return;
  const key = platformKey[process.platform as keyof typeof platformKey];
  if (!key) return;
  const base = `http://${server.replace(/^https?:\/\//, '').replace(/\/+$/, '')}/updates/`;
  try {
    const res = await fetch(base + 'latest.json', { signal: AbortSignal.timeout(5000) });
    if (!res.ok) return;
    const manifest = (await res.json()) as Manifest;
    const entry = manifest.files[key];
    if (!entry || !isNewer(manifest.version, app.getVersion())) return;

    state = { status: 'downloading', version: manifest.version };
    emit(state);
    const target = programFile();
    const download = join(process.platform === 'darwin' ? tmpdir() : dirname(target), `.${basename(entry.file)}.part`);
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
    state = { status: 'ready', version: manifest.version };
    emit(state);
  } catch (e) {
    state = { status: 'error', message: e instanceof Error ? e.message : String(e) };
    emit(state);
  }
}

/** Replace the program file with the staged download and start the new version. */
export function installUpdate(): void {
  if (!staged || !existsSync(staged)) return;
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
  } else if (process.platform === 'linux') {
    // An AppImage can be replaced while it runs.
    chmodSync(staged, 0o755);
    renameSync(staged, target);
    spawn(target, [], { detached: true, stdio: 'ignore' }).unref();
  } else {
    // macOS: the download is a zip of the .app bundle.
    const script = join(tmpdir(), `scw-update-${pid}.sh`);
    writeFileSync(
      script,
      [
        '#!/bin/sh',
        `while kill -0 ${pid} 2>/dev/null; do sleep 1; done`,
        `tmp=$(mktemp -d)`,
        `ditto -x -k "${staged}" "$tmp" && rm -rf "${target}" && mv "$tmp"/*.app "${target}"`,
        `rm -f "${staged}"`,
        `open "${target}"`,
      ].join('\n'),
    );
    chmodSync(script, 0o755);
    spawn('/bin/sh', [script], { detached: true, stdio: 'ignore' }).unref();
  }
  // Exit hard: a graceful quit can linger, and the swap script waits for this PID to end.
  app.exit(0);
}
