// Agent Crew — VS Code UI for the agent-crew Claude Code plugin.

import * as vscode from 'vscode';
import { gitVersion, loadSdk, resolveRuntime, runVersion, type RuntimePaths } from './agent/runtime';
import type { SdkModule } from './agent/session';
import { CrewController, type ControllerHost, type CrewConfig, OPEN_IN_CHAT } from './controller';
import { CREW_PATHS } from './crew/model';
import { CrewWatcher } from './crew/watcher';
import {
  activeProjects,
  createLicenseProvider,
  LICENSE_PROVIDER_CONFIG,
  LicenseService,
  markProject,
  type LicenseCache,
  type ProjectRegistryData,
} from './license';
import { type LogSink, redactingLogger, SecretRedactor } from './redact';
import { looksLikeAnthropicKey, SecretStore } from './secrets';
import type { ExtensionToWebview, WebviewToExtension } from './shared/protocol';
import { Telemetry } from './telemetry';
import { ChatViewProvider, CHAT_VIEW_ID } from './views/chatView';
import { BudgetStatusBar } from './views/statusBar';
import { DecisionsTreeProvider, showTaskDiff, type TaskNode, TasksTreeProvider } from './views/tasksTree';

export const DEMO_IDEA =
  'A tiny habit tracker web app: people add daily habits, tick them off each day and see a 7-day streak for each habit. No accounts — data stays in the browser.';

const LICENSE_CACHE_KEY = 'crew.licenseCache';
const PROJECTS_KEY = 'crew.projects';

/** Returned from activate() only in test mode. */
export interface CrewTestApi {
  controller: CrewController;
  secrets: SecretStore;
  posted: ExtensionToWebview[];
  logLines: string[];
  setSdkLoader(loader: ((entry: string) => Promise<SdkModule>) | undefined): void;
  setRuntime(runtime: RuntimePaths | undefined): void;
  refresh(): Promise<void>;
}

function readConfig(scope?: vscode.Uri): CrewConfig {
  const c = vscode.workspace.getConfiguration('crew', scope);
  const autonomy = c.get<string>('autonomy', 'full');
  return {
    budgetCapUsd: Math.max(0, c.get<number>('budgetCapUsd', 20)),
    stackProfile: c.get<string>('stackProfile', 'tanstack'),
    autonomy: autonomy === 'review' ? 'review' : 'full',
    briefReviewMinutes: Math.min(240, Math.max(1, c.get<number>('briefReviewMinutes', 10))),
  };
}

export async function activate(context: vscode.ExtensionContext): Promise<CrewTestApi | undefined> {
  const isTest = context.extensionMode === vscode.ExtensionMode.Test;
  const output = vscode.window.createOutputChannel('Crew', { log: true });
  const redactor = new SecretRedactor();
  const logLines: string[] = [];
  const sink: LogSink = isTest
    ? {
        info: (m) => (logLines.push(m), output.info(m)),
        warn: (m) => (logLines.push(m), output.warn(m)),
        error: (m) => (logLines.push(m), output.error(m)),
        debug: (m) => (logLines.push(m), output.debug(m)),
      }
    : output;
  const log = redactingLogger(sink, redactor);
  const secrets = new SecretStore(context.secrets, redactor);
  const root = vscode.workspace.workspaceFolders?.[0]?.uri;
  const version = String((context.extension.packageJSON as { version?: string }).version ?? '0.0.0');
  context.subscriptions.push(output);

  // Telemetry: aggregates only; VS Code's global switch is enforced by the TelemetryLogger.
  const telemetryLogger = vscode.env.createTelemetryLogger(
    {
      sendEventData: (name, data) => log.debug(`telemetry ${name} ${JSON.stringify(data ?? {})}`),
      sendErrorData: () => undefined,
    },
    { ignoreBuiltInCommonProperties: true, ignoreUnhandledErrors: true },
  );
  context.subscriptions.push(telemetryLogger);
  const telemetry = new Telemetry(
    { logUsage: (name, data) => telemetryLogger.logUsage(name, data) },
    () => vscode.workspace.getConfiguration('crew').get<boolean>('telemetry.enabled', true),
  );

  // License module (disabled by default).
  const license = new LicenseService(createLicenseProvider(LICENSE_PROVIDER_CONFIG, (url, init) => fetch(url, init)), {
    getKey: () => secrets.getLicenseKey(),
    setKey: (key) => secrets.setLicenseKey(key),
    deleteKey: () => secrets.clearLicenseKey(),
    getCache: () => context.globalState.get<LicenseCache>(LICENSE_CACHE_KEY),
    setCache: (cache) => Promise.resolve(context.globalState.update(LICENSE_CACHE_KEY, cache)),
  });

  let sdkLoader: ((entry: string) => Promise<SdkModule>) | undefined;
  let runtimeOverride: RuntimePaths | undefined;
  const runtime = () => runtimeOverride ?? resolveRuntime(context.extensionPath, vscode.workspace.getConfiguration('crew').get<string>('claudeCodePath', ''));
  const posted: ExtensionToWebview[] = [];

  // Messages only arrive once the view is registered below, after the controller exists.
  const chat = new ChatViewProvider(context.extensionUri, redactor, log, (message) => onWebviewMessage(message), isTest ? (m) => posted.push(m) : undefined);
  const fileUri = (rel: string) => vscode.Uri.joinPath(root!, ...rel.split('/'));
  const encoder = new TextEncoder();

  const host: ControllerHost = {
    workspaceRoot: () => root?.fsPath,
    isTrusted: () => vscode.workspace.isTrusted,
    config: () => readConfig(root),
    getApiKey: () => secrets.getApiKey(),
    runtime,
    loadSdk: (entry) => (sdkLoader ?? loadSdk)(entry),
    async readFile(rel) {
      if (!root) return undefined;
      try {
        return new TextDecoder().decode(await vscode.workspace.fs.readFile(fileUri(rel)));
      } catch {
        return undefined;
      }
    },
    async writeFile(rel, content) {
      if (!root) throw new Error('No workspace folder');
      const uri = fileUri(rel);
      await vscode.workspace.fs.createDirectory(vscode.Uri.joinPath(uri, '..'));
      await vscode.workspace.fs.writeFile(uri, encoder.encode(content));
    },
    workspaceState: context.workspaceState,
    post: (message) => chat.post(message),
    async notify(level, message, ...actions) {
      const show = level === 'error' ? vscode.window.showErrorMessage : level === 'warn' ? vscode.window.showWarningMessage : vscode.window.showInformationMessage;
      const choice = await show(message, ...actions);
      if (choice === 'Open Settings') void vscode.commands.executeCommand('workbench.action.openSettings', 'crew.budgetCapUsd');
      if (choice === 'Enter License') void vscode.commands.executeCommand('crew.enterLicense');
      return choice;
    },
    notifyEscalation(escalation) {
      const text = `${escalation.title}: ${escalation.question}`.replace(/\s+/g, ' ');
      const message = text.length > 300 ? `${text.slice(0, 299)}…` : text;
      const actions = [...escalation.options.slice(0, 3), OPEN_IN_CHAT];
      const show = escalation.kind === 'permission' ? vscode.window.showWarningMessage : vscode.window.showInformationMessage;
      return Promise.resolve(show(message, ...actions));
    },
    focusChat: () => chat.focus(),
    setContext: (key, value) => void vscode.commands.executeCommand('setContext', key, value),
    license,
    projects: {
      active: () => activeProjects(context.globalState.get<ProjectRegistryData>(PROJECTS_KEY) ?? {}, Date.now()),
      mark: (project, state) =>
        Promise.resolve(context.globalState.update(PROJECTS_KEY, markProject(context.globalState.get<ProjectRegistryData>(PROJECTS_KEY) ?? {}, project, state, Date.now()))),
    },
    telemetry: (event) => telemetry.send(event),
    runCommand: (command) => void vscode.commands.executeCommand(command),
    log,
    now: () => Date.now(),
    clientApp: `agent-crew-vscode/${version}`,
  };

  const controller = new CrewController(host);
  context.subscriptions.push({ dispose: () => controller.dispose() });

  const webviewCommands = {
    newProject: 'crew.newProject',
    feature: 'crew.feature',
    status: 'crew.status',
    resume: 'crew.resume',
    setApiKey: 'crew.setApiKey',
    openBrief: 'crew.openBrief',
    showLog: 'crew.showOutput',
  } as const;
  function onWebviewMessage(message: WebviewToExtension): void {
    switch (message.type) {
      case 'ready':
        chat.post(controller.initMessage());
        break;
      case 'send':
        void controller.submit(message.text);
        break;
      case 'stop':
        void controller.stop('user');
        break;
      case 'answer':
        void controller.answerEscalation(message.escalationId, message.answer);
        break;
      case 'command':
        void vscode.commands.executeCommand(webviewCommands[message.command]);
        break;
    }
  }
  context.subscriptions.push(chat, vscode.window.registerWebviewViewProvider(CHAT_VIEW_ID, chat));

  const tasksTree = new TasksTreeProvider(root);
  const decisionsTree = new DecisionsTreeProvider(root);
  const statusBar = new BudgetStatusBar();
  context.subscriptions.push(
    vscode.window.createTreeView('crew.tasks', { treeDataProvider: tasksTree, showCollapseAll: true }),
    vscode.window.createTreeView('crew.decisions', { treeDataProvider: decisionsTree }),
    statusBar,
    controller.onDidChange(() => statusBar.update(controller.state())),
  );

  let watcher: CrewWatcher | undefined;
  if (root) {
    watcher = new CrewWatcher(root, log);
    context.subscriptions.push(
      watcher,
      watcher.onDidChange((snapshot) => {
        controller.onSnapshot(snapshot);
        tasksTree.update(snapshot);
        decisionsTree.update(snapshot);
      }),
    );
  }

  // --- Commands -------------------------------------------------------------
  const register = (id: string, fn: (...args: never[]) => unknown) => context.subscriptions.push(vscode.commands.registerCommand(id, fn));

  const openCrewFile = async (rel: string, label: string) => {
    if (!root) return;
    const uri = fileUri(rel);
    try {
      await vscode.workspace.fs.stat(uri);
      await vscode.window.showTextDocument(uri, { preview: false });
    } catch {
      void vscode.window.showInformationMessage(`${label} does not exist yet (${rel}). The crew writes it once the project starts.`);
    }
  };

  register('crew.newProject', async () => {
    const idea = await vscode.window.showInputBox({
      title: 'Crew: New Project',
      prompt: 'Describe the product idea. The crew will write a brief, plan tasks and build it.',
      placeHolder: 'A booking app for a small barbershop with online payments…',
      ignoreFocusOut: true,
    });
    if (!idea?.trim()) return;
    chat.focus();
    await controller.newProject(idea);
  });
  register('crew.newProjectDemo', async () => {
    chat.focus();
    await controller.newProject(DEMO_IDEA);
  });
  register('crew.feature', async () => {
    const description = await vscode.window.showInputBox({
      title: 'Crew: Feature',
      prompt: 'Describe the feature to add to this project.',
      ignoreFocusOut: true,
    });
    if (!description?.trim()) return;
    chat.focus();
    await controller.feature(description);
  });
  register('crew.status', async () => {
    chat.focus();
    await controller.status();
  });
  register('crew.stop', () => controller.stop('user'));
  register('crew.resume', async () => {
    chat.focus();
    await controller.resume();
  });
  register('crew.setApiKey', async () => {
    const key = await vscode.window.showInputBox({
      title: 'Crew: Set API Key',
      prompt: 'Anthropic API key (console.anthropic.com → API Keys). Stored in the OS keychain via VS Code SecretStorage.',
      password: true,
      ignoreFocusOut: true,
      validateInput: (value) =>
        value.trim() === ''
          ? 'Enter a key'
          : looksLikeAnthropicKey(value)
            ? undefined
            : { message: 'This does not look like an Anthropic API key (sk-ant-…). It will be saved anyway.', severity: vscode.InputBoxValidationSeverity.Warning },
    });
    if (!key?.trim()) return;
    await secrets.setApiKey(key);
    void vscode.window.showInformationMessage('Anthropic API key saved.');
  });
  register('crew.clearApiKey', async () => {
    const choice = await vscode.window.showWarningMessage('Remove the stored Anthropic API key?', { modal: true }, 'Remove');
    if (choice !== 'Remove') return;
    await secrets.clearApiKey();
    void vscode.window.showInformationMessage('Anthropic API key removed.');
  });
  register('crew.openBrief', () => openCrewFile(CREW_PATHS.brief, 'The brief'));
  register('crew.openStatus', () => openCrewFile(CREW_PATHS.status, 'The status file'));
  register('crew.enterLicense', async () => {
    if (!license.isEnabled) {
      void vscode.window.showInformationMessage('Agent Crew has no license restrictions in this version.');
      return;
    }
    const key = await vscode.window.showInputBox({ title: 'Crew: Enter License', prompt: 'Agent Crew Pro license key', password: true, ignoreFocusOut: true });
    if (!key?.trim()) return;
    const result = await license.enterKey(key);
    const show = result.ok ? vscode.window.showInformationMessage : vscode.window.showErrorMessage;
    void show(result.message);
  });
  register('crew.showOutput', () => output.show(true));
  register('crew.refresh', async () => {
    await watcher?.refresh();
  });
  register('crew.openTask', async (node: TaskNode | undefined) => {
    if (!root || node?.kind !== 'task') return;
    await vscode.window.showTextDocument(fileUri(node.task.path), { preview: true });
  });
  register('crew.showTaskDiff', async (node: TaskNode | undefined) => {
    if (!root || node?.kind !== 'task') return;
    await showTaskDiff(node.task, root, log);
  });
  register('crew.checkDependencies', async () => {
    const rt = runtime();
    const lines: string[] = [];
    let ok = true;
    const add = (pass: boolean, text: string) => {
      lines.push(`${pass ? '✓' : '✗'} ${text}`);
      if (!pass) ok = false;
    };
    add(vscode.workspace.isTrusted, vscode.workspace.isTrusted ? 'Workspace is trusted' : 'Workspace is not trusted');
    add(Boolean(root), root ? `Workspace folder: ${root.fsPath}` : 'No folder is open');
    add(Boolean(await secrets.getApiKey()), 'Anthropic API key is set');
    if (rt.executable) {
      const v = await runVersion(rt.executable);
      add(v.ok, v.ok ? `Claude Code ${v.output} (${rt.executableSource})` : `Claude Code at ${rt.executable} does not run: ${v.output}`);
    } else {
      add(false, 'Claude Code executable not found');
    }
    add(Boolean(rt.plugin), rt.plugin ? `Plugin ${rt.plugin.name}${rt.plugin.version ? `@${rt.plugin.version}` : ''}` : 'agent-crew plugin missing');
    const git = await gitVersion();
    add(git.ok, git.ok ? git.output : 'git is not installed or not on PATH');
    for (const problem of rt.problems) if (!lines.some((l) => l.includes(problem))) add(false, problem);
    log.info(`Dependency check:\n${lines.join('\n')}`);
    host.setContext('crew.dependenciesOk', ok);
    if (ok) {
      void vscode.window.showInformationMessage('Agent Crew: all dependencies are in place.');
    } else {
      const choice = await vscode.window.showWarningMessage(`Agent Crew: ${lines.filter((l) => l.startsWith('✗')).join('; ')}`, 'Show Log', 'Set API Key');
      if (choice === 'Show Log') output.show(true);
      if (choice === 'Set API Key') void vscode.commands.executeCommand('crew.setApiKey');
    }
    return ok;
  });

  // --- State wiring ------------------------------------------------------------
  context.subscriptions.push(
    secrets.onDidChangeApiKey((hasKey) => {
      host.setContext('crew.hasApiKey', hasKey);
      controller.setHasApiKey(hasKey);
    }),
    vscode.workspace.onDidChangeConfiguration((e) => {
      if (e.affectsConfiguration('crew')) controller.onConfigChanged();
    }),
  );

  const hasKey = Boolean(await secrets.getApiKey());
  host.setContext('crew.hasApiKey', hasKey);
  host.setContext('crew.licenseEnabled', license.isEnabled);
  host.setContext('crew.sessionActive', false);
  controller.setHasApiKey(hasKey);

  const startupProblems = runtime().problems;
  if (startupProblems.length && !isTest) {
    log.warn(`Runtime problems: ${startupProblems.join(' | ')}`);
    void vscode.window.showWarningMessage(`Agent Crew: ${startupProblems[0]}`, 'Check Dependencies').then((choice) => {
      if (choice) void vscode.commands.executeCommand('crew.checkDependencies');
    });
  }

  // The first refresh fires onDidChange, which feeds the controller and both trees.
  await watcher?.refresh();
  statusBar.update(controller.state());
  if (!isTest) void controller.offerResume();

  if (!isTest) return undefined;
  return {
    controller,
    secrets,
    posted,
    logLines,
    setSdkLoader: (loader) => {
      sdkLoader = loader;
    },
    setRuntime: (rt) => {
      runtimeOverride = rt;
    },
    refresh: async () => {
      await watcher?.refresh();
    },
  };
}

export function deactivate(): void {
  // Disposables registered on the context clean up the session and watchers.
}
