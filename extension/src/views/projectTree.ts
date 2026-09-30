// "Project" tree: where the crew run stands, what it needs from the user, spend, and the
// project documents — everything read from .crew/.

import * as vscode from 'vscode';
import type { ChecklistItem, CrewSnapshot, DecisionView, EscalationView } from '../crew/model';
import { PHASE_LABELS } from '../crew/model';
import { progress } from '../crew/snapshot';
import { escapeMd } from './tasksTree';

export type ProjectNode =
  | { kind: 'problem'; text: string }
  | { kind: 'phase' }
  | { kind: 'progress' }
  | { kind: 'needsYou' }
  | { kind: 'escalation'; escalation: EscalationView }
  | { kind: 'access'; item: ChecklistItem }
  | { kind: 'spend' }
  | { kind: 'file'; label: string; rel: string; icon: string }
  | { kind: 'decisions' }
  | { kind: 'decision'; decision: DecisionView }
  | { kind: 'continue' };

export function formatUsd(value: number): string {
  return `$${value.toFixed(2)}`;
}

export function formatTokens(tokens: number): string {
  return tokens >= 1_000_000 ? `${(tokens / 1_000_000).toFixed(1)}M` : tokens >= 1000 ? `${Math.round(tokens / 1000)}k` : String(tokens);
}

export class ProjectTreeProvider implements vscode.TreeDataProvider<ProjectNode> {
  private readonly emitter = new vscode.EventEmitter<ProjectNode | undefined>();
  readonly onDidChangeTreeData = this.emitter.event;
  private snapshot: CrewSnapshot | undefined;

  constructor(private readonly root: vscode.Uri | undefined) {}

  update(snapshot: CrewSnapshot): void {
    this.snapshot = snapshot;
    this.emitter.fire(undefined);
  }

  getChildren(element?: ProjectNode): ProjectNode[] {
    const s = this.snapshot;
    if (!s?.exists) return [];
    if (!element) {
      const p = progress(s);
      const nodes: ProjectNode[] = s.problems.map((text) => ({ kind: 'problem', text }));
      nodes.push({ kind: 'phase' });
      if (p.total) nodes.push({ kind: 'progress' });
      if (p.needsYou) nodes.push({ kind: 'needsYou' });
      nodes.push({ kind: 'spend' });
      if (s.latestSession) nodes.push({ kind: 'continue' });
      if (s.files.brief) nodes.push({ kind: 'file', label: 'Brief', rel: '.crew/brief.md', icon: 'book' });
      if (s.files.report) nodes.push({ kind: 'file', label: 'Report', rel: '.crew/report.md', icon: 'checklist' });
      if (s.decisions.length) nodes.push({ kind: 'decisions' });
      return nodes;
    }
    if (element.kind === 'needsYou') {
      return [
        ...s.escalations.filter((e) => e.status === 'open').map((escalation) => ({ kind: 'escalation' as const, escalation })),
        ...s.checklist.filter((i) => !i.done).map((item) => ({ kind: 'access' as const, item })),
      ];
    }
    if (element.kind === 'decisions') return s.decisions.map((decision) => ({ kind: 'decision', decision }));
    return [];
  }

  getTreeItem(node: ProjectNode): vscode.TreeItem {
    const s = this.snapshot!;
    const leaf = vscode.TreeItemCollapsibleState.None;
    switch (node.kind) {
      case 'problem': {
        const item = new vscode.TreeItem(node.text, leaf);
        item.iconPath = new vscode.ThemeIcon('warning', new vscode.ThemeColor('list.warningForeground'));
        item.tooltip = node.text;
        return item;
      }
      case 'phase': {
        const phase = s.status?.phase;
        const item = new vscode.TreeItem(`Phase: ${phase ? (PHASE_LABELS[phase] ?? phase) : s.initialised ? 'starting' : 'not started'}`, leaf);
        item.id = 'phase';
        item.description = s.status?.summary ?? '';
        item.tooltip = s.status?.summary ?? 'The crew writes its progress to .crew/status.md.';
        item.iconPath = new vscode.ThemeIcon(phase === 'done' ? 'pass-filled' : phase === 'stopped' || phase === 'failed' ? 'debug-stop' : 'rocket');
        if (this.root) item.command = { command: 'crew.openStatus', title: 'Open Status' };
        return item;
      }
      case 'progress': {
        const p = progress(s);
        const item = new vscode.TreeItem(`Tasks: ${p.done} of ${p.total} done`, leaf);
        item.id = 'progress';
        item.description = [p.inProgress && `${p.inProgress} in progress`, p.review && `${p.review} in review`, p.blocked && `${p.blocked} blocked`].filter(Boolean).join(' · ');
        item.iconPath = new vscode.ThemeIcon('tasklist');
        item.command = { command: 'crew.tasks.focus', title: 'Show Tasks' };
        return item;
      }
      case 'needsYou': {
        const item = new vscode.TreeItem(`Needs you (${progress(s).needsYou})`, vscode.TreeItemCollapsibleState.Expanded);
        item.id = 'needsYou';
        item.iconPath = new vscode.ThemeIcon('bell-dot', new vscode.ThemeColor('charts.orange'));
        return item;
      }
      case 'escalation': {
        const e = node.escalation;
        const item = new vscode.TreeItem(`${e.id}: ${e.question}`, leaf);
        item.id = `escalation:${e.id}`;
        item.description = e.recommended ? `recommended: ${e.recommended}` : e.kind;
        const tooltip = new vscode.MarkdownString(undefined, true);
        tooltip.appendMarkdown(`**${e.id}** (${e.kind}${e.task ? `, ${e.task}` : ''})\n\n${escapeMd(e.question)}\n\n`);
        for (const o of e.options) tooltip.appendMarkdown(`- ${escapeMd(o)}${o === e.recommended ? ' — *recommended*' : ''}\n`);
        item.tooltip = tooltip;
        item.iconPath = new vscode.ThemeIcon('question');
        item.contextValue = 'crewEscalation';
        item.command = { command: 'crew.answerEscalation', title: 'Answer', arguments: [node] };
        return item;
      }
      case 'access': {
        const item = new vscode.TreeItem(node.item.text, leaf);
        item.description = node.item.note ?? '';
        item.tooltip = 'The crew needs this from you. Provide it, then tick the item in .crew/access-checklist.md.';
        item.iconPath = new vscode.ThemeIcon('key');
        if (this.root) item.command = { command: 'crew.openAccessChecklist', title: 'Open Access Checklist' };
        return item;
      }
      case 'spend': {
        const cap = s.latestSession?.capUsd;
        const item = new vscode.TreeItem(`Spend: ${formatUsd(s.spend.usedUsd)}${cap ? ` of ${formatUsd(cap)}` : ''}`, leaf);
        item.id = 'spend';
        item.description = `${s.spend.basis === 'reported' ? 'reported' : 'estimate'} · ${formatTokens(s.spend.estimatedTokens)} tokens`;
        item.tooltip =
          s.spend.basis === 'reported'
            ? 'Reported by the host that ran the crew.'
            : 'Estimated by the agent-crew plugin at API list prices. On a Claude subscription your plan limits apply instead of dollars — see /usage in Claude Code.';
        item.iconPath = new vscode.ThemeIcon('credit-card');
        return item;
      }
      case 'continue': {
        const item = new vscode.TreeItem('Continue in Claude Code', leaf);
        item.id = 'continue';
        item.description = s.latestSession?.command.replace(/^agent-crew:/, '/') ?? '';
        item.tooltip = 'Reopen the Claude Code session that runs this crew.';
        item.iconPath = new vscode.ThemeIcon('comment-discussion');
        item.command = { command: 'crew.continue', title: 'Continue in Claude Code' };
        return item;
      }
      case 'file': {
        const item = new vscode.TreeItem(node.label, leaf);
        item.id = `file:${node.rel}`;
        item.iconPath = new vscode.ThemeIcon(node.icon);
        if (this.root) {
          const uri = vscode.Uri.joinPath(this.root, ...node.rel.split('/'));
          item.resourceUri = uri;
          item.command = { command: 'vscode.open', title: 'Open', arguments: [uri] };
        }
        return item;
      }
      case 'decisions': {
        const item = new vscode.TreeItem(`Decisions (${s.decisions.length})`, vscode.TreeItemCollapsibleState.Collapsed);
        item.id = 'decisions';
        item.iconPath = new vscode.ThemeIcon('law');
        return item;
      }
      case 'decision': {
        const d = node.decision;
        const item = new vscode.TreeItem(`${d.id} · ${d.title}`, leaf);
        item.id = `adr:${d.id}`;
        item.description = d.status;
        item.iconPath = new vscode.ThemeIcon('law');
        if (this.root) {
          const uri = vscode.Uri.joinPath(this.root, ...d.path.split('/'));
          item.resourceUri = uri;
          item.command = { command: 'vscode.open', title: 'Open Decision', arguments: [uri] };
        }
        return item;
      }
    }
  }
}
