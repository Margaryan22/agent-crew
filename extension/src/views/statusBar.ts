// Status bar: phase and task progress of the crew run, and how many things wait for the user.
// Click → the Agent Crew view.

import * as vscode from 'vscode';
import { type CrewSnapshot, PHASE_LABELS } from '../crew/model';
import { progress } from '../crew/snapshot';

export class CrewStatusBar implements vscode.Disposable {
  private readonly item: vscode.StatusBarItem;

  constructor() {
    this.item = vscode.window.createStatusBarItem('crew.status', vscode.StatusBarAlignment.Left, 50);
    this.item.name = 'Agent Crew';
    this.item.command = 'crew.status';
  }

  update(snapshot: CrewSnapshot): void {
    if (!snapshot.exists) {
      this.item.hide();
      return;
    }
    const p = progress(snapshot);
    const phase = snapshot.status?.phase;
    const label = phase ? (PHASE_LABELS[phase] ?? phase) : 'starting';
    this.item.text = `$(organization) Crew: ${label}${p.total ? ` ${p.done}/${p.total}` : ''}${p.needsYou ? ` · $(bell) ${p.needsYou}` : ''}`;
    this.item.backgroundColor = p.needsYou ? new vscode.ThemeColor('statusBarItem.warningBackground') : undefined;
    const tooltip = new vscode.MarkdownString();
    tooltip.appendMarkdown(`**Agent Crew** — ${label}\n\n`);
    if (snapshot.status?.summary) tooltip.appendMarkdown(`${snapshot.status.summary}\n\n`);
    if (p.total) tooltip.appendMarkdown(`Tasks: ${p.done} of ${p.total} done  \n`);
    if (p.needsYou) tooltip.appendMarkdown(`**${p.needsYou} thing${p.needsYou > 1 ? 's' : ''} need${p.needsYou > 1 ? '' : 's'} you.**  \n`);
    tooltip.appendMarkdown('\nClick to open the Agent Crew view.');
    this.item.tooltip = tooltip;
    this.item.show();
  }

  dispose(): void {
    this.item.dispose();
  }
}
