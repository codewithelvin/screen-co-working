import { generateKeyPairSync, sign } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { verifiedManifest } from '../../src/main/manifest';
import { UPDATE_PUBLIC_KEY } from '../../src/shared/config';

const release = generateKeyPairSync('ed25519');
const pub = release.publicKey.export({ format: 'der', type: 'spki' }).toString('base64');
const manifest = { version: '9.9.9', files: { win: { file: 'Screen-Co-Working-9.9.9-win-portable.exe', sha256: 'ab'.repeat(32) } } };

function served(payload: string, key = release.privateKey) {
  return { ...manifest, signed: { payload, sig: sign(null, Buffer.from(payload), key).toString('base64') } };
}

describe('verifiedManifest', () => {
  it('accepts a manifest signed with the release key', () => {
    expect(verifiedManifest(served(JSON.stringify(manifest)), pub)).toEqual(manifest);
  });

  it('refuses an unsigned manifest (what a forged server would serve)', () => {
    expect(() => verifiedManifest(manifest, pub)).toThrow('unsigned update');
  });

  it('refuses a payload changed after signing (e.g. another checksum)', () => {
    const s = served(JSON.stringify(manifest));
    s.signed.payload = s.signed.payload.replace('abab', 'cdcd');
    expect(() => verifiedManifest(s, pub)).toThrow('not valid');
  });

  it('refuses a manifest signed with another key', () => {
    const other = generateKeyPairSync('ed25519');
    expect(() => verifiedManifest(served(JSON.stringify(manifest), other.privateKey), pub)).toThrow('not valid');
  });

  it('trusts only the signed payload, not the top-level fields old apps read', () => {
    const s = { ...served(JSON.stringify(manifest)), version: '99.0.0' };
    expect(verifiedManifest(s, pub).version).toBe('9.9.9');
  });

  it('the shipped public key is a valid Ed25519 key', () => {
    expect(() => verifiedManifest(manifest, UPDATE_PUBLIC_KEY)).toThrow('unsigned update');
  });
});
