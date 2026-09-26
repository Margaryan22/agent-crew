import { afterEach, describe, expect, it, vi } from 'vitest';
import type { CanUseTool } from '@anthropic-ai/claude-agent-sdk';
import { CrewController, OPEN_IN_CHAT, SESSION_KEY, type StoredSession, toPluginPrompt } from '../../src/controller';
import { EMPTY_SNAPSHOT } from '../../src/crew/model';
import { parseCostsLog, parseEscalation } from '../../src/crew/parser';
import type { ChatEntry } from '../../src/shared/protocol';
import { assistantText, FakeHost, type FakeHostOptions, initMessage, resultMessage, systemMessage, tick, until } from './fakes';

function setup(options: FakeHostOptions = {}) {
  const host = new FakeHost(options);
  const controller = new CrewController(host);
  const entries = () =>
    host.posted.flatMap((m) => (m.type === 'append' || m.type === 'update' ? [m.entry] : [])).reduce<ChatEntry[]>((acc, e) => {
      const i = acc.findIndex((x) => x.id === e.id);
      if (i >= 0) acc[i] = e;
      else acc.push(e);
      return acc;
    }, []);
  const stored = () => host.workspaceState.get<StoredSession>(SESSION_KEY);
  return { host, controller, entries, stored };
}

const opts = () => ({ signal: new AbortController().signal, toolUseID: 't1', requestId: 'r1' });

afterEach(() => {
  vi.useRealTimers();
});

describe('toPluginPrompt', () => {
  it('namespaces plugin commands only', () => {
    expect(toPluginPrompt('/new-project  a habit tracker ', 'agent-crew')).toBe('/agent-crew:new-project a habit tracker');
    expect(toPluginPrompt('/STATUS', 'agent-crew')).toBe('/agent-crew:status');
    expect(toPluginPrompt('/compact', 'agent-crew')).toBe('/compact');
    expect(toPluginPrompt('just text', 'agent-crew')).toBe('just text');
  });
});

describe('CrewController — starting sessions', () => {
  it('runs /new-project through the plugin and streams events into the chat', async () => {
    const { host, controller, entries, stored } = setup();
    expect(await controller.newProject('habit tracker')).toBe(true);
    const q = host.sdk.last;
    await until(() => q.userMessages.length === 1);
    expect(q.userMessages[0]).toBe('/agent-crew:new-project habit tracker');
    expect(q.options.maxBudgetUsd).toBe(20);
    expect(q.options.env).toMatchObject({ CREW_AUTONOMY: 'full', CREW_STACK_PROFILE: 'tanstack', CREW_BRIEF_REVIEW_MINUTES: '10', CREW_BUDGET_CAP_USD: '20', CREW_HOST: 'vscode' });
    expect(host.contexts.get('crew.sessionActive')).toBe(true);
    expect(host.projectStates.get('/work/project')).toBe('active');
    expect(controller.isActive).toBe(true);

    q.emit(initMessage('sess-1'));
    q.emit(assistantText('Writing the brief'));
    q.emit(systemMessage('task_started', { task_id: 'k1', description: 'Design', subagent_type: 'architect' }));
    q.emit(assistantText('Schema ready', { parent: 'tu-9', subagentType: 'architect', model: 'claude-sonnet-5' }));
    await until(() => entries().some((e) => e.type === 'agent' && e.agent === 'architect'));
    expect(stored()).toMatchObject({ sessionId: 'sess-1', state: 'running' });
    expect(controller.state()).toMatchObject({ phase: 'running', activeAgent: 'architect' });
    expect(controller.state().agents).toEqual([{ name: 'architect', status: 'running', model: 'claude-sonnet-5' }]);

    q.emit(resultMessage('sess-1', 1.5));
    await until(() => host.files.has('.crew/costs.log'));
    const costs = parseCostsLog(host.files.get('.crew/costs.log')!);
    expect(costs).toEqual([{ timestamp: '2026-09-26T10:00:00.000Z', sessionId: 'sess-1', costUsd: 1.5, sessionTotalUsd: 1.5, source: 'sdk' }]);
    await until(() => stored()?.state === 'idle');
    expect(controller.state()).toMatchObject({ phase: 'waiting', spentUsd: 1.5 });
    expect(controller.state().activeAgent).toBeUndefined();
    expect(entries().map((e) => e.type)).toEqual(['user', 'agent', 'agentStatus', 'agent', 'result']);

    // Follow-up from the chat goes into the same session
    await controller.submit('/feature dark mode');
    await until(() => q.userMessages.length === 2);
    expect(q.userMessages[1]).toBe('/agent-crew:feature dark mode');
    await controller.status();
    await until(() => q.userMessages.length === 3);
    expect(q.userMessages[2]).toBe('/agent-crew:status');
    await controller.feature('export to CSV');
    await until(() => q.userMessages.length === 4);
    expect(q.userMessages[3]).toBe('/agent-crew:feature export to CSV');
  });

  it('refuses to start in an untrusted workspace', async () => {
    const { host, controller } = setup({ trusted: false });
    expect(await controller.newProject('x')).toBe(false);
    expect(host.sdk.queries).toHaveLength(0);
    expect(host.notifications[0]?.message).toContain('trusted');
  });

  it('asks for an API key, checks dependencies, budget and license', async () => {
    const noKey = setup({ apiKey: undefined });
    noKey.host.notifyAnswer = 'Set API Key';
    expect(await noKey.controller.newProject('x')).toBe(false);
    expect(noKey.host.commands).toEqual(['crew.setApiKey']);

    const noBinary = setup({ runtime: { executable: undefined, problems: ['No Claude Code executable found'] } });
    noBinary.host.notifyAnswer = 'Check Dependencies';
    expect(await noBinary.controller.newProject('x')).toBe(false);
    expect(noBinary.host.commands).toEqual(['crew.checkDependencies']);

    const noPlugin = setup({ runtime: { problems: ['The agent-crew plugin is missing from the extension (resources/plugin).'] } });
    expect(await noPlugin.controller.newProject('x')).toBe(false);

    const broke = setup({ files: {} });
    broke.controller.onSnapshot({ ...EMPTY_SNAPSHOT, exists: true, costs: parseCostsLog('2026-01-01 session=a session_total_usd=25') });
    expect(await broke.controller.newProject('x')).toBe(false);
    expect(broke.host.notifications[0]?.message).toContain('Budget cap reached');

    const unlicensed = setup({ startCheck: { allowed: false, reason: 'Free plan allows 1 active project' } });
    expect(await unlicensed.controller.newProject('x')).toBe(false);
    expect(unlicensed.host.notifications[0]).toMatchObject({ message: 'Free plan allows 1 active project', actions: ['Enter License'] });

    for (const c of [noKey, noBinary, noPlugin, broke, unlicensed]) expect(c.host.sdk.queries).toHaveLength(0);
  });

  it('refuses to start when the SDK cannot be loaded or the session throws', async () => {
    const { host, controller } = setup();
    host.loadSdk = () => Promise.reject(new Error('ESM load failed'));
    expect(await controller.newProject('x')).toBe(false);
    expect(host.telemetryEvents).toEqual([{ name: 'error', data: { kind: 'session_failed' } }]);

    const second = setup();
    second.host.sdk.query = () => {
      throw new Error('spawn ENOENT');
    };
    expect(await second.controller.newProject('x')).toBe(false);
    expect(second.controller.isActive).toBe(false);
  });

  it('keeps one session per workspace', async () => {
    const { host, controller } = setup();
    await controller.newProject('first');
    host.notifyAnswer = 'Cancel';
    expect(await controller.newProject('second')).toBe(false);
    host.notifyAnswer = 'Stop and Start';
    expect(await controller.newProject('second')).toBe(true);
    expect(host.sdk.queries).toHaveLength(2);
    expect(host.sdk.queries[0]?.closed).toBe(true);
  });

  it('stops the session when the plugin did not load', async () => {
    const { host, controller, entries } = setup();
    await controller.newProject('x');
    host.sdk.last.emit(initMessage('s', [{ name: 'something-else' }], { plugin_errors: [{ plugin: 'inline[0]', type: 'load', message: 'manifest invalid' }] }));
    await until(() => host.sdk.last.closed);
    expect(entries().some((e) => e.type === 'system' && e.text.includes('did not load: inline[0]: manifest invalid'))).toBe(true);
    expect(host.telemetryEvents).toContainEqual({ name: 'error', data: { kind: 'plugin_missing' } });
  });

  it('warns about plugin load warnings but keeps going', async () => {
    const { host, controller, entries } = setup();
    await controller.newProject('x');
    host.sdk.last.emit(initMessage('s', [{ name: 'agent-crew' }], { plugin_errors: [{ plugin: 'agent-crew', type: 'hooks', message: 'hook skipped' }] }));
    await until(() => entries().some((e) => e.type === 'system' && e.level === 'warn'));
    expect(host.sdk.last.closed).toBe(false);
  });
});

describe('CrewController — chat routing', () => {
  it('routes typed text depending on the project and session state', async () => {
    const fresh = setup();
    await fresh.controller.submit('a todo app');
    await until(() => fresh.host.sdk.last.userMessages.length === 1);
    expect(fresh.host.sdk.last.userMessages[0]).toBe('/agent-crew:new-project a todo app');

    const existing = setup();
    existing.controller.onSnapshot({ ...EMPTY_SNAPSHOT, exists: true });
    await existing.controller.submit('add search');
    await until(() => existing.host.sdk.last.userMessages.length === 1);
    expect(existing.host.sdk.last.userMessages[0]).toBe('/agent-crew:feature add search');

    const resumable = setup();
    resumable.controller.onSnapshot({ ...EMPTY_SNAPSHOT, exists: true });
    await resumable.host.workspaceState.update(SESSION_KEY, { sessionId: 'old', state: 'idle', updatedAt: 0 });
    await resumable.controller.submit('also add tags');
    expect(resumable.host.sdk.last.options.resume).toBe('old');
    await until(() => resumable.host.sdk.last.userMessages.length === 1);
    expect(resumable.host.sdk.last.userMessages[0]).toBe('also add tags');

    const slash = setup();
    await slash.controller.submit('/compact');
    expect(slash.host.sdk.queries).toHaveLength(1);
    await slash.controller.submit('   ');
    expect(slash.host.sdk.queries).toHaveLength(1);
  });

  it('answers /status locally without a session', async () => {
    const { host, controller, entries } = setup();
    await controller.submit('/status');
    expect(entries()[0]).toMatchObject({ type: 'system', text: expect.stringContaining('No crew project') });
    controller.onSnapshot({
      ...EMPTY_SNAPSHOT,
      exists: true,
      status: { phase: 'build', summary: 'Two tasks left.' },
      tasks: [
        { id: 'T-1', title: 'a', status: 'done', attempts: 1, files: [], path: '' },
        { id: 'T-2', title: 'b', status: 'in_progress', attempts: 0, files: [], path: '' },
      ],
      escalations: [{ id: 'E-1', title: 'q', question: 'q', options: [], status: 'resolved', kind: 'question' }],
      costs: parseCostsLog('2026-01-01 session=a session_total_usd=4'),
    });
    await controller.status();
    const text = (entries().at(-1) as { text: string }).text;
    expect(text).toContain('Status — build');
    expect(text).toContain('Two tasks left.');
    expect(text).toContain('in progress 1');
    expect(text).toContain('done 1');
    expect(text).toContain('Open escalations: 0');
    expect(text).toContain('Budget: $4.00 of $20.0');
    expect(host.sdk.queries).toHaveLength(0);
  });
});

describe('CrewController — escalations', () => {
  it('answers an AskUserQuestion escalation from the notification buttons', async () => {
    const { host, controller, entries } = setup();
    await controller.newProject('x');
    host.escalationAnswer = 'Postgres';
    const canUseTool = host.sdk.last.options.canUseTool as CanUseTool;
    const result = await canUseTool('AskUserQuestion', { questions: [{ question: 'Which DB?', header: 'DB', options: [{ label: 'Postgres' }, { label: 'SQLite' }] }] }, opts());
    expect(result).toMatchObject({ behavior: 'allow', updatedInput: { answers: { 'Which DB?': 'Postgres' } } });
    expect(host.escalationNotifications).toEqual(['E-001']);
    expect(parseEscalation(host.files.get('.crew/escalations/E-001.md')!, 'E-001.md')).toMatchObject({ status: 'answered', answer: 'Postgres' });
    const card = entries().find((e) => e.type === 'escalation');
    expect(card).toMatchObject({ escalationId: 'E-001', status: 'answered', answer: 'Postgres' });
  });

  it('answers a permission escalation from the chat and focuses the chat on request', async () => {
    const { host, controller } = setup();
    await controller.newProject('x');
    host.escalationAnswer = OPEN_IN_CHAT;
    const canUseTool = host.sdk.last.options.canUseTool as CanUseTool;
    const pending = canUseTool('Bash', { command: 'rm -rf build' }, opts());
    await until(() => host.focused === 1);
    await controller.answerEscalation('E-001', 'Deny');
    expect(await pending).toMatchObject({ behavior: 'deny' });
    await controller.answerEscalation('E-001', 'Allow');
    await controller.answerEscalation('E-999', 'Allow');
    expect(host.posted.some((m) => m.type === 'append' && m.entry.type === 'system' && m.entry.text.includes('already answered'))).toBe(true);
    expect(host.posted.some((m) => m.type === 'append' && m.entry.type === 'system' && m.entry.text.includes('Unknown escalation'))).toBe(true);
  });

  it('delivers answers to plugin-written escalations as a chat message, or records them without a session', async () => {
    const { host, controller } = setup();
    const escalation = parseEscalation('---\nid: E-004\noptions: [Stripe, Paddle]\n---\n# Payments\n\nWhich provider?', '.crew/escalations/E-004.md');
    controller.onSnapshot({ ...EMPTY_SNAPSHOT, exists: true, escalations: [escalation] });
    expect(host.escalationNotifications).toEqual(['E-004']);
    await controller.answerEscalation('E-004', 'Stripe');
    expect(host.posted.some((m) => m.type === 'append' && m.entry.type === 'system' && m.entry.text.includes('will reach the crew when the session resumes'))).toBe(true);

    const live = setup();
    await live.controller.newProject('x');
    live.controller.onSnapshot({ ...EMPTY_SNAPSHOT, exists: true, escalations: [escalation] });
    await live.controller.answerEscalation('E-004', 'Paddle');
    await until(() => live.host.sdk.last.userMessages.length === 2);
    expect(live.host.sdk.last.userMessages[1]).toContain('Answer to escalation E-004 (Payments): Paddle');
  });

  it('cancels waiting escalations when the session ends', async () => {
    const { host, controller } = setup();
    await controller.newProject('x');
    const canUseTool = host.sdk.last.options.canUseTool as CanUseTool;
    const pending = canUseTool('Bash', { command: 'ls' }, opts());
    await tick(5);
    await controller.stop();
    expect(await pending).toMatchObject({ behavior: 'deny', interrupt: true });
  });
});

describe('CrewController — budget', () => {
  it('warns at 80% and stops the session at the cap', async () => {
    const { host, controller, stored } = setup({ config: { budgetCapUsd: 2 } });
    host.files.set('.crew/status.md', '# Status\n\nBuilding.');
    await controller.newProject('x');
    const q = host.sdk.last;
    expect(q.options.maxBudgetUsd).toBe(2);
    q.emit(initMessage('s-b'));
    q.emit(resultMessage('s-b', 1.7));
    await until(() => host.notifications.some((n) => n.level === 'warn'));
    expect(host.notifications.find((n) => n.level === 'warn')?.message).toContain('80%');

    q.emit(resultMessage('s-b', 2.1));
    await until(() => host.notifications.some((n) => n.level === 'error'));
    expect(q.interrupted).toBe(1);
    expect(q.closed).toBe(true);
    expect(host.files.get('.crew/status.md')).toContain('budget cap reached ($2.10 of $2.00)');
    await until(() => stored()?.state === 'stopped');
    await until(() => host.telemetryEvents.some((e) => e.name === 'session_end'));
    expect(host.telemetryEvents.find((e) => e.name === 'session_end')?.data).toMatchObject({ outcome: 'budget', costUsd: 2.1 });
    expect(controller.state().phase).toBe('stopped');
    expect(host.projectStates.get('/work/project')).toBe('stopped');
  });

  it('stops on the SDK budget error result', async () => {
    const { host, controller } = setup();
    await controller.newProject('x');
    host.sdk.last.emit(resultMessage('s', 20.3, 'error_max_budget_usd'));
    await until(() => host.sdk.last.closed);
    expect(host.files.get('.crew/status.md')).toContain('budget cap reached');
  });

  it('polls live cost during a turn and stops when a lowered cap is exceeded', async () => {
    vi.useFakeTimers();
    const { host, controller } = setup({ config: { budgetCapUsd: 10 } });
    await controller.newProject('x');
    const q = host.sdk.last;
    q.emit(initMessage('s-live'));
    await vi.advanceTimersByTimeAsync(1);
    q.liveCost = 6;
    await vi.advanceTimersByTimeAsync(15_000);
    expect(controller.state().spentUsd).toBe(6);
    host.cfg.budgetCapUsd = 5;
    controller.onConfigChanged();
    await vi.advanceTimersByTimeAsync(1);
    expect(q.closed).toBe(true);
  });

  it('continues a resumed session from its recorded total', async () => {
    const { host, controller } = setup();
    controller.onSnapshot({ ...EMPTY_SNAPSHOT, exists: true, costs: parseCostsLog('2026-01-01 session=old session_total_usd=3\n2026-01-01 session=other session_total_usd=2') });
    await host.workspaceState.update(SESSION_KEY, { sessionId: 'old', state: 'running', updatedAt: 0 });
    host.notifyAnswer = 'Resume';
    await controller.offerResume();
    const q = host.sdk.last;
    expect(q.options.resume).toBe('old');
    expect(q.options.maxBudgetUsd).toBe(15);
    await until(() => q.userMessages.length === 1);
    expect(q.userMessages[0]).toContain('Continue where you left off');
    expect(controller.state().spentUsd).toBe(5);
    q.emit(resultMessage('old', 3.5));
    await until(() => (host.files.get('.crew/costs.log') ?? '').includes('session=old'));
    expect(host.files.get('.crew/costs.log')).toContain('turn_cost_usd=0.500000 session_total_usd=3.500000');
  });
});

describe('CrewController — lifecycle', () => {
  it('only offers resume for a session interrupted mid-turn', async () => {
    const { host, controller } = setup();
    await controller.offerResume();
    await host.workspaceState.update(SESSION_KEY, { sessionId: 'old', state: 'idle', updatedAt: 0 });
    await controller.offerResume();
    expect(host.notifications).toHaveLength(0);
    await host.workspaceState.update(SESSION_KEY, { sessionId: 'old', state: 'running', updatedAt: 0 });
    host.notifyAnswer = 'Not now';
    await controller.offerResume();
    expect(host.notifications).toHaveLength(1);
    expect(host.sdk.queries).toHaveLength(0);
    expect(controller.state().canResume).toBe(true);
  });

  it('resume without a stored session informs the user', async () => {
    const { host, controller } = setup();
    expect(await controller.resume()).toBe(false);
    expect(host.notifications[0]?.message).toContain('no Crew session to resume');
  });

  it('stop keeps the id for a later resume', async () => {
    const { host, controller, stored } = setup();
    await controller.newProject('x');
    host.sdk.last.emit(initMessage('s-stop'));
    await until(() => stored()?.sessionId === 's-stop');
    await controller.stop();
    expect(stored()).toMatchObject({ sessionId: 's-stop', state: 'stopped' });
    await until(() => !controller.isActive);
    expect(controller.state()).toMatchObject({ phase: 'stopped', canResume: true });
    expect(host.contexts.get('crew.sessionActive')).toBe(false);
    expect(await controller.resume()).toBe(true);
    expect(host.sdk.last.options.resume).toBe('s-stop');
    expect(await controller.resume()).toBe(false);
  });

  it('reports a crashed session', async () => {
    const { host, controller, entries, stored } = setup();
    await controller.newProject('x');
    host.sdk.last.emit(initMessage('s-crash'));
    await until(() => stored()?.state === 'running');
    host.sdk.last.end(new Error('claude exited with code 1'));
    await until(() => !controller.isActive);
    expect(entries().at(-1)).toMatchObject({ type: 'system', level: 'error', text: expect.stringContaining('claude exited with code 1') });
    expect(host.telemetryEvents).toContainEqual({ name: 'error', data: { kind: 'session_failed' } });
    expect(stored()?.state).toBe('stopped');
  });

  it('a session that ends normally is left idle and reports telemetry', async () => {
    const { host, controller, stored } = setup();
    await controller.newProject('x');
    host.sdk.last.emit(initMessage('s-end'));
    await until(() => stored()?.state === 'running');
    host.sdk.last.end();
    await until(() => !controller.isActive);
    expect(stored()?.state).toBe('idle');
    expect(host.telemetryEvents.at(-1)).toMatchObject({ name: 'session_end', data: { outcome: 'completed', resumed: false } });
  });

  it('dispose keeps the stored state so the next window offers resume', async () => {
    const { host, controller, stored } = setup();
    await controller.newProject('x');
    host.sdk.last.emit(initMessage('s-reload'));
    host.sdk.last.emit(assistantText('working'));
    await until(() => stored()?.state === 'running');
    controller.dispose();
    await tick(10);
    expect(stored()).toMatchObject({ sessionId: 's-reload', state: 'running' });
    expect(host.sdk.last.closed).toBe(true);
  });

  it('maps retries, auth errors, compaction and notices into the chat', async () => {
    const { host, controller, entries } = setup();
    await controller.newProject('x');
    const q = host.sdk.last;
    q.emit(systemMessage('api_retry', { attempt: 1, max_retries: 5, retry_delay_ms: 100, error: 'overloaded', error_status: 529 }));
    q.emit(systemMessage('api_retry', { attempt: 2, max_retries: 5, retry_delay_ms: 100, error: 'overloaded', error_status: 529 }));
    q.emit(assistantText('Invalid API key', { error: 'authentication_failed' }));
    q.emit(systemMessage('status', { status: 'compacting' }));
    q.emit(systemMessage('notification', { key: 'k', text: 'Rate limit soon', priority: 'high' }));
    q.emit(systemMessage('permission_denied', { tool_name: 'Bash', tool_use_id: 't', message: 'policy' }));
    await until(() => entries().filter((e) => e.type === 'system').length === 4);
    const texts = entries()
      .filter((e): e is Extract<ChatEntry, { type: 'system' }> => e.type === 'system')
      .map((e) => e.text);
    expect(texts[0]).toContain('retrying');
    expect(texts[1]).toContain('Authentication failed');
    expect(texts[2]).toContain('Compacting');
    expect(texts[3]).toBe('Rate limit soon');
    expect(host.telemetryEvents).toContainEqual({ name: 'error', data: { kind: 'auth_failed' } });
  });

  it('stops at once when the API rejects the key instead of waiting out the retries', async () => {
    for (const error of ['authentication_failed', 'billing_error']) {
      const { host, controller, entries } = setup();
      await controller.newProject('x');
      host.sdk.last.emit(systemMessage('api_retry', { attempt: 1, max_retries: 10, retry_delay_ms: 500, error, error_status: 401 }));
      await until(() => host.sdk.last.closed);
      expect(entries().some((e) => e.type === 'system' && e.level === 'error' && e.text.includes('session was stopped'))).toBe(true);
      expect(host.telemetryEvents).toContainEqual({ name: 'error', data: { kind: 'auth_failed' } });
    }
  });

  it('never posts the API key to the chat or the log', async () => {
    const key = 'sk-ant-api03-test-key-0123456789abcdefghij';
    const { host, controller } = setup({ apiKey: key });
    await controller.newProject('x');
    const q = host.sdk.last;
    expect(q.options.env?.ANTHROPIC_API_KEY).toBe(key);
    q.emit(initMessage('s-key'));
    q.emit(resultMessage('s-key', 0.1));
    await until(() => host.files.has('.crew/costs.log'));
    q.end(new Error('boom'));
    await until(() => !controller.isActive);
    expect(JSON.stringify(host.posted)).not.toContain(key);
    expect(host.logs.join('\n')).not.toContain(key);
    expect(JSON.stringify([...host.files.values()])).not.toContain(key);
    expect(JSON.stringify([...host.workspaceState.data.values()])).not.toContain(key);
  });

  it('initMessage replays the transcript and state', async () => {
    const { controller } = setup();
    controller.setHasApiKey(true);
    await controller.submit('/status');
    const init = controller.initMessage();
    expect(init.type).toBe('init');
    if (init.type === 'init') {
      expect(init.entries).toHaveLength(1);
      expect(init.state.hasApiKey).toBe(true);
    }
  });
});
