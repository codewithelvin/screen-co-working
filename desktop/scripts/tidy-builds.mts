// After a local build: keep only the deliverables in screen-co-working-builds/<version>/
// (exe, AppImage, deb, mac zips, cask). Unpacked folders and builder logs go.
// Usage: node scripts/tidy-builds.mts [version]
import { existsSync, readdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { buildsFor, version } from './builds-dir.mts';

const dir = buildsFor(process.argv[2] ?? version);
if (!existsSync(dir)) process.exit(0);
const keep = /\.(exe|AppImage|deb|zip|rb)$/;
for (const name of readdirSync(dir)) {
  if (!keep.test(name)) rmSync(join(dir, name), { recursive: true, force: true });
}
console.log(`${dir}: ${readdirSync(dir).join(', ')}`);
