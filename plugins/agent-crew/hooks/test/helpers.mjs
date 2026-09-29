import { mkdtempSync, realpathSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadPolicy } from '../scripts/lib/policy.mjs';

export const pluginRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
export const policy = loadPolicy(pluginRoot, 'tanstack');

const created = [];
process.on('exit', () => {
  for (const dir of created) rmSync(dir, { recursive: true, force: true });
});

/** A temp dir removed when the test process exits. */
export function tempDir(prefix = 'crew-hook-') {
  // realpath: macOS tmp dirs are symlinks (/var → /private/var)
  const dir = realpathSync(mkdtempSync(path.join(os.tmpdir(), prefix)));
  created.push(dir);
  return dir;
}

export function tempProject() {
  return tempDir('crew-hook-project-');
}

/** Fake registry: name → { exists, ageDays, downloads } */
export function fakeRegistry(packages = {}) {
  const calls = [];
  const check = async (name) => {
    calls.push(name);
    const p = packages[name];
    if (p === 'offline') return { ok: false, reason: `could not verify package "${name}" in the npm registry (fetch failed)` };
    if (!p) return { ok: false, reason: `package "${name}" does not exist in the npm registry` };
    if (p.ageDays < 30) return { ok: false, reason: `package "${name}" is only ${p.ageDays} day(s) old (minimum 30)` };
    if (p.downloads < 1000) return { ok: false, reason: `package "${name}" has ${p.downloads} weekly downloads (minimum 1000)` };
    return { ok: true };
  };
  return { check, calls };
}

export function context(root, overrides = {}) {
  const registry = fakeRegistry(overrides.packages);
  return {
    ctx: {
      root,
      policy,
      checkPackage: registry.check,
      currentBranch: overrides.currentBranch ?? (() => 'crew/T-001'),
      home: overrides.home ?? '/Users/someone',
    },
    registry,
  };
}

export function bash(command, extra = {}) {
  return { tool_name: 'Bash', tool_input: { command }, ...extra };
}

export function write(file_path, content = 'x', extra = {}) {
  return { tool_name: 'Write', tool_input: { file_path, content }, ...extra };
}
