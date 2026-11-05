// Release-key helpers for update-key.mts and publish-update.mts.
import { createPrivateKey, sign } from 'node:crypto';
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';

export function keyPath(): string {
  return process.env.SCW_UPDATE_KEY ?? join(homedir(), '.screen-co-working', 'update-signing-key.pem');
}

export function writePrivateKey(path: string, pem: string): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, pem, { mode: 0o600 });
  chmodSync(path, 0o600);
}

/** Signs the manifest JSON string with the release key; refuses to go on without one. */
export function signPayload(payload: string): string {
  const path = keyPath();
  if (!existsSync(path)) {
    throw new Error(`no release key at ${path} — restore it from the backup (or create one: node scripts/update-key.mts)`);
  }
  return sign(null, Buffer.from(payload, 'utf8'), createPrivateKey(readFileSync(path))).toString('base64');
}
