// Builds and packages the universal VSIX (the extension has no native parts and no bundled
// runtime: the crew runs in the Claude Code extension).
//
//   node scripts/package.mjs
//
// Versions with an odd minor (0.1.x, 0.3.x…) are packaged as pre-release automatically.
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const pkg = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8'));
const preRelease = Number(pkg.version.split('.')[1]) % 2 === 1;

function run(cmd, args) {
  console.log(`$ ${cmd} ${args.join(' ')}`);
  execFileSync(cmd, args, { cwd: root, stdio: 'inherit', shell: process.platform === 'win32' });
}

run('node', ['scripts/build-extension.mjs', '--production']);
mkdirSync(path.join(root, 'vsix'), { recursive: true });
const out = path.join('vsix', `${pkg.name}-${pkg.version}.vsix`);
run('npx', ['vsce', 'package', '--no-dependencies', ...(preRelease ? ['--pre-release'] : []), '--out', out]);
console.log(`\nPackaged ${out}${preRelease ? ' (pre-release)' : ''}`);
