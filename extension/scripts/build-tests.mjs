// Bundles the integration tests and prepares throwaway workspaces for them.
import * as esbuild from 'esbuild';
import { cpSync, mkdirSync, readdirSync, rmSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const out = path.join(root, 'out', 'test');
rmSync(out, { recursive: true, force: true });

const entries = readdirSync(path.join(root, 'test', 'integration'))
  .filter((f) => f.endsWith('.test.ts') || f.endsWith('-runner.ts'))
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

for (const name of ['workspace', 'workspace-untrusted']) {
  const dir = path.join(out, name);
  mkdirSync(dir, { recursive: true });
  cpSync(path.join(root, 'test', 'fixtures', 'workspace'), dir, { recursive: true });
}
console.log(`[build-tests] ${entries.length} suites → out/test/integration`);
