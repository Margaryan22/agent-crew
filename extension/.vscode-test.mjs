import { defineConfig } from '@vscode/test-cli';

const version = process.env.VSCODE_TEST_VERSION ?? 'stable';

// The untrusted-workspace suite runs through scripts/test-untrusted.mjs:
// @vscode/test-electron always passes --disable-workspace-trust.
export default defineConfig([
  {
    label: 'trusted',
    version,
    files: 'out/test/integration/extension.test.js',
    workspaceFolder: 'out/test/workspace',
    launchArgs: ['--disable-workspace-trust', '--disable-extensions'],
    mocha: { ui: 'bdd', timeout: 60_000 },
  },
]);
