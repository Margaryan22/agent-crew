// Runs inside a real VS Code with workspace trust enabled and the folder not trusted
// (scripts/test-untrusted.mjs).
//
// An installed VSIX is disabled in Restricted Mode by `untrustedWorkspaces.supported: false`.
// VS Code does not apply that to an extension loaded with --extensionDevelopmentPath, so here the
// extension may be active — and then its own trust guard must refuse to start a session.
import * as assert from 'node:assert';
import * as vscode from 'vscode';
import type { CrewTestApi } from '../../src/extension';
import { FakeSdk } from '../unit/fakes';

const EXT_ID = 'agent-crew.agent-crew';

describe('Agent Crew — untrusted workspace', () => {
  it('never starts a session', async () => {
    assert.strictEqual(vscode.workspace.isTrusted, false, 'the test workspace must be untrusted');
    const ext = vscode.extensions.getExtension<CrewTestApi>(EXT_ID);
    if (!ext) return; // disabled entirely — nothing can start

    const api = await ext.activate();
    const sdk = new FakeSdk();
    api.setSdkLoader(async () => sdk);
    api.setRuntime({ sdkEntry: 'fake', executable: process.execPath, executableSource: 'setting', pluginPath: '/fake', plugin: { name: 'agent-crew' }, problems: [] });
    await api.secrets.setApiKey('sk-ant-api03-untrusted-test-0123456789abcdef');

    assert.strictEqual(await api.controller.newProject('should not run'), false);
    await vscode.commands.executeCommand('crew.newProjectDemo');
    await api.controller.submit('also should not run');
    assert.strictEqual(await api.controller.resume(), false);
    assert.strictEqual(sdk.queries.length, 0, 'no Agent SDK query may start in an untrusted workspace');
    assert.strictEqual(api.controller.isActive, false);
    await api.secrets.clearApiKey();
  });
});
