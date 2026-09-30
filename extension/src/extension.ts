// Agent Crew — the VS Code control panel for the agent-crew Claude Code plugin.
// The crew itself runs inside the official Claude Code extension, on the user's own Claude
// subscription; this extension installs the plugin, starts crew commands and shows progress
// from .crew/. It never calls a model and never handles credentials.

import { execFile } from 'node:child_process';
import * as vscode from 'vscode';
import { claudeCodeLauncher, installClaudeCode, isClaudeCodeInstalled, isPluginInstalled, type Launcher, openPluginInstall } from './assistant';
import { answerChoices, answeredText, continuePrompt } from './crew/answer';
import { type CrewSnapshot, EMPTY_SNAPSHOT, type EscalationView } from './crew/model';
import { CrewWatcher } from './crew/watcher';
import type { Logger } from './log';
import { checkTools } from './setup';
import { ProjectTreeProvider, type ProjectNode } from './views/projectTree';
import { CrewStatusBar } from './views/statusBar';
import { showTaskDiff } from './views/taskDiff';
import { type TaskNode, TasksTreeProvider } from './views/tasksTree';

const SEEN_ESCALATIONS = 'crew.seenEscalations';
const LAST_PHASE = 'crew.lastPhase';
const PLUGIN_CONFIRMED = 'crew.pluginConfirmed';
/** Files that may exist in a folder before /new-project without it being "existing code". */
const EMPTY_FOLDER_NAMES = new Set(['.git', '.crew', '.vscode', '.idea', '.DS_Store', 'README.md', 'readme.md', '.gitignore', 'LICENSE']);

/** Returned from activate() only in test mode. */
export interface CrewTestApi {
  snapshot(): CrewSnapshot;
  refresh(): Promise<CrewSnapshot>;
  /** Prompts sent to Claude Code (the launcher is replaced by a recorder in tests). */
  launches: Array<{ prompt: string | undefined; sessionId: string | undefined }>;
  answer(escalationId: string, answer: string): Promise<void>;
  logLines: string[];
}

export async function activate(context: vscode.ExtensionContext): Promise<CrewTestApi | undefined> {
  const isTest = context.extensionMode === vscode.ExtensionMode.Test;
  const output = vscode.window.createOutputChannel('Agent Crew', { log: true });
  context.subscriptions.push(output);
  const logLines: string[] = [];
  const log: Logger = isTest
    ? {
        info: (m) => (logLines.push(m), output.info(m)),
        warn: (m) => (logLines.push(m), output.warn(m)),
        error: (m) => (logLines.push(m), output.error(m)),
        debug: (m) => (logLines.push(m), output.debug(m)),
      }
    : output;

  const root = vscode.workspace.workspaceFolders?.[0]?.uri;
  const launches: CrewTestApi['launches'] = [];
  const launcher: Launcher = isTest
    ? {
        open: (prompt, sessionId) => {
          launches.push({ prompt, sessionId });
          return Promise.resolve();
        },
      }
    : claudeCodeLauncher;
  const setContext = (key: string, value: unknown) => void vscode.commands.executeCommand('setContext', key, value);
  const fileUri = (rel: string) => vscode.Uri.joinPath(root!, ...rel.split('/'));

  // --- Views -------------------------------------------------------------------
  const projectTree = new ProjectTreeProvider(root);
  const tasksTree = new TasksTreeProvider(root);
  const statusBar = new CrewStatusBar();
  context.subscriptions.push(
    vscode.window.createTreeView('crew.project', { treeDataProvider: projectTree }),
    vscode.window.createTreeView('crew.tasks', { treeDataProvider: tasksTree, showCollapseAll: true }),
    statusBar,
  );

  let watcher: CrewWatcher | undefined;
  const snapshot = () => watcher?.snapshot ?? EMPTY_SNAPSHOT;
  if (root) {
    watcher = new CrewWatcher(root, log);
    context.subscriptions.push(watcher, watcher.onDidChange((s) => onSnapshot(s)));
  }

  function onSnapshot(s: CrewSnapshot): void {
    projectTree.update(s);
    tasksTree.update(s);
    statusBar.update(s);
    setContext('crew.hasProject', s.exists);
    setContext('crew.hasSession', Boolean(s.latestSession));
    if (!isTest) notifyChanges(s);
  }

  /** New questions from the crew, and the end of a run, become notifications. */
  function notifyChanges(s: CrewSnapshot): void {
    const seen = new Set(context.workspaceState.get<string[]>(SEEN_ESCALATIONS, []));
    const fresh = s.escalations.filter((e) => e.status === 'open' && !seen.has(e.id));
    if (fresh.length) {
      for (const e of fresh) seen.add(e.id);
      void context.workspaceState.update(SEEN_ESCALATIONS, [...seen]);
      const first = fresh[0]!;
      const text = fresh.length > 1 ? `Agent Crew has ${fresh.length} questions for you, starting with ${first.id}: ${first.question}` : `Agent Crew needs you — ${first.id}: ${first.question}`;
      void vscode.window.showInformationMessage(text.length > 300 ? `${text.slice(0, 299)}…` : text, 'Answer', 'Later').then((choice) => {
        if (choice === 'Answer') void answerEscalation(first.id);
      });
    }
    const phase = s.status?.phase;
    const last = context.workspaceState.get<string>(LAST_PHASE);
    if (phase && phase !== last) {
      void context.workspaceState.update(LAST_PHASE, phase);
      if (last && (phase === 'done' || phase === 'stopped')) {
        const message = phase === 'done' ? 'Agent Crew finished the project.' : `The crew run stopped${s.status?.stop_reason ? ` (${s.status.stop_reason.replace('_', ' ')})` : ''}.`;
        void vscode.window.showInformationMessage(message, 'Open Report').then((choice) => {
          if (choice) void openCrewFile('.crew/report.md', 'The report');
        });
      }
    }
  }

  // --- Claude Code -----------------------------------------------------------------

  /** Claude Code and the plugin are there (or the user says so); otherwise offers to install them. */
  async function ensureReady(): Promise<boolean> {
    if (isTest) return true;
    if (!isClaudeCodeInstalled()) {
      const choice = await vscode.window.showWarningMessage(
        'Agent Crew runs inside Claude Code, on your own Claude subscription. Install the Claude Code extension and sign in first.',
        'Install Claude Code',
      );
      if (choice) {
        await installClaudeCode();
        void vscode.window.showInformationMessage('When Claude Code is installed, sign in to it (it opens a sign-in page), then run this command again.');
      }
      return false;
    }
    setContext('crew.claudeCodeInstalled', true);
    if (isPluginInstalled() !== true && !context.globalState.get<boolean>(PLUGIN_CONFIRMED)) {
      const choice = await vscode.window.showInformationMessage(
        'Install the Agent Crew plugin into Claude Code (once): Claude Code opens its plugin dialog — confirm the install there, then run this command again.',
        'Install Plugin',
        'It Is Installed',
      );
      if (choice === 'Install Plugin') await openPluginInstall();
      if (choice !== 'It Is Installed') return false;
      await context.globalState.update(PLUGIN_CONFIRMED, true);
    }
    return true;
  }

  /** Opens Claude Code with the prompt pre-filled; the user presses Enter there. */
  async function launch(prompt: string, sessionId?: string): Promise<void> {
    if (sessionId) {
      // An already open session keeps its input box; the text is on the clipboard then.
      await vscode.env.clipboard.writeText(prompt);
    }
    try {
      await launcher.open(prompt, sessionId);
    } catch (err) {
      log.error(`Could not open Claude Code: ${String(err)}`);
      void vscode.window.showErrorMessage(`Could not open Claude Code (${err instanceof Error ? err.message : String(err)}). Is the Claude Code extension enabled?`);
      return;
    }
    const shown = prompt.length > 80 ? `${prompt.slice(0, 79)}…` : prompt;
    void vscode.window.showInformationMessage(
      sessionId ? `Claude Code is open. Send "${shown}" to continue — it is on your clipboard if the box is empty.` : `Claude Code is open with "${shown}". Press Enter there to start.`,
    );
  }

  // --- Commands --------------------------------------------------------------------
  const register = (id: string, fn: (...args: never[]) => unknown) => context.subscriptions.push(vscode.commands.registerCommand(id, fn));

  async function openCrewFile(rel: string, label: string): Promise<void> {
    if (!root) return;
    const uri = fileUri(rel);
    try {
      await vscode.workspace.fs.stat(uri);
      await vscode.window.showTextDocument(uri, { preview: false });
    } catch {
      void vscode.window.showInformationMessage(`${label} does not exist yet (${rel}). The crew writes it as the project goes.`);
    }
  }

  async function requireFolder(): Promise<vscode.Uri | undefined> {
    if (root) return root;
    const choice = await vscode.window.showInformationMessage('Open a folder for the project first — an empty one for a new project.', 'Open Folder…');
    if (choice) void vscode.commands.executeCommand('vscode.openFolder');
    return undefined;
  }

  async function newProject(): Promise<void> {
    const folder = await requireFolder();
    if (!folder) return;
    const s = snapshot();
    if (s.initialised && s.status?.phase !== 'done') {
      const choice = await vscode.window.showInformationMessage(`This folder already has a crew run (${s.status?.phase ?? 'starting'}). Continue it instead?`, 'Continue', 'Cancel');
      if (choice === 'Continue') await continueRun();
      return;
    }
    const entries = await vscode.workspace.fs.readDirectory(folder);
    const other = entries.filter(([name]) => !EMPTY_FOLDER_NAMES.has(name));
    if (other.length) {
      const choice = await vscode.window.showWarningMessage(
        'This folder is not empty. New Project creates a new app from a template here; to change existing code, use Add Feature.',
        { modal: true },
        'Create Here Anyway',
        'Add a Feature Instead',
        'Open Another Folder…',
      );
      if (choice === 'Add a Feature Instead') return feature();
      if (choice === 'Open Another Folder…') return void vscode.commands.executeCommand('vscode.openFolder');
      if (choice !== 'Create Here Anyway') return;
    }
    const idea = await vscode.window.showInputBox({
      title: 'Agent Crew: New Project',
      prompt: 'Describe the tool you need, in any language. The crew will interview you, then plan, build and test it.',
      placeHolder: 'Online booking for a barbershop: clients pick a barber and a time; the owner sees the day…',
      ignoreFocusOut: true,
    });
    if (!idea?.trim()) return;
    if (!(await ensureReady())) return;
    await launch(`/agent-crew:new-project ${idea.trim()}`);
  }

  async function feature(): Promise<void> {
    if (!(await requireFolder())) return;
    const description = await vscode.window.showInputBox({
      title: 'Agent Crew: Add Feature',
      prompt: 'Describe the feature to add to this project. The crew works on a separate git branch.',
      ignoreFocusOut: true,
    });
    if (!description?.trim()) return;
    if (!(await ensureReady())) return;
    await launch(`/agent-crew:feature ${description.trim()}`);
  }

  async function continueRun(): Promise<void> {
    if (!(await ensureReady())) return;
    const session = snapshot().latestSession;
    await launch(continuePrompt(undefined, undefined, session), session?.id);
  }

  function findEscalation(arg: unknown): EscalationView | undefined {
    const open = snapshot().escalations.filter((e) => e.status === 'open');
    if (typeof arg === 'string') return open.find((e) => e.id === arg);
    if (arg && typeof arg === 'object' && (arg as ProjectNode).kind === 'escalation') return (arg as Extract<ProjectNode, { kind: 'escalation' }>).escalation;
    return undefined;
  }

  async function writeAnswer(e: EscalationView, answer: string): Promise<void> {
    const uri = fileUri(e.path);
    const text = new TextDecoder().decode(await vscode.workspace.fs.readFile(uri));
    await vscode.workspace.fs.writeFile(uri, new TextEncoder().encode(answeredText(text, answer, new Date())));
    log.info(`Answered ${e.id}`);
    await watcher?.refresh();
  }

  async function answerEscalation(arg?: unknown): Promise<void> {
    let e = findEscalation(arg);
    if (!e) {
      const open = snapshot().escalations.filter((x) => x.status === 'open');
      if (!open.length) return void vscode.window.showInformationMessage('The crew has no open questions.');
      const picked = await vscode.window.showQuickPick(
        open.map((x) => ({ label: `${x.id}: ${x.question}`, escalation: x })),
        { title: 'Agent Crew: Answer a Question', placeHolder: 'Which question?' },
      );
      e = picked?.escalation;
    }
    if (!e) return;
    const other = { label: '$(edit) Another answer…', answer: undefined as string | undefined };
    const picked = await vscode.window.showQuickPick(
      [...answerChoices(e).map((c) => ({ label: c.label, description: c.recommended ? 'recommended' : undefined, answer: c.answer as string | undefined })), other],
      { title: `${e.id}: ${e.question}`, placeHolder: 'Choose an answer', ignoreFocusOut: true },
    );
    if (!picked) return;
    const answer = picked.answer ?? (await vscode.window.showInputBox({ title: `${e.id}: ${e.question}`, prompt: 'Your answer', ignoreFocusOut: true }));
    if (!answer?.trim()) return;
    await writeAnswer(e, answer);
    const session = snapshot().latestSession;
    const choice = await vscode.window.showInformationMessage(`${e.id} answered. The crew picks it up when the session continues.`, 'Continue in Claude Code');
    if (choice) await launch(continuePrompt(e, answer, session), session?.id);
  }

  register('crew.newProject', newProject);
  register('crew.feature', feature);
  register('crew.continue', continueRun);
  register('crew.answerEscalation', answerEscalation);
  register('crew.status', () => vscode.commands.executeCommand('crew.project.focus'));
  register('crew.installClaudeCode', async () => {
    if (isClaudeCodeInstalled()) {
      setContext('crew.claudeCodeInstalled', true);
      return void vscode.window.showInformationMessage('Claude Code is already installed. Sign in from its panel if you have not yet.');
    }
    await installClaudeCode();
  });
  register('crew.installPlugin', async () => {
    if (!isTest && !isClaudeCodeInstalled()) return void vscode.window.showWarningMessage('Install Claude Code first.', 'Install Claude Code').then((c) => c && installClaudeCode());
    if (isPluginInstalled() === true) {
      setContext('crew.pluginInstalled', true);
      return void vscode.window.showInformationMessage('The Agent Crew plugin is already installed in Claude Code.');
    }
    await openPluginInstall();
  });
  register('crew.checkSetup', async () => {
    const exec = (command: string, args: string[]) =>
      new Promise<{ ok: boolean; stdout: string }>((resolve) => execFile(command, args, { timeout: 15_000 }, (err, stdout) => resolve({ ok: !err, stdout: String(stdout) })));
    const claude = isClaudeCodeInstalled();
    const plugin = isPluginInstalled();
    const tools = await checkTools(exec);
    const lines = [
      `${claude ? '✓' : '✗'} Claude Code extension${claude ? '' : ' — install it and sign in'}`,
      `${plugin === true ? '✓' : '✗'} Agent Crew plugin in Claude Code${plugin === true ? '' : ' — run "Agent Crew: Install Plugin"'}`,
      ...tools.map((t) => `${t.ok ? '✓' : '✗'} ${t.name}: ${t.detail}${t.fix ? ` — ${t.fix}` : ''}`),
    ];
    log.info(`Setup check:\n${lines.join('\n')}`);
    const toolsOk = tools.every((t) => t.ok);
    setContext('crew.claudeCodeInstalled', claude);
    setContext('crew.pluginInstalled', plugin === true);
    setContext('crew.toolsOk', toolsOk);
    const failed = lines.filter((l) => l.startsWith('✗'));
    if (!failed.length) void vscode.window.showInformationMessage('Agent Crew: everything is in place.');
    else void vscode.window.showWarningMessage(`Agent Crew setup: ${failed.join('; ')}`, 'Show Details').then((c) => c && output.show(true));
    return !failed.length;
  });
  register('crew.openBrief', () => openCrewFile('.crew/brief.md', 'The brief'));
  register('crew.openStatus', () => openCrewFile('.crew/status.md', 'The status'));
  register('crew.openReport', () => openCrewFile('.crew/report.md', 'The report'));
  register('crew.openAccessChecklist', () => openCrewFile('.crew/access-checklist.md', 'The access checklist'));
  register('crew.openTask', async (node: TaskNode | undefined) => {
    if (root && node?.kind === 'task') await vscode.window.showTextDocument(fileUri(node.task.path), { preview: true });
  });
  register('crew.showTaskDiff', async (node: TaskNode | undefined) => {
    if (root && node?.kind === 'task') await showTaskDiff(node.task, root, log);
  });
  register('crew.refresh', () => watcher?.refresh());
  register('crew.showOutput', () => output.show(true));

  setContext('crew.claudeCodeInstalled', isClaudeCodeInstalled());
  setContext('crew.pluginInstalled', isPluginInstalled() === true);
  if (watcher) await watcher.refresh();
  else onSnapshot(EMPTY_SNAPSHOT);

  if (!isTest) return undefined;
  return {
    snapshot,
    refresh: () => watcher?.refresh() ?? Promise.resolve(EMPTY_SNAPSHOT),
    launches,
    answer: async (id, answer) => {
      const e = snapshot().escalations.find((x) => x.id === id);
      if (!e) throw new Error(`${id} not found`);
      await writeAnswer(e, answer);
    },
    logLines,
  };
}

export function deactivate(): void {
  // Disposables registered on the context clean up watchers and views.
}
