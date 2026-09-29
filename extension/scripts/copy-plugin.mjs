// Copies the agent-crew Claude Code plugin into resources/plugin so it ships inside the VSIX.
//
// Source lookup order:
//   1. AGENT_CREW_PLUGIN_DIR environment variable
//   2. ../plugins/agent-crew   (this repository)
//
// --strict   fail when no plugin is found (used for packaging / CI)
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const target = path.join(root, 'resources', 'plugin');
const strict = process.argv.includes('--strict');
const EXPECTED_NAME = 'agent-crew';
const SKIP = new Set(['.git', 'node_modules', '.DS_Store', '.github']);

function manifestOf(dir) {
  const file = path.join(dir, '.claude-plugin', 'plugin.json');
  if (!existsSync(file)) return undefined;
  try {
    return JSON.parse(readFileSync(file, 'utf8'));
  } catch (err) {
    throw new Error(`Invalid plugin manifest ${file}: ${err.message}`, { cause: err });
  }
}

const candidates = [
  process.env.AGENT_CREW_PLUGIN_DIR,
  path.join(root, '..', 'plugins', 'agent-crew'),
]
  .filter(Boolean)
  .map((p) => path.resolve(root, p));

const source = candidates.find((dir) => manifestOf(dir));

if (!source) {
  const message =
    `agent-crew plugin not found. Looked in:\n  ${candidates.join('\n  ')}\n` +
    'Set AGENT_CREW_PLUGIN_DIR to the plugin root (the folder containing .claude-plugin/plugin.json).';
  if (strict) {
    console.error(`[copy-plugin] ${message}`);
    process.exit(1);
  }
  if (manifestOf(target)) {
    console.warn(`[copy-plugin] ${message}\n[copy-plugin] Keeping the existing copy in resources/plugin.`);
  } else {
    console.warn(`[copy-plugin] ${message}\n[copy-plugin] The extension will report the plugin as missing at runtime.`);
  }
  process.exit(0);
}

const manifest = manifestOf(source);
if (manifest.name !== EXPECTED_NAME) {
  const msg = `[copy-plugin] Plugin at ${source} is named "${manifest.name}", expected "${EXPECTED_NAME}".`;
  if (strict) {
    console.error(msg);
    process.exit(1);
  }
  console.warn(msg);
}

rmSync(target, { recursive: true, force: true });
mkdirSync(target, { recursive: true });
cpSync(source, target, {
  recursive: true,
  filter: (src) => !SKIP.has(path.basename(src)),
});
console.log(`[copy-plugin] ${manifest.name}@${manifest.version ?? 'unversioned'} copied from ${source}`);
