// Creates the release key that signs latest.json (security review, 2026-11-05).
// Usage: node scripts/update-key.mts
// The private key goes to ~/.screen-co-working/update-signing-key.pem (or SCW_UPDATE_KEY) and must
// never be committed or copied to the server. Back it up: without it, apps that check signatures
// can only be updated by hand. The printed public key goes into src/shared/config.ts.
import { createPrivateKey, createPublicKey, generateKeyPairSync } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { keyPath, writePrivateKey } from './signing.mts';

const path = keyPath();
if (existsSync(path)) {
  // Never overwrite: a new key would lock out every app that trusts the old one.
  const pub = createPublicKey(createPrivateKey(readFileSync(path))).export({ format: 'der', type: 'spki' });
  console.log(`key already exists: ${path}\npublic key: ${pub.toString('base64')}`);
  process.exit(0);
}
const { privateKey, publicKey } = generateKeyPairSync('ed25519');
writePrivateKey(path, privateKey.export({ format: 'pem', type: 'pkcs8' }).toString());
console.log(`private key: ${path}  (back it up; never commit it)`);
console.log(`public key:  ${publicKey.export({ format: 'der', type: 'spki' }).toString('base64')}`);
