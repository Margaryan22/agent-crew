import { defineConfig } from '@vscode/test-cli';

const version = process.env.VSCODE_TEST_VERSION ?? 'stable';

export default defineConfig([
  {
    label: 'trusted',
    version,
    files: 'out/test/integration/*.test.js',
    workspaceFolder: 'out/test/workspace',
    launchArgs: ['--disable-workspace-trust', '--disable-extensions'],
    mocha: { ui: 'bdd', timeout: 60_000 },
  },
]);
