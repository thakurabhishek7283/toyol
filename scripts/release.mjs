// Publishes a new version: sets it, builds the signed installer, commits and
// tags, and puts the installer on a GitHub release with the latest.json that
// installed copies check for updates (tauri.conf.json > plugins > updater).
//
//   npm run release -- 0.2.0 "What changed"
//
// Needs the GitHub CLI, signed in (gh auth login), and the update signing key
// from `npx tauri signer generate`: ~/.tauri/toyol.key, or set
// TAURI_SIGNING_PRIVATE_KEY (and TAURI_SIGNING_PRIVATE_KEY_PASSWORD if it has
// one). Keep a copy of the key somewhere safe: installed copies accept only
// updates signed with it.

import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const REPO = 'thakurabhishek7283/toyol';
const KEY_FILE = join(homedir(), '.tauri', 'toyol.key');

function fail(message) {
  console.error(`\n${message}`);
  process.exit(1);
}

// npm and npx are .cmd files on Windows, which only start through a shell
function run(command, args, options = {}) {
  const shell = process.platform === 'win32' && ['npm', 'npx'].includes(command);
  const result = spawnSync(command, args, { cwd: ROOT, stdio: 'inherit', shell, ...options });
  if (result.status !== 0) fail(`Stopped: \`${command} ${args.join(' ')}\` failed.`);
}
const output = (command, args, cwd = ROOT) => execFileSync(command, args, { cwd, encoding: 'utf8' }).trim();
const succeeds = (command, args) => spawnSync(command, args, { cwd: ROOT, stdio: 'ignore' }).status === 0;

const [version, notes] = process.argv.slice(2);
if (!/^\d+\.\d+\.\d+$/.test(version ?? '')) fail('Usage: npm run release -- <version, e.g. 0.2.0> ["What changed"]');
const tag = `v${version}`;

// Everything that can stop it, before the long build
if (!succeeds('gh', ['auth', 'status'])) {
  fail('Needs the GitHub CLI, signed in: winget install GitHub.cli, then gh auth login');
}
if (output('git', ['status', '--porcelain'])) fail('Commit your changes first: a release is built from what is committed.');
if (succeeds('git', ['rev-parse', '-q', '--verify', `refs/tags/${tag}`])) fail(`${tag} is already released. Pick a newer version.`);
const current = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')).version;
const newer = (a, b) => a.split('.').map(Number).reduce((r, n, i) => r || Math.sign(n - b.split('.').map(Number)[i]), 0) > 0;
if (!newer(version, current)) fail(`${version} isn't newer than ${current}: installed copies only update to a newer version.`);

const signingKey = process.env.TAURI_SIGNING_PRIVATE_KEY ?? (existsSync(KEY_FILE) ? readFileSync(KEY_FILE, 'utf8').trim() : '');
if (!signingKey) fail(`No signing key: expected ${KEY_FILE}, or TAURI_SIGNING_PRIVATE_KEY.`);

// The version: tauri.conf.json reads package.json; Cargo.toml is kept in step
run('npm', ['version', version, '--no-git-tag-version']);
const cargoToml = join(ROOT, 'src-tauri', 'Cargo.toml');
writeFileSync(cargoToml, readFileSync(cargoToml, 'utf8').replace(/^version = ".*"$/m, `version = "${version}"`));

run('npx', ['tauri', 'build'], {
  env: {
    ...process.env,
    TAURI_SIGNING_PRIVATE_KEY: signingKey,
    TAURI_SIGNING_PRIVATE_KEY_PASSWORD: process.env.TAURI_SIGNING_PRIVATE_KEY_PASSWORD ?? '',
  },
});

// Where cargo put it (src-tauri/.cargo/config.toml moves the target folder)
const target = JSON.parse(output('cargo', ['metadata', '--format-version', '1', '--no-deps'], join(ROOT, 'src-tauri'))).target_directory;
const bundle = join(target, 'release', 'bundle', 'nsis');
const installer = join(bundle, `toyol_${version}_x64-setup.exe`);
if (!existsSync(installer) || !existsSync(`${installer}.sig`)) fail(`The signed installer isn't in ${bundle}.`);

const latest = join(bundle, 'latest.json');
writeFileSync(latest, JSON.stringify({
  version,
  notes: notes ?? '',
  pub_date: new Date().toISOString(),
  platforms: {
    'windows-x86_64': {
      signature: readFileSync(`${installer}.sig`, 'utf8').trim(),
      url: `https://github.com/${REPO}/releases/download/${tag}/toyol_${version}_x64-setup.exe`,
    },
  },
}, null, 2));

run('git', ['add', 'package.json', 'package-lock.json', 'src-tauri/Cargo.toml', 'src-tauri/Cargo.lock']);
run('git', ['commit', '-m', `Release ${version}`]);
run('git', ['tag', tag]);
run('git', ['push', 'origin', 'HEAD', tag]);

const notesFile = join(bundle, 'release-notes.md');
writeFileSync(notesFile, notes || `toyol ${version}`);
run('gh', ['release', 'create', tag, installer, latest, '--repo', REPO, '--title', `toyol ${version}`, '--notes-file', notesFile, '--verify-tag']);

console.log(`\nReleased ${version}: installed copies offer it within six hours, or at their next start.`);
