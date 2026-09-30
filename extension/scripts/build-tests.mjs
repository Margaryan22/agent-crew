// Bundles the integration tests and prepares a throwaway workspace with the contract's golden
// .crew/ folder (../crew-contract/fixtures/valid) for them.
import * as esbuild from 'esbuild';
import { cpSync, mkdirSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const out = path.join(root, 'out', 'test');
rmSync(out, { recursive: true, force: true });

const entries = readdirSync(path.join(root, 'test', 'integration'))
  .filter((f) => f.endsWith('.test.ts'))
  .map((f) => path.join(root, 'test', 'integration', f));

await esbuild.build({
  entryPoints: entries,
  outdir: path.join(out, 'integration'),
  bundle: true,
  platform: 'node',
  format: 'cjs',
  target: 'node20',
  external: ['vscode', 'mocha'],
  sourcemap: 'inline',
  logLevel: 'warning',
});

const workspace = path.join(out, 'workspace');
mkdirSync(workspace, { recursive: true });
cpSync(path.join(root, '..', 'crew-contract', 'fixtures', 'valid', '.crew'), path.join(workspace, '.crew'), { recursive: true });
writeFileSync(path.join(workspace, 'README.md'), '# Integration test workspace\n');
console.log(`[build-tests] ${entries.length} suites → out/test/integration`);
