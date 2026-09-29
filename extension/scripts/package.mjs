// Builds and packages a VSIX.
//
//   node scripts/package.mjs --target linux-x64      platform-specific VSIX with the bundled Claude Code binary
//   node scripts/package.mjs --universal             universal VSIX without the binary (needs crew.claudeCodePath)
//
// Versions with an odd minor (0.1.x, 0.3.x…) are packaged as pre-release automatically.
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const pkg = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8'));

function arg(name) {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

const universal = process.argv.includes('--universal');
const target = universal ? undefined : arg('--target');
if (!universal && !target) {
  console.error('Usage: node scripts/package.mjs (--target <vsce-target> | --universal)');
  process.exit(1);
}
const minor = Number(pkg.version.split('.')[1]);
const preRelease = minor % 2 === 1;

function run(cmd, args, env = {}) {
  console.log(`$ ${cmd} ${args.join(' ')}`);
  execFileSync(cmd, args, {
    cwd: root,
    stdio: 'inherit',
    env: { ...process.env, ...env },
    shell: process.platform === 'win32',
  });
}

run('node', ['scripts/copy-plugin.mjs', '--strict']);
run('node', ['scripts/stage-sdk.mjs', ...(universal ? ['--no-binary'] : ['--target', target])]);
run('node', ['scripts/build-extension.mjs', '--production']);
run('npx', ['vite', 'build', '--config', 'webview/vite.config.mts']);

mkdirSync(path.join(root, 'vsix'), { recursive: true });
const out = path.join('vsix', `${pkg.name}-${target ?? 'universal'}-${pkg.version}.vsix`);
run('npx', [
  'vsce',
  'package',
  '--no-dependencies',
  ...(target ? ['--target', target] : []),
  ...(preRelease ? ['--pre-release'] : []),
  '--out',
  out,
], target ? { VSCE_TARGET: target } : {});
console.log(`\nPackaged ${out}${preRelease ? ' (pre-release)' : ''}`);
