// Runs as `vscode:prepublish`: refuses to package unless the bundle and resources are in place.
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const required = ['dist/extension.js', 'resources/icon.png', 'resources/crew.svg', 'resources/walkthrough/first-project.md'];
const missing = required.filter((f) => !existsSync(path.join(root, f)));
if (missing.length) {
  console.error(`[verify-dist] Missing build outputs:\n  ${missing.join('\n  ')}\nRun "npm run package".`);
  process.exit(1);
}
console.log('[verify-dist] OK');
