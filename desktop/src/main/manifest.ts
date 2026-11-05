import { createPublicKey, verify } from 'node:crypto';

/** What latest.json promises: the newest version and its files' checksums. */
export interface Manifest {
  version: string;
  /** Apps below this must update; the server refuses their joins. */
  minVersion?: string;
  files: Partial<Record<'win' | 'linux' | 'deb' | 'mac', { file: string; sha256: string }>>;
}

/**
 * latest.json as served. The top-level fields are for apps up to 0.3.6 and for the server; newer
 * apps trust only `signed`: the same manifest as a JSON string plus an Ed25519 signature made
 * with the release key, which never lives on the server (security review, 2026-11-05).
 */
export interface ServedManifest extends Partial<Manifest> {
  signed?: { payload: string; sig: string };
}

/** The signed manifest, or an error if it is missing, altered or signed with another key. */
export function verifiedManifest(raw: ServedManifest, publicKey: string): Manifest {
  const s = raw.signed;
  if (!s || typeof s.payload !== 'string' || typeof s.sig !== 'string') throw new Error('unsigned update');
  const key = createPublicKey({ key: Buffer.from(publicKey, 'base64'), format: 'der', type: 'spki' });
  if (!verify(null, Buffer.from(s.payload, 'utf8'), key, Buffer.from(s.sig, 'base64'))) {
    throw new Error('update signature is not valid');
  }
  const m = JSON.parse(s.payload) as Manifest;
  if (typeof m.version !== 'string' || typeof m.files !== 'object' || m.files === null) throw new Error('bad manifest');
  return m;
}
