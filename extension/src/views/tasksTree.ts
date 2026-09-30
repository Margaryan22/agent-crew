// "Tasks" tree: the crew's tasks from .crew/tasks/, grouped by what needs attention first.

import * as vscode from 'vscode';
import type { CrewSnapshot, TaskView } from '../crew/model';

type Status = TaskView['status'];

const GROUPS: ReadonlyArray<{ status: Status; label: string; icon: vscode.ThemeIcon; expanded: boolean }> = [
  { status: 'blocked', label: 'Blocked', icon: new vscode.ThemeIcon('error', new vscode.ThemeColor('charts.red')), expanded: true },
  { status: 'in_progress', label: 'In progress', icon: new vscode.ThemeIcon('sync', new vscode.ThemeColor('charts.blue')), expanded: true },
  { status: 'review', label: 'In review', icon: new vscode.ThemeIcon('eye', new vscode.ThemeColor('charts.purple')), expanded: true },
  { status: 'todo', label: 'To do', icon: new vscode.ThemeIcon('circle-large-outline'), expanded: false },
  { status: 'done', label: 'Done', icon: new vscode.ThemeIcon('pass', new vscode.ThemeColor('charts.green')), expanded: false },
];
const ICON = new Map(GROUPS.map((g) => [g.status, g.icon]));
const LABEL = new Map(GROUPS.map((g) => [g.status, g.label]));

export type TaskNode = { kind: 'group'; status: Status; tasks: TaskView[] } | { kind: 'task'; task: TaskView };

export function taskDescription(task: TaskView): string {
  return [
    task.owner,
    task.status === 'review' && task.review_stage ? `${task.review_stage} review` : undefined,
    task.status === 'blocked' && task.escalation ? `waits for ${task.escalation}` : undefined,
    task.attempts > 0 ? `attempt ${task.attempts + 1}` : undefined,
    task.ladder && task.ladder !== 'retry' ? task.ladder.replace('_', ' ') : undefined,
  ]
    .filter(Boolean)
    .join(' · ');
}

export class TasksTreeProvider implements vscode.TreeDataProvider<TaskNode> {
  private readonly emitter = new vscode.EventEmitter<TaskNode | undefined>();
  readonly onDidChangeTreeData = this.emitter.event;
  private tasks: TaskView[] = [];

  constructor(private readonly root: vscode.Uri | undefined) {}

  update(snapshot: CrewSnapshot): void {
    this.tasks = snapshot.tasks;
    this.emitter.fire(undefined);
  }

  getChildren(element?: TaskNode): TaskNode[] {
    if (!element) {
      if (!this.tasks.length) return [];
      return GROUPS.map((g) => ({ kind: 'group' as const, status: g.status, tasks: this.tasks.filter((t) => t.status === g.status) })).filter((g) => g.tasks.length > 0);
    }
    return element.kind === 'group' ? element.tasks.map((task) => ({ kind: 'task', task })) : [];
  }

  getTreeItem(node: TaskNode): vscode.TreeItem {
    if (node.kind === 'group') {
      const group = GROUPS.find((g) => g.status === node.status)!;
      const item = new vscode.TreeItem(group.label, group.expanded ? vscode.TreeItemCollapsibleState.Expanded : vscode.TreeItemCollapsibleState.Collapsed);
      item.id = `group:${node.status}`;
      item.description = String(node.tasks.length);
      item.iconPath = group.icon;
      item.contextValue = 'crewTaskGroup';
      return item;
    }
    const { task } = node;
    const item = new vscode.TreeItem(`${task.id} · ${task.title}`, vscode.TreeItemCollapsibleState.None);
    item.id = `task:${task.id}`;
    item.description = taskDescription(task);
    item.iconPath = ICON.get(task.status);
    item.contextValue = 'crewTask';
    const tooltip = new vscode.MarkdownString(undefined, true);
    tooltip.appendMarkdown(`**${task.id}** — ${escapeMd(task.title)}\n\n`);
    tooltip.appendMarkdown(`Status: ${LABEL.get(task.status) ?? task.status}${task.review_stage ? ` (${task.review_stage})` : ''}  \nOwner: ${escapeMd(task.owner)}  \nFailed checks on this step: ${task.attempts}`);
    if (task.model) tooltip.appendMarkdown(`  \nModel: ${escapeMd(task.model)}`);
    if (task.depends_on?.length) tooltip.appendMarkdown(`  \nDepends on: ${task.depends_on.join(', ')}`);
    if (task.spent_usd_estimate !== undefined) tooltip.appendMarkdown(`  \nEstimated cost: $${task.spent_usd_estimate.toFixed(2)}`);
    item.tooltip = tooltip;
    if (this.root) {
      item.resourceUri = vscode.Uri.joinPath(this.root, ...task.path.split('/'));
      item.command = { command: 'crew.openTask', title: 'Open Task', arguments: [node] };
    }
    return item;
  }
}

export function escapeMd(text: string): string {
  return text.replace(/[\\`*_{}[\]()#+\-.!|<>]/g, '\\$&');
}
