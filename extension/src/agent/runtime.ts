// Locates what a session needs at runtime: the Agent SDK entry, the Claude Code executable and
// the bundled agent-crew plugin — and checks them for the walkthrough's dependency step.

import { execFile } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import type { SdkModule } from './session';

export const PLUGIN_NAME = 'agent-crew';

export type ExecutableSource = 'setting' | 'bundled' | 'path' | 'missing';

export interface RuntimePaths {
  sdkEntry: string;
  executable?: string;
  executableSource: ExecutableSource;
  pluginPath: string;
  plugin?: { name: string; version?: string };
  problems: string[];
}

function binaryName(platform: NodeJS.Platform): string {
  return platform === 'win32' ? 'claude.exe' : 'claude';
}

export function findOnPath(command: string, envPath: string | undefined, platform: NodeJS.Platform = process.platform): string | undefined {
  if (!envPath) return undefined;
  const exts = platform === 'win32' ? ['.exe', '.cmd', ''] : [''];
  for (const dir of envPath.split(path.delimiter)) {
    if (!dir) continue;
    for (const ext of exts) {
      const candidate = path.join(dir, command + ext);
      if (existsSync(candidate)) return candidate;
    }
  }
  return undefined;
}

export function resolveRuntime(extensionPath: string, configuredExecutable: string, env: NodeJS.ProcessEnv = process.env): RuntimePaths {
  const problems: string[] = [];
  const sdkEntry = path.join(extensionPath, 'dist', 'sdk', 'sdk.mjs');
  if (!existsSync(sdkEntry)) problems.push('The Agent SDK runtime (dist/sdk) is missing from the extension build.');

  let executable: string | undefined;
  let executableSource: ExecutableSource = 'missing';
  const bundled = path.join(extensionPath, 'dist', 'bin', binaryName(process.platform));
  if (configuredExecutable.trim()) {
    const configured = configuredExecutable.trim();
    if (existsSync(configured)) {
      executable = configured;
      executableSource = 'setting';
    } else {
      problems.push(`crew.claudeCodePath points to "${configured}", which does not exist.`);
    }
  }
  if (!executable && existsSync(bundled)) {
    executable = bundled;
    executableSource = 'bundled';
    const targetFile = path.join(extensionPath, 'dist', 'bin', 'target.json');
    try {
      const staged = JSON.parse(readFileSync(targetFile, 'utf8')) as { target?: string };
      const os = process.platform === 'linux' && staged.target?.startsWith('alpine') ? 'alpine' : process.platform;
      if (staged.target && staged.target !== `${os}-${process.arch}`) {
        problems.push(`This build of Agent Crew is for ${staged.target}, but VS Code runs on ${process.platform}-${process.arch}. Install the matching VSIX.`);
      }
    } catch {
      // target.json is informational only
    }
  }
  if (!executable) {
    const onPath = findOnPath('claude', env.PATH ?? env.Path);
    if (onPath) {
      executable = onPath;
      executableSource = 'path';
    } else {
      problems.push('No Claude Code executable found: this build has no bundled binary, crew.claudeCodePath is empty and "claude" is not on PATH.');
    }
  }

  const pluginPath = path.join(extensionPath, 'resources', 'plugin');
  const manifestFile = path.join(pluginPath, '.claude-plugin', 'plugin.json');
  let plugin: RuntimePaths['plugin'];
  try {
    const manifest = JSON.parse(readFileSync(manifestFile, 'utf8')) as { name?: string; version?: string };
    if (manifest.name) plugin = manifest.version ? { name: manifest.name, version: manifest.version } : { name: manifest.name };
    if (manifest.name !== PLUGIN_NAME) problems.push(`The bundled plugin is named "${manifest.name ?? '?'}", expected "${PLUGIN_NAME}".`);
  } catch {
    problems.push('The agent-crew plugin is missing from the extension (resources/plugin).');
  }

  const result: RuntimePaths = { sdkEntry, executableSource, pluginPath, problems };
  if (executable) result.executable = executable;
  if (plugin) result.plugin = plugin;
  return result;
}

let sdkPromise: Promise<SdkModule> | undefined;

/** Loads dist/sdk/sdk.mjs (ESM) from the CommonJS extension bundle. */
export function loadSdk(sdkEntry: string): Promise<SdkModule> {
  sdkPromise ??= (import(pathToFileURL(sdkEntry).href) as Promise<SdkModule>).catch((err: unknown) => {
    sdkPromise = undefined;
    throw err;
  });
  return sdkPromise;
}

export function runVersion(executable: string, timeoutMs = 20_000): Promise<{ ok: boolean; output: string }> {
  return new Promise((resolve) => {
    execFile(executable, ['--version'], { timeout: timeoutMs, windowsHide: true }, (err, stdout, stderr) => {
      if (err) resolve({ ok: false, output: (stderr || err.message).trim() });
      else resolve({ ok: true, output: stdout.trim() });
    });
  });
}

export function gitVersion(): Promise<{ ok: boolean; output: string }> {
  return new Promise((resolve) => {
    execFile('git', ['--version'], { timeout: 10_000, windowsHide: true }, (err, stdout) => {
      resolve(err ? { ok: false, output: err.message } : { ok: true, output: stdout.trim() });
    });
  });
}
