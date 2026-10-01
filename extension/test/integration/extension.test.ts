// Runs inside a real VS Code on a workspace holding the contract's golden .crew/ folder.
// Claude Code is not installed there: in test mode the extension records what it would send.
import * as assert from 'node:assert';
import * as vscode from 'vscode';
import type { CrewTestApi } from '../../src/extension';

const EXT_ID = 'whysargis.agent-crew-claude-code';

async function waitFor(check: () => boolean | Promise<boolean>, timeoutMs = 10_000): Promise<void> {
  const start = Date.now();
  while (!(await check())) {
    if (Date.now() - start > timeoutMs) throw new Error('Timed out');
    await new Promise((r) => setTimeout(r, 50));
  }
}

async function read(uri: vscode.Uri): Promise<string> {
  return new TextDecoder().decode(await vscode.workspace.fs.readFile(uri));
}

describe('Agent Crew — companion extension', () => {
  let api: CrewTestApi;
  let root: vscode.Uri;
  const crew = (rel: string) => vscode.Uri.joinPath(root, '.crew', ...rel.split('/'));

  before(async () => {
    const ext = vscode.extensions.getExtension<CrewTestApi>(EXT_ID);
    assert.ok(ext, 'extension is installed');
    api = await ext.activate();
    assert.ok(api, 'test API is returned in test mode');
    root = vscode.workspace.workspaceFolders![0]!.uri;
  });

  it('registers its commands', async () => {
    const all = await vscode.commands.getCommands(true);
    for (const id of [
      'crew.newProject',
      'crew.feature',
      'crew.fix',
      'crew.deploy',
      'crew.continue',
      'crew.status',
      'crew.answerEscalation',
      'crew.installClaudeCode',
      'crew.installPlugin',
      'crew.checkSetup',
      'crew.openBrief',
      'crew.openReport',
      'crew.showTaskDiff',
      'crew.refresh',
    ]) {
      assert.ok(all.includes(id), `${id} is registered`);
    }
  });

  it('reads the project from .crew/', async () => {
    const s = await api.refresh();
    assert.strictEqual(s.exists, true);
    assert.strictEqual(s.initialised, true);
    assert.strictEqual(s.status?.phase, 'tasks');
    assert.deepStrictEqual(
      s.tasks.map((t) => t.id),
      ['T-001', 'T-002', 'T-003'],
    );
    assert.strictEqual(s.escalations.find((e) => e.id === 'E-002')?.status, 'open');
    assert.strictEqual(s.latestSession?.id, '1b2c3d4e-0000-4000-8000-000000000001');
  });

  it('follows changes to .crew/ files', async () => {
    const task = crew('tasks/T-004.md');
    await vscode.workspace.fs.writeFile(
      task,
      new TextEncoder().encode(
        '---\nid: T-004\ntitle: Weekly report\nstatus: todo\nowner: backend\nattempts: 0\ncreated_at: "2026-09-30T10:00:00Z"\nupdated_at: "2026-09-30T10:00:00Z"\n---\n\n# T-004: Weekly report\n',
      ),
    );
    await waitFor(() => api.snapshot().tasks.some((t) => t.id === 'T-004'));
    await vscode.workspace.fs.delete(task);
    await waitFor(() => !api.snapshot().tasks.some((t) => t.id === 'T-004'));
  });

  it('writes an answer to an escalation through the contract', async () => {
    await api.answer('E-002', 'Skip payments in v1');
    const text = await read(crew('escalations/E-002.md'));
    assert.match(text, /status: answered/);
    assert.match(text, /answer: Skip payments in v1/);
    assert.match(text, /answered_by: human/);
    assert.match(text, /## Answer\n\nSkip payments in v1/);
    assert.strictEqual(api.snapshot().escalations.find((e) => e.id === 'E-002')?.status, 'answered');
  });

  it('continues the run in its own Claude Code session', async () => {
    await vscode.commands.executeCommand('crew.continue');
    assert.deepStrictEqual(api.launches.at(-1), { prompt: '/agent-crew:continue', sessionId: '1b2c3d4e-0000-4000-8000-000000000001' });
  });
});
