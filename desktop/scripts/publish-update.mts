// Writes latest.json for the self-updater (D19) and copies the builds into an updates folder.
// Usage: node scripts/publish-update.mts <updates-dir> [builds-dir] [--min <version>]
// builds-dir defaults to screen-co-working-builds/<version>/ (a local build or fetch-builds).
// --min: apps below this version are refused by the server and must update before joining.
// Without --min the previous minimum in <updates-dir>/latest.json is kept.
// Macs update through Homebrew, so the mac zips are not published here.
// The manifest is signed with the release key (scripts/update-key.mts); apps from 0.3.7 on refuse
// an update without a valid signature.
import { createHash } from 'node:crypto';
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { buildsFor, version } from './builds-dir.mts';
import { signPayload } from './signing.mts';

const args = process.argv.slice(2);
const minAt = args.indexOf('--min');
const minArg = minAt >= 0 ? args.splice(minAt, 2)[1] : undefined;
const [target, from = buildsFor(version)] = args;
if (!target || (minAt >= 0 && !/^\d+\.\d+\.\d+$/.test(minArg ?? ''))) {
  console.error('usage: node scripts/publish-update.mts <updates-dir> [builds-dir] [--min <x.y.z>]');
  process.exit(1);
}
mkdirSync(target, { recursive: true });

const v = version.replace(/\./g, '\\.');
const kinds: Record<string, RegExp> = {
  win: new RegExp(`-${v}-win-portable\\.exe$`),
  linux: new RegExp(`-${v}-linux-(x64|x86_64)\\.AppImage$`),
  deb: new RegExp(`-${v}-linux-(x64|amd64)\\.deb$`),
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
  console.error(`no builds for version ${version} in ${from} — run npm run dist first`);
  process.exit(1);
}
const manifestPath = join(target, 'latest.json');
const previous = existsSync(manifestPath)
  ? (JSON.parse(readFileSync(manifestPath, 'utf8')) as { minVersion?: string }).minVersion
  : undefined;
const minVersion = minArg ?? previous;
const manifest = { version, ...(minVersion ? { minVersion } : {}), files };
const payload = JSON.stringify(manifest);
// Top-level fields: apps up to 0.3.6 and the server (minVersion) read those. `signed`: everyone newer.
writeFileSync(manifestPath, JSON.stringify({ ...manifest, signed: { payload, sig: signPayload(payload) } }, null, 2));
console.log(`latest.json -> ${version}${minVersion ? ` (minimum ${minVersion})` : ''}`);
