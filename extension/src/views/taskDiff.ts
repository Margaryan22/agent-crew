// "Show Diff" for a task. Crew agents commit their task's files as `T-NNN: …` on the run's
// branch, so a task's change is: its files, from before its first commit to its last commit.
// Without such commits (work not committed yet) the files are compared with HEAD.

import { execFile } from 'node:child_process';
import * as vscode from 'vscode';
import type { TaskView } from '../crew/model';
import type { Logger } from '../log';

interface GitApi {
  toGitUri(uri: vscode.Uri, ref: string): vscode.Uri;
}

async function gitApi(): Promise<GitApi | undefined> {
  const ext = vscode.extensions.getExtension<{ getAPI(version: 1): GitApi }>('vscode.git');
  if (!ext) return undefined;
  const exports = ext.isActive ? ext.exports : await ext.activate();
  return exports.getAPI(1);
}

function git(cwd: string, args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile('git', args, { cwd, timeout: 10_000, maxBuffer: 4 * 1024 * 1024 }, (err, stdout) => (err ? reject(err) : resolve(stdout)));
  });
}

/** Commits of a task, oldest first, found by the `T-NNN:` message prefix. */
export function taskCommits(logOutput: string): string[] {
  return logOutput
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => /^[0-9a-f]{7,40}$/.test(l))
    .reverse();
}

type DiffResource = [vscode.Uri, vscode.Uri | undefined, vscode.Uri | undefined];

async function openChanges(title: string, resources: DiffResource[]): Promise<void> {
  try {
    await vscode.commands.executeCommand('vscode.changes', title, resources);
    return;
  } catch {
    // Multi-file diff editor unavailable (older VS Code forks): pick one file instead.
  }
  const picked = await vscode.window.showQuickPick(
    resources.map((r) => ({ label: vscode.workspace.asRelativePath(r[0]), resource: r })),
    { placeHolder: title },
  );
  if (!picked) return;
  const [uri, original, modified] = picked.resource;
  await vscode.commands.executeCommand('vscode.diff', original ?? uri, modified ?? uri, `${vscode.workspace.asRelativePath(uri)} (${title})`);
}

export async function showTaskDiff(task: TaskView, root: vscode.Uri, log: Logger): Promise<void> {
  const api = await gitApi();
  if (!api) {
    void vscode.window.showWarningMessage('Show Diff needs the built-in Git extension.');
    return;
  }
  try {
    const commits = taskCommits(await git(root.fsPath, ['log', '--format=%H', `--grep=^${task.id}:`, '--all']).catch(() => ''));
    const files = task.files?.length
      ? task.files
      : commits.length
        ? [...new Set((await git(root.fsPath, ['show', '--name-only', '--format=', ...commits])).split('\n').filter(Boolean))]
        : [];
    if (!files.length) {
      void vscode.window.showInformationMessage(`${task.id} has no recorded files or commits yet.`);
      return;
    }
    const first = commits[0];
    const last = commits[commits.length - 1];
    const base = first ? `${first}~1` : 'HEAD';
    const resources: DiffResource[] = files.map((file) => {
      const uri = vscode.Uri.joinPath(root, ...file.split('/'));
      return [uri, api.toGitUri(uri, base), last ? api.toGitUri(uri, last) : uri];
    });
    await openChanges(first ? `${task.id}: ${commits.length} commit${commits.length > 1 ? 's' : ''}` : `${task.id}: uncommitted changes`, resources);
  } catch (err) {
    log.warn(`Show Diff failed for ${task.id}: ${String(err)}`);
    void vscode.window.showWarningMessage(`Could not compute the diff for ${task.id}: ${err instanceof Error ? err.message : String(err)}`);
  }
}
