// Runs test/integration/untrusted.test.ts in a VS Code window whose folder is NOT trusted.
// @vscode/test-electron always adds --disable-workspace-trust, so this launches VS Code itself.
import { downloadAndUnzipVSCode } from '@vscode/test-electron';
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const executable = await downloadAndUnzipVSCode({ version: process.env.VSCODE_TEST_VERSION ?? 'stable', cachePath: path.join(root, '.vscode-test') });
const profile = mkdtempSync(path.join(os.tmpdir(), 'crew-untrusted-'));

const args = [
  '--no-sandbox',
  '--disable-gpu-sandbox',
  '--disable-updates',
  '--skip-welcome',
  '--skip-release-notes',
  '--no-cached-data',
  '--disable-extensions',
  `--user-data-dir=${path.join(profile, 'user-data')}`,
  `--extensions-dir=${path.join(profile, 'extensions')}`,
  `--extensionDevelopmentPath=${root}`,
  `--extensionTestsPath=${path.join(root, 'out', 'test', 'integration', 'untrusted-runner.js')}`,
  path.join(root, 'out', 'test', 'workspace-untrusted'),
];

const child = spawn(executable, args, { stdio: 'inherit', env: { ...process.env, ELECTRON_RUN_AS_NODE: undefined } });
child.on('exit', (code) => {
  rmSync(profile, { recursive: true, force: true });
  console.log(`[test-untrusted] exit code ${code}`);
  process.exit(code ?? 1);
});
