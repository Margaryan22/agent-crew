// Pure helpers about the official Claude Code extension (no VS Code API, so unit tests can use them).

import { existsSync, readFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export const CLAUDE_CODE_EXTENSION = 'anthropic.claude-code';
export const PLUGIN_NAME = 'agent-crew';
export const PLUGIN_MARKETPLACE = 'Margaryan22/agent-crew';

/** Claude Code's configuration folder: CLAUDE_CONFIG_DIR from its VS Code setting or the environment, else ~/.claude. */
export function claudeConfigDir(env: NodeJS.ProcessEnv, settingEnv: ReadonlyArray<{ name?: unknown; value?: unknown }> = [], home = os.homedir()): string {
  const fromSetting = settingEnv.find((v) => v.name === 'CLAUDE_CONFIG_DIR' && typeof v.value === 'string' && v.value.trim() !== '');
  const dir = (fromSetting?.value as string | undefined) ?? env.CLAUDE_CONFIG_DIR ?? path.join(home, '.claude');
  return dir.startsWith('~/') ? path.join(home, dir.slice(2)) : dir;
}

/**
 * Whether the agent-crew plugin is installed and not disabled, from Claude Code's own registry
 * (`plugins/installed_plugins.json`, `settings.json` → enabledPlugins). `undefined` when Claude
 * Code has no registry yet (never used plugins) — then the caller cannot tell.
 */
export function pluginInstalled(configDir: string): boolean | undefined {
  const registry = path.join(configDir, 'plugins', 'installed_plugins.json');
  if (!existsSync(registry)) return undefined;
  try {
    const data = JSON.parse(readFileSync(registry, 'utf8')) as { plugins?: Record<string, unknown> };
    const keys = Object.keys(data.plugins ?? {}).filter((k) => k.startsWith(`${PLUGIN_NAME}@`));
    if (!keys.length) return false;
    let enabled: Record<string, unknown> = {};
    try {
      enabled = (JSON.parse(readFileSync(path.join(configDir, 'settings.json'), 'utf8')) as { enabledPlugins?: Record<string, unknown> }).enabledPlugins ?? {};
    } catch {
      // no user settings: installed plugins are enabled by default
    }
    return keys.some((k) => enabled[k] !== false);
  } catch {
    return undefined;
  }
}

export function pluginInstallUri(scheme: string): string {
  const query = new URLSearchParams({ plugin: PLUGIN_NAME, marketplace: PLUGIN_MARKETPLACE });
  return `${scheme}://${CLAUDE_CODE_EXTENSION}/install-plugin?${query.toString()}`;
}
