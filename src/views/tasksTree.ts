// "Tasks" and "Decisions" tree views over the .crew snapshot, plus "Show Diff" for a task.

import * as vscode from 'vscode';
import { type CrewSnapshot, type Decision, TASK_STATUSES, type Task, type TaskStatus } from '../crew/model';
import type { Logger } from '../redact';

const GROUP_LABEL: Record<TaskStatus, string> = {
  todo: 'To do',
  in_progress: 'In progress',
  review: 'Review',
  done: 'Done',
  blocked: 'Blocked',
};

const GROUP_ICON: Record<TaskStatus, vscode.ThemeIcon> = {
  todo: new vscode.ThemeIcon('circle-large-outline'),
  in_progress: new vscode.ThemeIcon('sync', new vscode.ThemeColor('charts.blue')),
  review: new vscode.ThemeIcon('eye', new vscode.ThemeColor('charts.purple')),
  done: new vscode.ThemeIcon('pass', new vscode.ThemeColor('charts.green')),
  blocked: new vscode.ThemeIcon('error', new vscode.ThemeColor('charts.red')),
};

const EXPANDED: ReadonlySet<TaskStatus> = new Set(['in_progress', 'review', 'blocked']);

export type TaskNode = { kind: 'group'; status: TaskStatus; tasks: Task[] } | { kind: 'task'; task: Task };

export class TasksTreeProvider implements vscode.TreeDataProvider<TaskNode> {
  private readonly emitter = new vscode.EventEmitter<TaskNode | undefined>();
  readonly onDidChangeTreeData = this.emitter.event;
  private tasks: Task[] = [];

  constructor(private readonly root: vscode.Uri | undefined) {}

  update(snapshot: CrewSnapshot): void {
    this.tasks = snapshot.tasks;
    this.emitter.fire(undefined);
  }

  getChildren(element?: TaskNode): TaskNode[] {
    if (!element) {
      if (!this.tasks.length) return [];
      return TASK_STATUSES.map((status) => ({ kind: 'group', status, tasks: this.tasks.filter((t) => t.status === status) }));
    }
    return element.kind === 'group' ? element.tasks.map((task) => ({ kind: 'task', task })) : [];
  }

  getTreeItem(node: TaskNode): vscode.TreeItem {
    if (node.kind === 'group') {
      const state = node.tasks.length === 0 ? vscode.TreeItemCollapsibleState.None : EXPANDED.has(node.status) ? vscode.TreeItemCollapsibleState.Expanded : vscode.TreeItemCollapsibleState.Collapsed;
      const item = new vscode.TreeItem(GROUP_LABEL[node.status], state);
      item.id = `group:${node.status}`;
      item.description = String(node.tasks.length);
      item.iconPath = GROUP_ICON[node.status];
      item.contextValue = 'crewTaskGroup';
      return item;
    }
    const { task } = node;
    const item = new vscode.TreeItem(`${task.id} · ${task.title}`, vscode.TreeItemCollapsibleState.None);
    item.id = `task:${task.id}`;
    item.description = [task.assignee ?? 'unassigned', task.attempts > 0 ? `attempt ${task.attempts}` : undefined].filter(Boolean).join(' · ');
    item.iconPath = GROUP_ICON[task.status];
    item.contextValue = 'crewTask';
    const tooltip = new vscode.MarkdownString(undefined, true);
    tooltip.appendMarkdown(`**${task.id}** — ${escapeMd(task.title)}\n\n`);
    tooltip.appendMarkdown(`Status: ${GROUP_LABEL[task.status]}  \nAssignee: ${escapeMd(task.assignee ?? '—')}  \nAttempts: ${task.attempts}`);
    if (task.branch) tooltip.appendMarkdown(`  \nBranch: \`${escapeMd(task.branch)}\``);
    item.tooltip = tooltip;
    if (this.root) {
      item.resourceUri = vscode.Uri.joinPath(this.root, ...task.path.split('/'));
      item.command = { command: 'crew.openTask', title: 'Open Task', arguments: [node] };
    }
    return item;
  }
}

export class DecisionsTreeProvider implements vscode.TreeDataProvider<Decision> {
  private readonly emitter = new vscode.EventEmitter<Decision | undefined>();
  readonly onDidChangeTreeData = this.emitter.event;
  private decisions: Decision[] = [];

  constructor(private readonly root: vscode.Uri | undefined) {}

  update(snapshot: CrewSnapshot): void {
    this.decisions = snapshot.decisions;
    this.emitter.fire(undefined);
  }

  getChildren(element?: Decision): Decision[] {
    return element ? [] : this.decisions;
  }

  getTreeItem(decision: Decision): vscode.TreeItem {
    const item = new vscode.TreeItem(`${decision.id} · ${decision.title}`, vscode.TreeItemCollapsibleState.None);
    item.id = `adr:${decision.id}`;
    if (decision.status) item.description = decision.status;
    item.iconPath = new vscode.ThemeIcon('law');
    if (this.root) {
      const uri = vscode.Uri.joinPath(this.root, ...decision.path.split('/'));
      item.resourceUri = uri;
      item.command = { command: 'vscode.open', title: 'Open Decision', arguments: [uri] };
    }
    return item;
  }
}

function escapeMd(text: string): string {
  return text.replace(/[\\`*_{}[\]()#+\-.!|<>]/g, '\\$&');
}

// ---------------------------------------------------------------------------
// Show Diff (built-in Git extension API)

interface GitChange {
  uri: vscode.Uri;
  originalUri: vscode.Uri;
}
interface GitRepository {
  rootUri: vscode.Uri;
  state: { HEAD?: { name?: string } };
  diffBetween(ref1: string, ref2: string): Promise<GitChange[]>;
  diffWithHEAD(): Promise<GitChange[]>;
}
interface GitApi {
  repositories: GitRepository[];
  getRepository(uri: vscode.Uri): GitRepository | null;
  toGitUri(uri: vscode.Uri, ref: string): vscode.Uri;
}

async function gitApi(): Promise<GitApi | undefined> {
  const ext = vscode.extensions.getExtension<{ getAPI(version: 1): GitApi }>('vscode.git');
  if (!ext) return undefined;
  const exports = ext.isActive ? ext.exports : await ext.activate();
  return exports.getAPI(1);
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

export async function showTaskDiff(task: Task, root: vscode.Uri, log: Logger): Promise<void> {
  const api = await gitApi();
  const repo = api?.getRepository(root) ?? api?.repositories[0];
  if (!api || !repo) {
    void vscode.window.showWarningMessage('Show Diff needs a git repository and the built-in Git extension.');
    return;
  }
  try {
    let resources: DiffResource[];
    let title: string;
    if (task.branch) {
      const base = task.base ?? repo.state.HEAD?.name ?? 'main';
      const changes = await repo.diffBetween(base, task.branch);
      resources = changes.map((c) => [c.uri, api.toGitUri(c.originalUri, base), api.toGitUri(c.uri, task.branch!)]);
      title = `${task.id}: ${base} ↔ ${task.branch}`;
    } else if (task.files.length) {
      resources = task.files.map((file) => {
        const uri = vscode.Uri.joinPath(repo.rootUri, ...file.split('/'));
        return [uri, api.toGitUri(uri, 'HEAD'), uri];
      });
      title = `${task.id}: working tree`;
    } else {
      const changes = await repo.diffWithHEAD();
      resources = changes.map((c) => [c.uri, api.toGitUri(c.originalUri, 'HEAD'), c.uri]);
      title = `${task.id}: uncommitted changes`;
    }
    if (!resources.length) {
      void vscode.window.showInformationMessage(`No changes found for ${task.id}.`);
      return;
    }
    await openChanges(title, resources);
  } catch (err) {
    log.warn(`Show Diff failed for ${task.id}: ${String(err)}`);
    void vscode.window.showWarningMessage(`Could not compute the diff for ${task.id}: ${err instanceof Error ? err.message : String(err)}`);
  }
}
