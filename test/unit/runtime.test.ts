import { chmodSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { findOnPath, loadSdk, resolveRuntime, runVersion } from '../../src/agent/runtime';

const dirs: string[] = [];
function tempDir(): string {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'crew-runtime-'));
  dirs.push(dir);
  return dir;
}

function extension(opts: { sdk?: boolean; binary?: boolean; target?: string; plugin?: string | false } = {}): string {
  const root = tempDir();
  if (opts.sdk !== false) {
    mkdirSync(path.join(root, 'dist', 'sdk'), { recursive: true });
    writeFileSync(path.join(root, 'dist', 'sdk', 'sdk.mjs'), 'export function query() { return "fake"; }\n');
  }
  if (opts.binary) {
    mkdirSync(path.join(root, 'dist', 'bin'), { recursive: true });
    const bin = path.join(root, 'dist', 'bin', process.platform === 'win32' ? 'claude.exe' : 'claude');
    writeFileSync(bin, '#!/bin/sh\necho "9.9.9 (Claude Code)"\n');
    chmodSync(bin, 0o755);
    if (opts.target) writeFileSync(path.join(root, 'dist', 'bin', 'target.json'), JSON.stringify({ target: opts.target }));
  }
  if (opts.plugin !== false) {
    mkdirSync(path.join(root, 'resources', 'plugin', '.claude-plugin'), { recursive: true });
    writeFileSync(path.join(root, 'resources', 'plugin', '.claude-plugin', 'plugin.json'), JSON.stringify({ name: opts.plugin ?? 'agent-crew', version: '0.2.0' }));
  }
  return root;
}

const host = process.platform === 'linux' ? `linux-${process.arch}` : `${process.platform}-${process.arch}`;

afterEach(() => {
  dirs.length = 0;
});

describe('resolveRuntime', () => {
  it('uses the bundled binary and plugin', () => {
    const root = extension({ binary: true, target: host });
    const rt = resolveRuntime(root, '', { PATH: '' });
    expect(rt.executableSource).toBe('bundled');
    expect(rt.executable).toBe(path.join(root, 'dist', 'bin', process.platform === 'win32' ? 'claude.exe' : 'claude'));
    expect(rt.plugin).toEqual({ name: 'agent-crew', version: '0.2.0' });
    expect(rt.pluginPath).toBe(path.join(root, 'resources', 'plugin'));
    expect(rt.problems).toEqual([]);
  });

  it('prefers the configured executable and reports a wrong one', () => {
    const root = extension({ binary: true });
    const custom = path.join(tempDir(), 'my-claude');
    writeFileSync(custom, '');
    expect(resolveRuntime(root, custom, {}).executableSource).toBe('setting');
    const missing = resolveRuntime(root, '/nope/claude', {});
    expect(missing.executableSource).toBe('bundled');
    expect(missing.problems[0]).toContain('/nope/claude');
  });

  it('flags a binary built for another platform', () => {
    const rt = resolveRuntime(extension({ binary: true, target: 'win32-arm64' === host ? 'linux-x64' : 'win32-arm64' }), '', {});
    expect(rt.problems.some((p) => p.includes('Install the matching VSIX'))).toBe(true);
  });

  it('falls back to claude on PATH, then reports everything missing', () => {
    const bin = tempDir();
    writeFileSync(path.join(bin, process.platform === 'win32' ? 'claude.exe' : 'claude'), '');
    const onPath = resolveRuntime(extension(), '', { PATH: bin });
    expect(onPath.executableSource).toBe('path');

    const nothing = resolveRuntime(extension({ sdk: false, plugin: false }), '', { PATH: '' });
    expect(nothing.executable).toBeUndefined();
    expect(nothing.executableSource).toBe('missing');
    expect(nothing.plugin).toBeUndefined();
    expect(nothing.problems).toHaveLength(3);

    const renamed = resolveRuntime(extension({ plugin: 'other' }), '', { PATH: bin });
    expect(renamed.problems[0]).toContain('"other"');
  });

  it('findOnPath handles empty entries and Windows extensions', () => {
    const bin = tempDir();
    writeFileSync(path.join(bin, 'claude.cmd'), '');
    expect(findOnPath('claude', `${path.delimiter}${bin}`, 'win32')).toBe(path.join(bin, 'claude.cmd'));
    expect(findOnPath('claude', undefined)).toBeUndefined();
  });
});

describe('loadSdk and runVersion', () => {
  it('imports the staged ESM entry and runs --version', async () => {
    const root = extension({ binary: true });
    const sdk = await loadSdk(path.join(root, 'dist', 'sdk', 'sdk.mjs'));
    expect((sdk.query as unknown as () => string)()).toBe('fake');
    if (process.platform !== 'win32') {
      const bin = path.join(root, 'dist', 'bin', 'claude');
      expect(await runVersion(bin)).toEqual({ ok: true, output: '9.9.9 (Claude Code)' });
    }
    expect((await runVersion(path.join(root, 'missing'))).ok).toBe(false);
  });
});
