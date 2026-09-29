// Orchestrates one crew session per workspace: starts/resumes/stops it, turns SDK events into
// chat entries, tracks the budget, routes escalations and persists the session id for resume.
// Everything VS Code-specific sits behind ControllerHost so the controller runs in unit tests.

import { EventMapper, LEAD_AGENT, type UiEvent } from './agent/events';
import { createCanUseTool } from './agent/permissions';
import type { RuntimePaths } from './agent/runtime';
import { CrewSession, type SdkModule } from './agent/session';
import { BudgetTracker, formatUsd } from './crew/budget';
import { EscalationService, type LiveEscalation } from './crew/escalations';
import { CREW_PATHS, type CrewSnapshot, EMPTY_SNAPSHOT } from './crew/model';
import { appendStatusNote, formatCostEntry, projectSpentUsd, sessionTotalUsd, truncate } from './crew/parser';
import type { Entitlements, StartCheck } from './license';
import type { Logger } from './redact';
import type { AgentRunStatus, ChatEntry, ChatState, ExtensionToWebview, SessionPhase } from './shared/protocol';
import type { SessionStats, TelemetryEvent } from './telemetry';
import { errorEvent, sessionEndEvent } from './telemetry';

export interface CrewConfig {
  budgetCapUsd: number;
  stackProfile: string;
  autonomy: 'full' | 'review';
  briefReviewMinutes: number;
}

export interface Memento {
  get<T>(key: string): T | undefined;
  update(key: string, value: unknown): PromiseLike<void>;
}

export interface ControllerHost {
  workspaceRoot(): string | undefined;
  isTrusted(): boolean;
  config(): CrewConfig;
  getApiKey(): Promise<string | undefined>;
  runtime(): RuntimePaths;
  loadSdk(entry: string): Promise<SdkModule>;
  readFile(relPath: string): Promise<string | undefined>;
  writeFile(relPath: string, content: string): Promise<void>;
  workspaceState: Memento;
  post(message: ExtensionToWebview): void;
  notify(level: 'info' | 'warn' | 'error', message: string, ...actions: string[]): Promise<string | undefined>;
  /** Shows an escalation as a notification; resolves with the chosen option or 'Open in Chat'. */
  notifyEscalation(escalation: LiveEscalation): Promise<string | undefined>;
  focusChat(): void;
  setContext(key: string, value: unknown): void;
  license: { entitlements(): Promise<Entitlements>; checkStart(e: Entitlements, r: { project: string; activeProjects: string[]; stackProfile: string }): StartCheck };
  projects: { active(): string[]; mark(project: string, state: 'active' | 'stopped'): Promise<void> };
  telemetry(event: TelemetryEvent): void;
  runCommand(command: string): void;
  log: Logger;
  now(): number;
  clientApp: string;
}

export const OPEN_IN_CHAT = 'Open in Chat';
export const SESSION_KEY = 'crew.session';
const MAX_ENTRIES = 1000;
const LIVE_COST_POLL_MS = 15_000;

export interface StoredSession {
  sessionId: string;
  state: 'running' | 'idle' | 'stopped';
  updatedAt: number;
}

type StopReason = 'user' | 'budget' | 'replaced' | 'error';

/** `/new-project idea` → `/agent-crew:new-project idea`; built-in commands and other text pass through. */
export function toPluginPrompt(text: string, pluginName: string, pluginCommands: readonly string[] = ['new-project', 'feature', 'status']): string {
  const m = /^\/([a-z][\w-]*)(?:\s+([\s\S]*))?$/i.exec(text.trim());
  if (!m) return text;
  const command = (m[1] ?? '').toLowerCase();
  if (!pluginCommands.includes(command)) return text;
  return `/${pluginName}:${command}${m[2] ? ` ${m[2].trim()}` : ''}`;
}

export class CrewController {
  private session: CrewSession | undefined;
  private mapper = new EventMapper();
  private budget: BudgetTracker | undefined;
  private snapshot: CrewSnapshot = EMPTY_SNAPSHOT;
  private entries: ChatEntry[] = [];
  private entryCounter = 0;
  private phase: SessionPhase = 'idle';
  private activeAgent: string | undefined;
  private readonly agents = new Map<string, { name: string; model?: string; status: AgentRunStatus }>();
  private readonly listeners = new Set<() => void>();
  private pollTimer: ReturnType<typeof setInterval> | undefined;
  private stats: { startedAt: number; escalations: number; resumed: boolean; stopReason?: StopReason } | undefined;
  private pluginChecked = false;
  private hasApiKey = false;
  private disposing = false;
  readonly escalations: EscalationService;

  constructor(private readonly host: ControllerHost) {
    this.escalations = new EscalationService({
      readFile: (p) => host.readFile(p),
      writeFile: (p, c) => host.writeFile(p, c),
      sendToSession: (text) => this.sendToSession(text),
      autonomy: () => host.config().autonomy,
      briefReviewMs: () => host.config().briefReviewMinutes * 60_000,
      now: () => new Date(host.now()),
      log: host.log,
    });
    this.escalations.onRaised((e) => this.onEscalationRaised(e));
    this.escalations.onChanged((e) => this.upsertEntry(this.escalationEntry(e)));
  }

  // -------------------------------------------------------------------------
  // State for views

  onDidChange(listener: () => void): { dispose(): void } {
    this.listeners.add(listener);
    return { dispose: () => this.listeners.delete(listener) };
  }

  get isActive(): boolean {
    return this.session !== undefined && this.session.state !== 'closed';
  }

  get currentSnapshot(): CrewSnapshot {
    return this.snapshot;
  }

  storedSession(): StoredSession | undefined {
    return this.host.workspaceState.get<StoredSession>(SESSION_KEY);
  }

  state(): ChatState {
    const cap = this.host.config().budgetCapUsd;
    const spent = this.budget?.spentUsd ?? projectSpentUsd(this.snapshot.costs);
    const state: ChatState = {
      phase: this.phase,
      spentUsd: spent,
      capUsd: cap,
      hasApiKey: this.hasApiKey,
      canResume: !this.isActive && Boolean(this.storedSession()?.sessionId),
      agents: [...this.agents.values()].slice(-8),
    };
    if (this.activeAgent) state.activeAgent = this.activeAgent;
    return state;
  }

  setHasApiKey(value: boolean): void {
    this.hasApiKey = value;
    this.changed();
  }

  /** Webview asked for everything (first load or re-created view). */
  initMessage(): ExtensionToWebview {
    return { type: 'init', entries: this.entries, state: this.state() };
  }

  // -------------------------------------------------------------------------
  // Inputs

  onSnapshot(snapshot: CrewSnapshot): void {
    this.snapshot = snapshot;
    this.escalations.syncFromSnapshot(snapshot.escalations);
    this.changed();
  }

  onConfigChanged(): void {
    if (this.budget) {
      const update = this.budget.setCap(this.host.config().budgetCapUsd);
      if (update.level === 'exceeded' && this.isActive) void this.stop('budget');
    }
    this.changed();
  }

  async newProject(idea: string): Promise<boolean> {
    return this.start(`/new-project ${idea.trim()}`, { resume: false, label: idea });
  }

  async feature(description: string): Promise<boolean> {
    if (this.isActive) {
      this.sendUserText(`/feature ${description.trim()}`);
      return true;
    }
    return this.start(`/feature ${description.trim()}`, { resume: false, label: description });
  }

  /** Text typed in the chat. */
  async submit(text: string): Promise<void> {
    const trimmed = text.trim();
    if (!trimmed) return;
    if (/^\/status\b/i.test(trimmed)) {
      await this.status();
      return;
    }
    if (this.isActive) {
      this.sendUserText(trimmed);
      return;
    }
    if (trimmed.startsWith('/')) {
      await this.start(trimmed, { resume: false, label: trimmed });
    } else if (!this.snapshot.exists) {
      await this.start(`/new-project ${trimmed}`, { resume: false, label: trimmed });
    } else if (this.storedSession()?.sessionId) {
      await this.start(trimmed, { resume: true, label: trimmed });
    } else {
      await this.start(`/feature ${trimmed}`, { resume: false, label: trimmed });
    }
  }

  async status(): Promise<void> {
    if (this.isActive) {
      this.sendUserText('/status');
      return;
    }
    this.system('info', this.localStatus());
  }

  async resume(): Promise<boolean> {
    if (this.isActive) {
      this.system('info', 'A session is already running.');
      return false;
    }
    if (!this.storedSession()?.sessionId) {
      void this.host.notify('info', 'There is no Crew session to resume in this workspace.');
      return false;
    }
    return this.start('Continue where you left off. Check .crew/status.md and the open tasks first.', { resume: true, label: 'Resume' });
  }

  async stop(reason: StopReason = 'user'): Promise<void> {
    const session = this.session;
    if (!session || session.state === 'closed') return;
    if (this.stats) this.stats.stopReason = reason;
    await session.interrupt();
    session.close(reason);
    if (reason === 'user') this.system('info', 'Session stopped. Use Resume to continue it later.');
    await this.persist('stopped');
    const root = this.host.workspaceRoot();
    if (root) await this.host.projects.mark(root, 'stopped');
  }

  async answerEscalation(id: string, answer: string): Promise<void> {
    const outcome = await this.escalations.answer(id, answer);
    if (outcome === 'recorded') {
      this.system('info', `Answer to ${id} saved in .crew/escalations. It will reach the crew when the session resumes.`);
    } else if (outcome === 'closed') {
      this.system('info', `${id} was already answered.`);
    } else if (outcome === 'unknown') {
      this.system('warn', `Unknown escalation ${id}.`);
    }
  }

  /** Called on activation: a session that was mid-turn when the window reloaded is offered for resume. */
  async offerResume(): Promise<void> {
    const stored = this.storedSession();
    if (!stored?.sessionId || stored.state !== 'running' || this.isActive) return;
    const choice = await this.host.notify('info', 'A Crew session was interrupted when the window reloaded. Resume it?', 'Resume', 'Not now');
    if (choice === 'Resume') await this.resume();
  }

  dispose(): void {
    // Keep the stored state as "running" so the next activation offers resume.
    this.disposing = true;
    this.stopPolling();
    this.escalations.dispose();
    if (this.session && this.session.state !== 'closed') this.session.close('window closing');
  }

  // -------------------------------------------------------------------------
  // Session lifecycle

  private async start(text: string, opts: { resume: boolean; label: string }): Promise<boolean> {
    const root = this.host.workspaceRoot();
    if (!root) {
      void this.host.notify('error', 'Open a folder to run a crew.');
      return false;
    }
    if (!this.host.isTrusted()) {
      void this.host.notify('error', 'Agent Crew only runs in trusted workspaces. Trust this folder to start a session.');
      return false;
    }
    if (this.isActive) {
      const choice = await this.host.notify('warn', 'A crew session is already running in this workspace. Stop it and start a new one?', 'Stop and Start', 'Cancel');
      if (choice !== 'Stop and Start') return false;
      await this.stop('replaced');
    }
    const apiKey = await this.host.getApiKey();
    if (!apiKey) {
      const choice = await this.host.notify('warn', 'Set your Anthropic API key to start the crew.', 'Set API Key');
      if (choice === 'Set API Key') this.host.runCommand('crew.setApiKey');
      return false;
    }
    const runtime = this.host.runtime();
    if (!runtime.executable || runtime.problems.some((p) => /missing|No Claude Code executable/.test(p))) {
      const choice = await this.host.notify('error', runtime.problems[0] ?? 'Agent Crew is not fully installed.', 'Check Dependencies');
      if (choice === 'Check Dependencies') this.host.runCommand('crew.checkDependencies');
      return false;
    }

    const config = this.host.config();
    const stored = this.storedSession();
    const resumeId = opts.resume ? stored?.sessionId : undefined;
    const entitlements = await this.host.license.entitlements();
    const check = this.host.license.checkStart(entitlements, { project: root, activeProjects: this.host.projects.active(), stackProfile: config.stackProfile });
    if (!check.allowed) {
      void this.host.notify('warn', check.reason ?? 'Your license does not allow starting this session.', 'Enter License');
      return false;
    }

    const spentBefore = projectSpentUsd(this.snapshot.costs, resumeId);
    const budget = new BudgetTracker(config.budgetCapUsd, spentBefore, resumeId ? sessionTotalUsd(this.snapshot.costs, resumeId) : 0);
    const remaining = budget.remainingUsd();
    if (remaining !== undefined && remaining <= 0) {
      void this.host.notify('error', `Budget cap reached: ${formatUsd(budget.spentUsd)} of ${formatUsd(config.budgetCapUsd)}. Raise crew.budgetCapUsd to continue.`, 'Open Settings');
      return false;
    }

    let sdk: SdkModule;
    try {
      sdk = await this.host.loadSdk(runtime.sdkEntry);
    } catch (err) {
      this.host.log.error(`Could not load the Agent SDK: ${String(err)}`);
      this.host.telemetry(errorEvent('session_failed'));
      void this.host.notify('error', 'Could not load the Claude Agent SDK. See the Crew log for details.');
      return false;
    }

    const pluginName = runtime.plugin?.name ?? 'agent-crew';
    this.mapper = new EventMapper(LEAD_AGENT);
    this.agents.clear();
    this.activeAgent = undefined;
    this.pluginChecked = false;
    this.budget = budget;
    this.stats = { startedAt: this.host.now(), escalations: 0, resumed: Boolean(resumeId) };

    const session = new CrewSession(
      sdk,
      {
        cwd: root,
        pluginPath: runtime.pluginPath,
        executablePath: runtime.executable,
        apiKey,
        ...(remaining !== undefined ? { maxBudgetUsd: remaining } : {}),
        ...(resumeId ? { resumeSessionId: resumeId } : {}),
        crewEnv: {
          CREW_HOST: 'vscode',
          CREW_AUTONOMY: config.autonomy,
          CREW_BRIEF_REVIEW_MINUTES: String(config.briefReviewMinutes),
          CREW_STACK_PROFILE: config.stackProfile,
          CREW_BUDGET_CAP_USD: String(config.budgetCapUsd),
        },
        canUseTool: createCanUseTool({
          raise: (request, signal) => this.escalations.raise(request, signal),
          agentName: (agentId) => (agentId ? (this.mapper.agentForTask(agentId) ?? 'subagent') : LEAD_AGENT),
          log: this.host.log,
        }),
        clientApp: this.host.clientApp,
      },
      this.host.log,
    );
    this.session = session;
    session.onMessage((message) => {
      this.host.log.debug(`sdk ${message.type}${'subtype' in message && message.subtype ? `/${message.subtype}` : ''}`);
      for (const event of this.mapper.map(message)) this.onEvent(event, pluginName);
    });
    session.onExit((exit) => void this.onSessionExit(session, exit.error));

    const prompt = toPluginPrompt(text, pluginName);
    this.pushEntry({ id: this.nextId(), type: 'user', text: opts.label });
    this.setPhase('starting');
    try {
      session.start(prompt);
    } catch (err) {
      this.host.log.error(`Session failed to start: ${String(err)}`);
      this.system('error', 'The session failed to start. See the Crew log.');
      this.session = undefined;
      this.setPhase('idle');
      return false;
    }
    this.host.setContext('crew.sessionActive', true);
    await this.host.projects.mark(root, 'active');
    if (resumeId) await this.persist('running', resumeId);
    this.startPolling();
    return true;
  }

  private sendUserText(text: string): void {
    const pluginName = this.host.runtime().plugin?.name ?? 'agent-crew';
    this.pushEntry({ id: this.nextId(), type: 'user', text });
    this.sendToSession(toPluginPrompt(text, pluginName));
  }

  private sendToSession(text: string): boolean {
    if (!this.session || this.session.state === 'closed') return false;
    this.session.send(text);
    this.setPhase('running');
    void this.persist('running');
    return true;
  }

  private async onSessionExit(session: CrewSession, error: Error | undefined): Promise<void> {
    if (this.session !== session || this.disposing) return;
    this.stopPolling();
    this.escalations.cancelPending('The session ended');
    this.session = undefined;
    this.activeAgent = undefined;
    this.host.setContext('crew.sessionActive', false);
    if (error) {
      this.system('error', `The session ended with an error: ${truncate(error.message, 300)}`);
      this.host.telemetry(errorEvent('session_failed'));
      if (this.stats) this.stats.stopReason = 'error';
    }
    const reason = this.stats?.stopReason;
    const stored = this.storedSession();
    if (stored && stored.state === 'running') await this.persist(reason ? 'stopped' : 'idle');
    this.sendTelemetry();
    this.setPhase(reason === 'budget' || reason === 'user' ? 'stopped' : 'idle');
  }

  private sendTelemetry(): void {
    if (!this.stats) return;
    const reason = this.stats.stopReason;
    const stats: SessionStats = {
      durationMs: this.host.now() - this.stats.startedAt,
      tasks: this.snapshot.tasks.length,
      escalations: this.stats.escalations,
      costUsd: this.budget?.spentUsd ?? 0,
      outcome: reason === 'budget' ? 'budget' : reason === 'error' ? 'error' : reason === 'user' || reason === 'replaced' ? 'stopped' : 'completed',
      resumed: this.stats.resumed,
    };
    this.host.telemetry(sessionEndEvent(stats));
    this.stats = undefined;
  }

  // -------------------------------------------------------------------------
  // Events → chat

  private onEvent(event: UiEvent, pluginName: string): void {
    switch (event.kind) {
      case 'init': {
        void this.persist('running', event.sessionId);
        this.setPhase('running');
        this.host.log.info(`Session ${event.sessionId} started (model ${event.model}, key source ${event.apiKeySource}).`);
        if (!this.pluginChecked) {
          this.pluginChecked = true;
          const loaded = event.plugins.find((p) => p.name === pluginName);
          if (!loaded) {
            this.system('error', `The ${pluginName} plugin did not load${event.pluginErrors.length ? `: ${event.pluginErrors.join('; ')}` : ''}. Stopping the session.`);
            this.host.telemetry(errorEvent('plugin_missing'));
            void this.stop('error');
          } else if (event.pluginErrors.length) {
            this.system('warn', `Plugin warnings: ${event.pluginErrors.join('; ')}`);
            this.host.telemetry(errorEvent('plugin_error'));
          }
        }
        break;
      }
      case 'text':
        this.activeAgent = event.agent;
        this.pushEntry({ id: this.nextId(), type: 'agent', agent: event.agent, text: event.text, ...(event.model ? { model: event.model } : {}) });
        this.touchAgent(event.agent, event.model);
        break;
      case 'tool':
        this.activeAgent = event.agent;
        if (event.tool === 'AskUserQuestion') break;
        this.pushEntry({ id: this.nextId(), type: 'tool', agent: event.agent, tool: event.tool, detail: event.detail });
        this.touchAgent(event.agent);
        break;
      case 'agent': {
        const previous = this.agents.get(event.taskId);
        this.agents.set(event.taskId, { name: event.agent, status: event.status, ...(previous?.model ? { model: previous.model } : {}) });
        if (!previous || previous.status !== event.status) {
          const entry: ChatEntry = { id: this.nextId(), type: 'agentStatus', agent: event.agent, status: event.status };
          if (event.description) entry.description = event.description;
          if (event.summary) entry.summary = event.summary;
          this.pushEntry(entry);
        }
        if (event.status === 'running') this.activeAgent = event.agent;
        this.changed();
        break;
      }
      case 'result':
        void this.onResult(event);
        break;
      case 'retry':
        this.host.log.warn(`API retry ${event.attempt}/${event.maxRetries} in ${event.delayMs}ms (${event.error})`);
        // Retrying cannot fix a bad key or an unpaid account — stop instead of waiting out every retry.
        if (event.error === 'authentication_failed' || event.error === 'billing_error') {
          this.system(
            'error',
            event.error === 'authentication_failed'
              ? 'Authentication failed — check your API key (Crew: Set API Key). The session was stopped.'
              : 'The Anthropic account has a billing problem (check console.anthropic.com). The session was stopped.',
          );
          this.host.telemetry(errorEvent('auth_failed'));
          void this.stop('error');
        } else if (event.attempt === 1) {
          this.system('warn', `The Anthropic API is not responding (${event.error}); retrying…`);
        }
        break;
      case 'error':
        this.system('error', event.code === 'authentication_failed' ? 'Authentication failed — check your API key (Crew: Set API Key).' : event.message);
        if (event.code === 'authentication_failed') this.host.telemetry(errorEvent('auth_failed'));
        break;
      case 'compacting':
        if (event.active) this.system('info', 'Compacting the conversation…');
        break;
      case 'notice':
        this.system('info', event.text);
        break;
      case 'denied':
        this.host.log.info(`Denied ${event.tool}: ${event.message}`);
        break;
    }
  }

  private async onResult(event: Extract<UiEvent, { kind: 'result' }>): Promise<void> {
    const previousTotal = sessionTotalUsd(this.snapshot.costs, event.sessionId);
    const entry: ChatEntry = { id: this.nextId(), type: 'result', ok: event.ok, costUsd: event.totalCostUsd, durationMs: event.durationMs };
    if (event.text) entry.text = event.text;
    else if (event.errors.length) entry.text = event.errors.join('\n');
    this.pushEntry(entry);
    if (this.session && this.session.state !== 'closed') this.setPhase('waiting');
    this.activeAgent = undefined;
    for (const [id, agent] of this.agents) if (agent.status === 'running') this.agents.set(id, { ...agent, status: 'completed' });

    await this.appendCost(event.sessionId, event.totalCostUsd, Math.max(event.totalCostUsd - previousTotal, 0));
    await this.persist('idle', event.sessionId);
    if (event.budgetExceeded) {
      await this.onBudgetCap();
      return;
    }
    this.applyBudget(event.totalCostUsd);
  }

  private applyBudget(sessionTotal: number): void {
    if (!this.budget) return;
    const update = this.budget.update(sessionTotal);
    this.changed();
    if (update.crossedCap) {
      void this.onBudgetCap();
    } else if (update.crossedWarn) {
      void this.host.notify('warn', `Crew has spent ${formatUsd(update.spentUsd)} of the ${formatUsd(update.capUsd)} budget (80%).`, 'Open Settings');
    }
  }

  private async onBudgetCap(): Promise<void> {
    const status = this.budget?.status();
    const spent = formatUsd(status?.spentUsd ?? 0);
    const cap = formatUsd(status?.capUsd ?? this.host.config().budgetCapUsd);
    const message = `Budget cap reached: ${spent} of ${cap}. The session was stopped.`;
    await this.stop('budget');
    this.system('error', message);
    try {
      const current = (await this.host.readFile(CREW_PATHS.status)) ?? '# Status\n';
      await this.host.writeFile(CREW_PATHS.status, appendStatusNote(current, `⛔ Agent Crew stopped the session on ${new Date(this.host.now()).toISOString()}: budget cap reached (${spent} of ${cap}).`));
    } catch (err) {
      this.host.log.warn(`Could not update ${CREW_PATHS.status}: ${String(err)}`);
    }
    void this.host.notify('error', message, 'Open Settings');
  }

  private async appendCost(sessionId: string, total: number, delta: number): Promise<void> {
    const line = formatCostEntry({ timestamp: new Date(this.host.now()).toISOString(), sessionId, costUsd: delta, sessionTotalUsd: total, source: 'sdk' });
    try {
      const current = (await this.host.readFile(CREW_PATHS.costs)) ?? '';
      await this.host.writeFile(CREW_PATHS.costs, `${current}${current && !current.endsWith('\n') ? '\n' : ''}${line}\n`);
    } catch (err) {
      this.host.log.warn(`Could not write ${CREW_PATHS.costs}: ${String(err)}`);
    }
  }

  private startPolling(): void {
    this.stopPolling();
    this.pollTimer = setInterval(() => {
      if (!this.session || this.phase !== 'running') return;
      void this.session.liveCostUsd().then((total) => {
        if (total !== undefined) this.applyBudget(total);
      });
    }, LIVE_COST_POLL_MS);
  }

  private stopPolling(): void {
    if (this.pollTimer) clearInterval(this.pollTimer);
    this.pollTimer = undefined;
  }

  // -------------------------------------------------------------------------
  // Escalations

  private onEscalationRaised(escalation: LiveEscalation): void {
    if (this.stats) this.stats.escalations++;
    this.upsertEntry(this.escalationEntry(escalation));
    void this.host.notifyEscalation(escalation).then((choice) => {
      if (!choice) return;
      if (choice === OPEN_IN_CHAT) this.host.focusChat();
      else void this.answerEscalation(escalation.id, choice);
    });
  }

  private escalationEntry(e: LiveEscalation): ChatEntry {
    const entry: ChatEntry = {
      id: `esc-${e.id}`,
      type: 'escalation',
      escalationId: e.id,
      title: e.title,
      question: e.question,
      options: e.options,
      kind: e.kind,
      status: e.status === 'open' ? 'open' : e.status === 'cancelled' ? 'cancelled' : 'answered',
    };
    if (e.answer) entry.answer = e.answer;
    if (e.autoContinueAt && e.status === 'open') entry.autoContinueAt = e.autoContinueAt;
    return entry;
  }

  // -------------------------------------------------------------------------
  // Helpers

  private localStatus(): string {
    const s = this.snapshot;
    if (!s.exists) return 'No crew project in this workspace yet. Start one with "Crew: New Project".';
    const counts = new Map<string, number>();
    for (const t of s.tasks) counts.set(t.status, (counts.get(t.status) ?? 0) + 1);
    const tasks = ['todo', 'in_progress', 'review', 'done', 'blocked'].map((k) => `${k.replace('_', ' ')} ${counts.get(k) ?? 0}`).join(' · ');
    const open = s.escalations.filter((e) => e.status === 'open').length;
    const { spentUsd, capUsd } = this.state();
    const lines = [
      `Status${s.status?.phase ? ` — ${s.status.phase}` : ''}`,
      s.status?.summary,
      `Tasks: ${tasks}`,
      `Open escalations: ${open}`,
      `Budget: ${formatUsd(spentUsd)} of ${capUsd > 0 ? formatUsd(capUsd) : 'no cap'}`,
    ];
    return lines.filter(Boolean).join('\n');
  }

  private touchAgent(name: string, model?: string): void {
    for (const [id, agent] of this.agents) {
      if (agent.name === name && model && !agent.model) this.agents.set(id, { ...agent, model });
    }
    this.changed();
  }

  private system(level: 'info' | 'warn' | 'error', text: string): void {
    this.pushEntry({ id: this.nextId(), type: 'system', level, text });
    if (level === 'error') this.host.log.error(text);
  }

  private nextId(): string {
    this.entryCounter += 1;
    return `e${this.entryCounter}`;
  }

  private pushEntry(entry: ChatEntry): void {
    this.entries.push(entry);
    if (this.entries.length > MAX_ENTRIES) this.entries.splice(0, this.entries.length - MAX_ENTRIES);
    this.host.post({ type: 'append', entry });
  }

  private upsertEntry(entry: ChatEntry): void {
    const idx = this.entries.findIndex((e) => e.id === entry.id);
    if (idx >= 0) {
      this.entries[idx] = entry;
      this.host.post({ type: 'update', entry });
    } else {
      this.pushEntry(entry);
    }
  }

  private setPhase(phase: SessionPhase): void {
    this.phase = phase;
    this.changed();
  }

  private changed(): void {
    this.host.post({ type: 'state', state: this.state() });
    this.host.setContext('crew.canResume', this.state().canResume);
    for (const l of this.listeners) l();
  }

  private async persist(state: StoredSession['state'], sessionId?: string): Promise<void> {
    const id = sessionId ?? this.session?.sessionId ?? this.storedSession()?.sessionId;
    if (!id) return;
    const stored: StoredSession = { sessionId: id, state, updatedAt: this.host.now() };
    await this.host.workspaceState.update(SESSION_KEY, stored);
  }
}
