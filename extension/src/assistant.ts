// The official Claude Code extension does the AI work on the user's own subscription; Agent Crew
// only installs the plugin into it, starts crew commands and reopens sessions. Everything here
// goes through Claude Code's public surface: its command `claude-vscode.primaryEditor.open`
// (session id, prompt — the prompt is pre-filled, the user presses Enter) and its URI handler
// `/install-plugin?plugin=…&marketplace=…` (opens the plugin dialog in the Claude Code chat).

import * as vscode from 'vscode';
import { CLAUDE_CODE_EXTENSION, claudeConfigDir, pluginInstalled, pluginInstallUri } from './claudeCode';

export { CLAUDE_CODE_EXTENSION };
const OPEN_COMMAND = 'claude-vscode.primaryEditor.open';

export function isClaudeCodeInstalled(): boolean {
  return vscode.extensions.getExtension(CLAUDE_CODE_EXTENSION) !== undefined;
}

export function isPluginInstalled(): boolean | undefined {
  const settingEnv = vscode.workspace.getConfiguration('claudeCode').get<Array<{ name?: unknown; value?: unknown }>>('environmentVariables', []);
  return pluginInstalled(claudeConfigDir(process.env, Array.isArray(settingEnv) ? settingEnv : []));
}

export async function installClaudeCode(): Promise<void> {
  await vscode.commands.executeCommand('workbench.extensions.installExtension', CLAUDE_CODE_EXTENSION);
}

/** Opens Claude Code's plugin dialog for agent-crew (the user confirms the install there). */
export async function openPluginInstall(): Promise<boolean> {
  return vscode.env.openExternal(vscode.Uri.parse(pluginInstallUri(vscode.env.uriScheme), true));
}

export interface Launcher {
  /** Opens a Claude Code session: the given one, or a new one; the prompt is pre-filled. */
  open(prompt: string | undefined, sessionId: string | undefined): Promise<void>;
}

export const claudeCodeLauncher: Launcher = {
  async open(prompt, sessionId) {
    await vscode.commands.executeCommand(OPEN_COMMAND, sessionId, prompt);
  },
};
