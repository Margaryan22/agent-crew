// Stages the Claude Agent SDK runtime into dist/ for the VSIX:
//   dist/sdk/sdk.mjs         self-contained ESM entry of @anthropic-ai/claude-agent-sdk
//   dist/bin/claude[.exe]    native Claude Code binary for one platform (from the SDK's optional deps)
//   dist/bin/target.json     which target/version the binary belongs to
//
// Usage: node scripts/stage-sdk.mjs [--target <vsce-target>] [--no-binary]
// Without --target the host platform is used. Binaries for other platforms are fetched with `npm pack`.
import { execFileSync } from 'node:child_process';
import { chmodSync, copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SDK = '@anthropic-ai/claude-agent-sdk';

/** vsce --target → SDK binary package suffix */
const TARGET_TO_PACKAGE = {
  'darwin-arm64': 'darwin-arm64',
  'darwin-x64': 'darwin-x64',
  'linux-x64': 'linux-x64',
  'linux-arm64': 'linux-arm64',
  'alpine-x64': 'linux-x64-musl',
  'alpine-arm64': 'linux-arm64-musl',
  'win32-x64': 'win32-x64',
  'win32-arm64': 'win32-arm64',
};

function arg(name) {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

function hostTarget() {
  const { platform, arch } = process;
  if (platform === 'linux') {
    const glibc = process.report?.getReport?.().header?.glibcVersionRuntime;
    return glibc ? `linux-${arch}` : `alpine-${arch}`;
  }
  return `${platform}-${arch}`;
}

const target = arg('--target') ?? process.env.CREW_TARGET ?? hostTarget();
const withBinary = !process.argv.includes('--no-binary');
const sdkDir = path.join(root, 'node_modules', ...SDK.split('/'));
if (!existsSync(sdkDir)) {
  console.error(`[stage-sdk] ${SDK} is not installed. Run npm install first.`);
  process.exit(1);
}
const sdkPkg = JSON.parse(readFileSync(path.join(sdkDir, 'package.json'), 'utf8'));

const outSdk = path.join(root, 'dist', 'sdk');
const outBin = path.join(root, 'dist', 'bin');
rmSync(outSdk, { recursive: true, force: true });
rmSync(outBin, { recursive: true, force: true });
mkdirSync(outSdk, { recursive: true });
for (const file of ['sdk.mjs', 'package.json', 'LICENSE.md', 'manifest.json']) {
  copyFileSync(path.join(sdkDir, file), path.join(outSdk, file));
}
console.log(`[stage-sdk] ${SDK}@${sdkPkg.version} → dist/sdk`);

if (!withBinary) {
  console.log('[stage-sdk] --no-binary: skipping the native Claude Code binary (universal build).');
  process.exit(0);
}

const suffix = TARGET_TO_PACKAGE[target];
if (!suffix) {
  console.error(`[stage-sdk] No Claude Code binary is published for target "${target}". Use --no-binary for a universal build.`);
  process.exit(1);
}
const binPkg = `${SDK}-${suffix}`;
const binName = suffix.startsWith('win32') ? 'claude.exe' : 'claude';

function binaryFromNodeModules() {
  const dir = path.join(root, 'node_modules', ...binPkg.split('/'));
  const file = path.join(dir, binName);
  if (!existsSync(file)) return undefined;
  const version = JSON.parse(readFileSync(path.join(dir, 'package.json'), 'utf8')).version;
  return version === sdkPkg.version ? file : undefined;
}

function binaryFromRegistry() {
  const tmp = mkdtempSync(path.join(os.tmpdir(), 'crew-sdk-'));
  const spec = `${binPkg}@${sdkPkg.version}`;
  console.log(`[stage-sdk] fetching ${spec} with npm pack…`);
  const out = execFileSync('npm', ['pack', spec, '--pack-destination', tmp, '--json'], {
    encoding: 'utf8',
    shell: process.platform === 'win32',
  });
  const tarball = path.join(tmp, JSON.parse(out)[0].filename);
  execFileSync('tar', ['-xzf', tarball, '-C', tmp]);
  return path.join(tmp, 'package', binName);
}

const source = binaryFromNodeModules() ?? binaryFromRegistry();
mkdirSync(outBin, { recursive: true });
const dest = path.join(outBin, binName);
copyFileSync(source, dest);
chmodSync(dest, 0o755);
writeFileSync(
  path.join(outBin, 'target.json'),
  JSON.stringify({ target, package: binPkg, version: sdkPkg.version, binary: binName }, null, 2) + '\n',
);
console.log(`[stage-sdk] ${binPkg}@${sdkPkg.version} → dist/bin/${binName} (target ${target})`);
