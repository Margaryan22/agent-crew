// Runs as `vscode:prepublish`: refuses to package unless every runtime piece is in place.
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const required = [
  'dist/extension.js',
  'dist/webview/chat.js',
  'dist/webview/chat.css',
  'dist/sdk/sdk.mjs',
  'resources/plugin/.claude-plugin/plugin.json',
  'resources/icon.png',
];
const missing = required.filter((f) => !existsSync(path.join(root, f)));
if (missing.length) {
  console.error(`[verify-dist] Missing build outputs:\n  ${missing.join('\n  ')}\nRun "npm run package -- --target <target>".`);
  process.exit(1);
}

const plugin = JSON.parse(readFileSync(path.join(root, 'resources/plugin/.claude-plugin/plugin.json'), 'utf8'));
if (String(plugin.version ?? '').includes('stub') && process.env.CREW_ALLOW_STUB_PLUGIN !== '1') {
  console.error('[verify-dist] resources/plugin is the TEST STUB. Build with the real agent-crew plugin (AGENT_CREW_PLUGIN_DIR).');
  console.error('[verify-dist] For a local packaging check only, set CREW_ALLOW_STUB_PLUGIN=1.');
  process.exit(1);
}

const targetFile = path.join(root, 'dist/bin/target.json');
const expected = process.env.VSCE_TARGET;
if (existsSync(targetFile)) {
  const staged = JSON.parse(readFileSync(targetFile, 'utf8'));
  if (expected && staged.target !== expected) {
    console.error(`[verify-dist] dist/bin holds a ${staged.target} binary but the package target is ${expected}.`);
    process.exit(1);
  }
  console.log(`[verify-dist] OK (binary for ${staged.target})`);
} else {
  console.log('[verify-dist] OK (universal build, no bundled binary)');
}
