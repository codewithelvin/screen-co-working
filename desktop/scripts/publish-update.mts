// Writes latest.json for the self-updater (D19) and copies the builds into an updates folder.
// Usage: node scripts/publish-update.mts <updates-dir>   (e.g. ../deploy/updates, or the server's folder)
import { createHash } from 'node:crypto';
import { copyFileSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const pkg = JSON.parse(readFileSync('package.json', 'utf8')) as { version: string };
const target = process.argv[2];
const from = process.argv[3] ?? 'release';
if (!target) {
  console.error('usage: node scripts/publish-update.mts <updates-dir> [release-dir]');
  process.exit(1);
}
mkdirSync(target, { recursive: true });

const kinds: Record<string, RegExp> = {
  win: new RegExp(`-${pkg.version}-win-portable\.exe$`),
  linux: new RegExp(`-${pkg.version}-linux-x64\.AppImage$`),
  mac: new RegExp(`-${pkg.version}-mac-(arm64|x64)\.zip$`),
};

const files: Record<string, { file: string; sha256: string }> = {};
for (const name of readdirSync(from)) {
  const kind = Object.keys(kinds).find((k) => kinds[k].test(name));
  if (!kind) continue;
  const data = readFileSync(join(from, name));
  files[kind] = { file: name, sha256: createHash('sha256').update(data).digest('hex') };
  copyFileSync(join(from, name), join(target, name));
  console.log(`${kind}: ${name}`);
}
if (Object.keys(files).length === 0) {
  console.error(`no builds for version ${pkg.version} in ${from} — run npm run dist first`);
  process.exit(1);
}
writeFileSync(join(target, 'latest.json'), JSON.stringify({ version: pkg.version, files }, null, 2));
console.log(`latest.json -> ${pkg.version}`);
