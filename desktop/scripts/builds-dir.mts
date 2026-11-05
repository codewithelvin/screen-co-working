import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/** The sibling folder Desktop/Projects/screen-co-working-builds, one sub-folder per version. */
export const BUILDS = join(import.meta.dirname, '..', '..', '..', 'screen-co-working-builds');

export const version = (JSON.parse(readFileSync(join(import.meta.dirname, '..', 'package.json'), 'utf8')) as { version: string })
  .version;

export const buildsFor = (v: string): string => join(BUILDS, v);
