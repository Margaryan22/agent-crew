// Status bar: "$ spent / $ cap" and the agent currently working. Click → Crew: Status.

import * as vscode from 'vscode';
import { budgetLevel, formatUsd } from '../crew/budget';
import type { ChatState } from '../shared/protocol';

export class BudgetStatusBar implements vscode.Disposable {
  private readonly item: vscode.StatusBarItem;

  constructor() {
    this.item = vscode.window.createStatusBarItem('crew.budget', vscode.StatusBarAlignment.Left, 50);
    this.item.name = 'Agent Crew Budget';
    this.item.command = 'crew.status';
  }

  update(state: ChatState): void {
    const cap = state.capUsd > 0 ? formatUsd(state.capUsd) : 'no cap';
    const running = state.phase === 'running' || state.phase === 'starting';
    const icon = running ? '$(loading~spin)' : '$(organization)';
    this.item.text = `${icon} ${formatUsd(state.spentUsd)} / ${cap}${state.activeAgent ? ` · ${state.activeAgent}` : ''}`;
    const level = budgetLevel(state.spentUsd, state.capUsd);
    this.item.backgroundColor =
      level === 'exceeded' ? new vscode.ThemeColor('statusBarItem.errorBackground') : level === 'warn' ? new vscode.ThemeColor('statusBarItem.warningBackground') : undefined;
    const tooltip = new vscode.MarkdownString();
    tooltip.appendMarkdown(`**Agent Crew** — ${state.phase}\n\n`);
    tooltip.appendMarkdown(`Spent ${formatUsd(state.spentUsd)} of ${cap}`);
    if (state.activeAgent) tooltip.appendMarkdown(`  \nActive agent: ${state.activeAgent}`);
    tooltip.appendMarkdown('\n\nClick for the project status.');
    this.item.tooltip = tooltip;
    this.item.show();
  }

  dispose(): void {
    this.item.dispose();
  }
}
