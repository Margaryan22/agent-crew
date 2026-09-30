import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { claudeConfigDir, pluginInstalled, pluginInstallUri } from '../../src/claudeCode';

const dirs: string[] = [];
afterAll(() => {
  for (const dir of dirs) rmSync(dir, { recursive: true, force: true });
});

function configDir(files: Record<string, unknown>): string {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'crew-claude-'));
  dirs.push(dir);
  for (const [rel, value] of Object.entries(files)) {
    mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
    writeFileSync(path.join(dir, rel), typeof value === 'string' ? value : JSON.stringify(value));
  }
  return dir;
}

describe('Claude Code integration', () => {
  it('finds the config folder like Claude Code does', () => {
    expect(claudeConfigDir({}, [], '/home/u')).toBe('/home/u/.claude');
    expect(claudeConfigDir({ CLAUDE_CONFIG_DIR: '/cfg' }, [], '/home/u')).toBe('/cfg');
    expect(claudeConfigDir({ CLAUDE_CONFIG_DIR: '/cfg' }, [{ name: 'CLAUDE_CONFIG_DIR', value: '~/work-claude' }], '/home/u')).toBe('/home/u/work-claude');
    expect(claudeConfigDir({}, [{ name: 'CLAUDE_CONFIG_DIR', value: '' }], '/home/u')).toBe('/home/u/.claude');
  });

  it('reads the plugin registry', () => {
    const entry = [{ scope: 'user', version: '0.1.0' }];
    expect(pluginInstalled(configDir({}))).toBeUndefined();
    expect(pluginInstalled(configDir({ 'plugins/installed_plugins.json': { version: 2, plugins: { 'other@x': entry } } }))).toBe(false);
    expect(pluginInstalled(configDir({ 'plugins/installed_plugins.json': { version: 2, plugins: { 'agent-crew@agent-crew': entry } } }))).toBe(true);
    expect(
      pluginInstalled(
        configDir({
          'plugins/installed_plugins.json': { version: 2, plugins: { 'agent-crew@agent-crew': entry } },
          'settings.json': { enabledPlugins: { 'agent-crew@agent-crew': false } },
        }),
      ),
    ).toBe(false);
    expect(pluginInstalled(configDir({ 'plugins/installed_plugins.json': '{broken' }))).toBeUndefined();
  });

  it('builds the install link Claude Code accepts', () => {
    expect(pluginInstallUri('vscode')).toBe('vscode://anthropic.claude-code/install-plugin?plugin=agent-crew&marketplace=Margaryan22%2Fagent-crew');
    expect(pluginInstallUri('cursor')).toMatch(/^cursor:\/\/anthropic\.claude-code\//);
    // Claude Code decodes the query and checks the marketplace against "owner/repo".
    const query = new URL(pluginInstallUri('vscode')).searchParams;
    expect(query.get('marketplace')).toBe('Margaryan22/agent-crew');
    expect(query.get('plugin')).toBe('agent-crew');
  });
});
