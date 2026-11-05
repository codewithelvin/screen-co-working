import { app } from 'electron';
import { accessSync, constants, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';

/**
 * How this copy was delivered: the Windows portable exe and the Linux AppImage are single files the
 * app can replace itself; the .deb (under /opt) and the Homebrew cask (in /Applications) are installed
 * by a package manager.
 */
export type InstallKind = 'portable' | 'appimage' | 'deb' | 'brew';

export function installKind(): InstallKind {
  if (process.platform === 'darwin') return 'brew';
  if (process.platform === 'linux') return process.env.APPIMAGE ? 'appimage' : 'deb';
  return 'portable';
}

/**
 * Portable mode: keep settings and Chromium data next to the program file, so the
 * app runs from any folder or USB stick without installing. Falls back to the
 * normal per-user folder when that location is read-only (e.g. Program Files).
 */
export function programFile(): string {
  // electron-builder "portable" (Windows) unpacks to a temp dir and reports the real exe here.
  if (process.env.PORTABLE_EXECUTABLE_FILE) return process.env.PORTABLE_EXECUTABLE_FILE;
  // AppImage (Linux) runs from a mount; the real file is in APPIMAGE.
  if (process.env.APPIMAGE) return process.env.APPIMAGE;
  return process.execPath;
}

export function setupPortableData(): void {
  // Lets one machine run several instances side by side (development and testing).
  if (process.env.SCW_DATA_DIR) {
    app.setPath('userData', process.env.SCW_DATA_DIR);
    return;
  }
  // Installed copies (deb, brew) keep the normal per-user folder.
  if (!app.isPackaged || (installKind() !== 'portable' && installKind() !== 'appimage')) return;
  const dir = join(dirname(programFile()), 'ScreenCoWorking-data');
  try {
    mkdirSync(dir, { recursive: true });
    accessSync(dir, constants.W_OK);
    app.setPath('userData', dir);
    app.setPath('sessionData', join(dir, 'session'));
  } catch {
    // not writable: keep the default userData folder
  }
}
