import { app } from 'electron';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

interface Stored {
  name: string;
  /** Saved OS notification state while we have it muted, restored after a crash (D14). */
  notifyBackup?: string;
}

const file = () => join(app.getPath('userData'), 'settings.json');

export function load(): Stored {
  try {
    const { name, notifyBackup } = JSON.parse(readFileSync(file(), 'utf8')) as Partial<Stored>;
    return { name: name ?? '', notifyBackup };
  } catch {
    return { name: '' };
  }
}

export function save(patch: Partial<Stored>): void {
  const next = { ...load(), ...patch };
  writeFileSync(file(), JSON.stringify(next, null, 2), 'utf8');
}
