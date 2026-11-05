// Download a release's CI builds (exe, AppImage, deb, mac zips) into screen-co-working-builds/<version>/,
// write the Homebrew cask next to them, and push it to the tap when a clone is present.
// Usage: node scripts/fetch-builds.mts [version]       (the release tag is v<version>)
// Tap: git clone https://github.com/codewithelvin/homebrew-tap.git ../../screen-co-working-builds/homebrew-tap
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { BUILDS, buildsFor, version as current } from './builds-dir.mts';

const REPO = 'codewithelvin/screen-co-working';
const version = process.argv[2] ?? current;
const dir = buildsFor(version);
mkdirSync(dir, { recursive: true });

const res = await fetch(`https://api.github.com/repos/${REPO}/releases/tags/v${version}`, {
  headers: { accept: 'application/vnd.github+json' },
});
if (!res.ok) {
  console.error(`release v${version} not found (${res.status}); is the CI run finished?`);
  process.exit(1);
}
const release = (await res.json()) as { assets: { name: string; browser_download_url: string }[] };

const sha: Record<string, string> = {};
for (const a of release.assets) {
  const target = join(dir, a.name);
  if (!existsSync(target)) {
    const file = await fetch(a.browser_download_url);
    if (!file.ok) throw new Error(`${a.name}: HTTP ${file.status}`);
    writeFileSync(target, Buffer.from(await file.arrayBuffer()));
  }
  sha[a.name] = createHash('sha256').update(readFileSync(target)).digest('hex');
  console.log(`${a.name}  ${sha[a.name]}`);
}

const zip = (arch: string) => `Screen-Co-Working-${version}-mac-${arch}.zip`;
if (!sha[zip('arm64')] || !sha[zip('x64')]) {
  console.error('mac zips missing from the release; no cask written');
  process.exit(1);
}

// Unsigned (ad-hoc) app: the postflight clears the quarantine flag so Gatekeeper lets it start.
const cask = `cask "screen-co-working" do
  arch arm: "arm64", intel: "x64"

  version "${version}"
  sha256 arm:   "${sha[zip('arm64')]}",
         intel: "${sha[zip('x64')]}"

  url "https://github.com/${REPO}/releases/download/v#{version}/Screen-Co-Working-#{version}-mac-#{arch}.zip"
  name "Screen Co-Working"
  desc "Silent screen-only co-working on the office LAN"
  homepage "https://github.com/${REPO}"

  depends_on macos: ">= :monterey"

  app "Screen Co-Working.app"

  postflight do
    system_command "/usr/bin/xattr",
                   args: ["-dr", "com.apple.quarantine", "#{appdir}/Screen Co-Working.app"]
  end

  zap trash: "~/Library/Application Support/Screen Co-Working"
end
`;
writeFileSync(join(dir, 'screen-co-working.rb'), cask);
console.log(`cask -> ${join(dir, 'screen-co-working.rb')}`);

const tap = join(BUILDS, 'homebrew-tap');
if (existsSync(join(tap, '.git'))) {
  mkdirSync(join(tap, 'Casks'), { recursive: true });
  writeFileSync(join(tap, 'Casks', 'screen-co-working.rb'), cask);
  const git = (...args: string[]) => execFileSync('git', ['-C', tap, ...args], { stdio: 'inherit' });
  const hasRemoteBranch = execFileSync('git', ['-C', tap, 'ls-remote', '--heads', 'origin', 'main']).length > 0;
  if (hasRemoteBranch) git('pull', '--ff-only', 'origin', 'main');
  git('add', 'Casks/screen-co-working.rb');
  git('commit', '-m', `screen-co-working ${version}`);
  git('push', '-u', 'origin', 'main');
  console.log('tap updated: brew update && brew upgrade --cask screen-co-working');
} else {
  console.log(`no tap clone at ${tap}; cask not pushed`);
}
