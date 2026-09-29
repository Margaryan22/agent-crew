import { describe, expect, it, vi } from 'vitest';
import { buildSessionEnv, CrewSession, MessageQueue, type SessionConfig } from '../../src/agent/session';
import { FakeSdk, initMessage, resultMessage, tick, until } from './fakes';

const log = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };

function config(overrides: Partial<SessionConfig> = {}): SessionConfig {
  return {
    cwd: '/work/project',
    pluginPath: '/ext/resources/plugin',
    executablePath: '/ext/dist/bin/claude',
    apiKey: 'sk-ant-api03-secret-value-0123456789',
    crewEnv: { CREW_AUTONOMY: 'full' },
    canUseTool: async () => ({ behavior: 'deny', message: 'no' }),
    clientApp: 'agent-crew-vscode/test',
    ...overrides,
  };
}

describe('buildSessionEnv', () => {
  it('drops inherited Claude Code variables and competing credentials', () => {
    const env = buildSessionEnv(
      {
        PATH: '/bin',
        HOME: '/home/me',
        CLAUDECODE: '1',
        CLAUDE_CODE_ENTRYPOINT: 'cli',
        CLAUDE_CODE_OAUTH_TOKEN: 'oauth',
        CLAUDE_AGENT_SDK_VERSION: '1',
        CLAUDE_PID: '42',
        ANTHROPIC_API_KEY: 'old-key',
        ANTHROPIC_AUTH_TOKEN: 'token',
        ANTHROPIC_BASE_URL: 'https://proxy.example',
        CREW_AUTONOMY: 'stale',
      },
      'sk-ant-new',
      { CREW_AUTONOMY: 'review' },
    );
    expect(env).toEqual({ PATH: '/bin', HOME: '/home/me', ANTHROPIC_BASE_URL: 'https://proxy.example', CREW_AUTONOMY: 'review', ANTHROPIC_API_KEY: 'sk-ant-new' });
  });
});

describe('MessageQueue', () => {
  it('delivers buffered and awaited messages, then ends on close', async () => {
    const queue = new MessageQueue();
    queue.push('first');
    const it = queue[Symbol.asyncIterator]();
    expect((await it.next()).value?.message.content).toBe('first');
    const waiting = it.next();
    queue.push('second');
    const second = await waiting;
    expect(second.value).toMatchObject({ type: 'user', parent_tool_use_id: null, origin: { kind: 'human' } });
    const ended = it.next();
    queue.close();
    expect((await ended).done).toBe(true);
    expect((await it.next()).done).toBe(true);
    expect(queue.isClosed).toBe(true);
    expect(() => queue.push('late')).toThrow('closed');
    const other = new MessageQueue();
    await other[Symbol.asyncIterator]().return?.();
    expect(other.isClosed).toBe(true);
  });
});

describe('CrewSession', () => {
  it('starts a streaming query with the plugin, explicit executable and remaining budget', async () => {
    const sdk = new FakeSdk();
    const session = new CrewSession(sdk, config({ maxBudgetUsd: 0.001 }), log);
    session.start('/agent-crew:new-project habit tracker');
    const q = sdk.last;
    expect(q.options).toMatchObject({
      cwd: '/work/project',
      pathToClaudeCodeExecutable: '/ext/dist/bin/claude',
      plugins: [{ type: 'local', path: '/ext/resources/plugin' }],
      settingSources: ['project', 'local'],
      permissionMode: 'default',
      forwardSubagentText: true,
      persistSession: true,
      maxBudgetUsd: 0.01,
    });
    expect(q.options.env).toMatchObject({ ANTHROPIC_API_KEY: 'sk-ant-api03-secret-value-0123456789', CREW_AUTONOMY: 'full', CLAUDE_AGENT_SDK_CLIENT_APP: 'agent-crew-vscode/test' });
    expect(q.options.resume).toBeUndefined();
    await until(() => q.userMessages.length === 1);
    expect(q.userMessages).toEqual(['/agent-crew:new-project habit tracker']);
    expect(session.state).toBe('running');
    expect(() => session.start('again')).toThrow('already started');

    const seen: string[] = [];
    session.onMessage((m) => seen.push(m.type));
    q.emit(initMessage('sess-42'));
    q.emit(resultMessage('sess-42', 0.5));
    await until(() => seen.length === 2);
    expect(session.sessionId).toBe('sess-42');
    expect(session.state).toBe('idle');

    session.send('follow-up');
    await until(() => q.userMessages.length === 2);
    q.options.stderr?.('some stderr\n');
    expect(log.debug).toHaveBeenCalledWith('[claude] some stderr');

    await session.interrupt();
    expect(q.interrupted).toBe(1);
    const exits: unknown[] = [];
    session.onExit((e) => exits.push(e));
    session.close('test');
    await until(() => exits.length === 1);
    expect(exits[0]).toEqual({ aborted: true });
    expect(session.state).toBe('closed');
    expect(() => session.send('x')).toThrow('closed');
    session.close('twice');
    await session.interrupt();
    expect(q.interrupted).toBe(1);
  });

  it('resumes by id and reports live cost when available', async () => {
    const sdk = new FakeSdk();
    const session = new CrewSession(sdk, config({ resumeSessionId: 'old-session' }), log);
    expect(session.sessionId).toBe('old-session');
    expect(await session.liveCostUsd()).toBeUndefined();
    session.start('continue');
    expect(sdk.last.options.resume).toBe('old-session');
    expect(sdk.last.options.maxBudgetUsd).toBeUndefined();
    sdk.last.liveCost = 1.75;
    expect(await session.liveCostUsd()).toBe(1.75);
    sdk.last.liveCost = undefined;
    expect(await session.liveCostUsd()).toBeUndefined();
    sdk.last.liveCost = 3;
    // After the first failure the experimental API is not called again
    expect(await session.liveCostUsd()).toBeUndefined();
  });

  it('reports a failing query as an error exit and survives throwing listeners', async () => {
    const sdk = new FakeSdk();
    const session = new CrewSession(sdk, config(), log);
    const exits: { error?: Error; aborted: boolean }[] = [];
    session.onExit((e) => exits.push(e));
    session.onMessage(() => {
      throw new Error('listener bug');
    });
    session.start('go');
    sdk.last.emit(initMessage('s'));
    await tick(5);
    sdk.last.end(new Error('process crashed'));
    await until(() => exits.length === 1);
    expect(exits[0]?.aborted).toBe(false);
    expect(exits[0]?.error?.message).toBe('process crashed');
    expect(log.error).toHaveBeenCalled();
  });

  it('logs failed interrupts', async () => {
    const sdk = new FakeSdk();
    const session = new CrewSession(sdk, config(), log);
    session.start('go');
    sdk.last.interrupt = () => Promise.reject(new Error('not now'));
    await session.interrupt();
    expect(log.warn).toHaveBeenCalledWith('Interrupt failed: Error: not now');
  });
});
