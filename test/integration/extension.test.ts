// Runs inside a real VS Code (trusted workspace) with the Agent SDK replaced by a fake.
import * as assert from 'node:assert';
import * as vscode from 'vscode';
import type { CrewTestApi } from '../../src/extension';
import type { ChatEntry } from '../../src/shared/protocol';
import { assistantText, FakeSdk, initMessage, resultMessage } from '../unit/fakes';

const EXT_ID = 'agent-crew.agent-crew';
const KEY = 'sk-ant-api03-integration-test-key-0123456789abcdef';

async function waitFor(check: () => boolean | Promise<boolean>, timeoutMs = 10_000): Promise<void> {
  const start = Date.now();
  while (!(await check())) {
    if (Date.now() - start > timeoutMs) throw new Error('Timed out');
    await new Promise((r) => setTimeout(r, 50));
  }
}

async function read(uri: vscode.Uri): Promise<string> {
  try {
    return new TextDecoder().decode(await vscode.workspace.fs.readFile(uri));
  } catch {
    return '';
  }
}

function write(uri: vscode.Uri, text: string): Thenable<void> {
  return vscode.workspace.fs.writeFile(uri, new TextEncoder().encode(text));
}

function chatEntries(api: CrewTestApi): ChatEntry[] {
  return api.posted.flatMap((m) => (m.type === 'append' || m.type === 'update' ? [m.entry] : []));
}

describe('Agent Crew — trusted workspace', () => {
  let api: CrewTestApi;
  let sdk: FakeSdk;
  let root: vscode.Uri;
  const crew = (rel: string) => vscode.Uri.joinPath(root, '.crew', ...rel.split('/'));

  before(async () => {
    const ext = vscode.extensions.getExtension<CrewTestApi>(EXT_ID);
    assert.ok(ext, 'extension is installed');
    api = await ext.activate();
    assert.ok(api, 'test API is returned in test mode');
    root = vscode.workspace.workspaceFolders![0]!.uri;
    sdk = new FakeSdk();
    api.setSdkLoader(async () => sdk);
    api.setRuntime({
      sdkEntry: 'fake',
      executable: process.execPath,
      executableSource: 'setting',
      pluginPath: '/fake/plugin',
      plugin: { name: 'agent-crew', version: 'test' },
      problems: [],
    });
  });

  after(async () => {
    await api.controller.stop();
    await api.secrets.clearApiKey();
  });

  it('registers every Crew command', async () => {
    const commands = await vscode.commands.getCommands(true);
    for (const c of ['newProject', 'feature', 'status', 'stop', 'resume', 'setApiKey', 'clearApiKey', 'openBrief', 'openStatus', 'enterLicense']) {
      assert.ok(commands.includes(`crew.${c}`), `crew.${c} is registered`);
    }
  });

  it('declares trust, extension kind and the walkthrough', () => {
    const pkg = vscode.extensions.getExtension(EXT_ID)!.packageJSON as {
      capabilities: { untrustedWorkspaces: { supported: boolean } };
      extensionKind: string[];
      contributes: { walkthroughs: { steps: unknown[] }[] };
    };
    assert.strictEqual(pkg.capabilities.untrustedWorkspaces.supported, false);
    assert.deepStrictEqual(pkg.extensionKind, ['workspace']);
    assert.strictEqual(pkg.contributes.walkthroughs[0].steps.length, 3);
    assert.ok(vscode.workspace.isTrusted);
  });

  it('reads .crew/ and follows task changes live', async () => {
    await waitFor(() => api.controller.currentSnapshot.tasks.length >= 2);
    assert.deepStrictEqual(
      api.controller.currentSnapshot.tasks.map((t) => [t.id, t.status]),
      [
        ['T-001', 'done'],
        ['T-002', 'in_progress'],
      ],
    );
    assert.strictEqual(api.controller.currentSnapshot.decisions[0]?.id, 'ADR-001');

    await write(crew('tasks/T-003.md'), '---\nstatus: blocked\nassignee: backend\n---\n# T-003: Payments\n');
    await waitFor(() => api.controller.currentSnapshot.tasks.some((t) => t.id === 'T-003' && t.status === 'blocked'));
    await write(crew('tasks/T-003.md'), '---\nstatus: done\nassignee: backend\n---\n# T-003: Payments\n');
    await waitFor(() => api.controller.currentSnapshot.tasks.some((t) => t.id === 'T-003' && t.status === 'done'));
  });

  it('opens the brief and the status file', async () => {
    await vscode.commands.executeCommand('crew.openStatus');
    assert.ok(vscode.window.activeTextEditor?.document.uri.path.endsWith('.crew/status.md'));
    await vscode.commands.executeCommand('crew.openBrief');
    assert.ok(vscode.window.activeTextEditor?.document.uri.path.endsWith('.crew/brief.md'));
    await vscode.commands.executeCommand('workbench.action.closeAllEditors');
  });

  it('loads the chat webview, which asks for its initial state', async () => {
    await vscode.commands.executeCommand('workbench.view.extension.crew');
    await vscode.commands.executeCommand('crew.chat.focus');
    await waitFor(() => api.posted.some((m) => m.type === 'init'), 30_000);
  });

  it('runs a session end to end and never exposes the API key', async () => {
    await api.secrets.setApiKey(KEY);
    assert.ok(await api.controller.newProject('habit tracker'));
    const q = sdk.last;
    await waitFor(() => q.userMessages.length === 1);
    assert.strictEqual(q.userMessages[0], '/agent-crew:new-project habit tracker');
    assert.strictEqual(q.options.env?.ANTHROPIC_API_KEY, KEY);

    q.emit(initMessage('it-session'));
    // A misbehaving agent echoes the key; the CLI prints it on stderr.
    q.emit(assistantText(`env dump: ANTHROPIC_API_KEY=${KEY}`));
    q.options.stderr?.(`debug ${KEY}\n`);
    q.emit(resultMessage('it-session', 0.42));
    await waitFor(() => chatEntries(api).some((e) => e.type === 'result'));

    const posted = JSON.stringify(api.posted);
    assert.ok(posted.includes('env dump'), 'agent text reached the webview');
    assert.ok(!posted.includes(KEY), 'key never reaches the webview');
    assert.ok(!api.logLines.join('\n').includes(KEY), 'key never reaches the log');
    const settings = JSON.stringify(vscode.workspace.getConfiguration().inspect('crew'));
    assert.ok(!settings.includes(KEY), 'key never reaches settings');
    assert.ok(!(await read(vscode.Uri.joinPath(root, '.vscode', 'settings.json'))).includes(KEY));

    await waitFor(async () => (await read(crew('costs.log'))).includes('session=it-session'));
    assert.ok((await read(crew('costs.log'))).includes('session_total_usd=0.420000'));
  });

  it('stops the session at the budget cap and notes it in status.md', async () => {
    await vscode.workspace.getConfiguration('crew').update('budgetCapUsd', 1, vscode.ConfigurationTarget.Workspace);
    const q = sdk.last;
    q.emit(resultMessage('it-session', 1.2));
    await waitFor(() => q.closed);
    await waitFor(async () => (await read(crew('status.md'))).includes('budget cap reached'));
    await vscode.workspace.getConfiguration('crew').update('budgetCapUsd', undefined, vscode.ConfigurationTarget.Workspace);
  });

  it('answers an escalation and resumes the waiting tool call', async () => {
    await waitFor(() => !api.controller.isActive);
    assert.ok(await api.controller.newProject('second idea'));
    const q = sdk.last;
    const pending = q.options.canUseTool!('Bash', { command: 'npm install', description: 'Install dependencies' }, {
      signal: new AbortController().signal,
      toolUseID: 'tu-1',
      requestId: 'rq-1',
    });
    let escalationId = '';
    await waitFor(() => {
      const card = chatEntries(api).find((e) => e.type === 'escalation' && e.status === 'open');
      if (card?.type === 'escalation') escalationId = card.escalationId;
      return Boolean(escalationId);
    });
    await api.controller.answerEscalation(escalationId, 'Allow');
    const result = await pending;
    assert.strictEqual(result?.behavior, 'allow');
    await waitFor(async () => (await read(crew(`escalations/${escalationId}.md`))).includes('status: answered'));
  });
});
