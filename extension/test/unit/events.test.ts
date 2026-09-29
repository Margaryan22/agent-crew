import { describe, expect, it } from 'vitest';
import { describeToolUse, EventMapper } from '../../src/agent/events';
import { assistantText, assistantToolUse, initMessage, resultMessage, systemMessage } from './fakes';

describe('EventMapper', () => {
  it('maps init with plugins, errors and commands', () => {
    const mapper = new EventMapper();
    const [event] = mapper.map(initMessage('s-1', [{ name: 'agent-crew', version: '0.1.0' }, { name: 'other' }], { plugin_errors: [{ plugin: 'x', type: 'load', message: 'bad manifest' }] }));
    expect(event).toEqual({
      kind: 'init',
      sessionId: 's-1',
      model: 'claude-opus-5-5',
      apiKeySource: 'ANTHROPIC_API_KEY',
      plugins: [{ name: 'agent-crew', version: '0.1.0' }, { name: 'other' }],
      pluginErrors: ['x: bad manifest'],
      commands: ['agent-crew:new-project', 'agent-crew:feature', 'agent-crew:status'],
    });
  });

  it('attributes lead text, subagent tool calls and forwarded subagent text', () => {
    const mapper = new EventMapper();
    mapper.map(initMessage('s-1'));
    expect(mapper.map(assistantText('Planning the work'))).toEqual([{ kind: 'text', agent: 'lead', model: 'claude-opus-5-5', text: 'Planning the work', subagent: false }]);

    const spawn = mapper.map(assistantToolUse('Agent', { subagent_type: 'architect', description: 'Design the schema' }, 'tu-1'));
    expect(spawn).toEqual([{ kind: 'tool', agent: 'lead', tool: 'Agent', detail: 'architect: Design the schema', toolUseId: 'tu-1' }]);

    expect(mapper.map(assistantText('Schema drafted', { parent: 'tu-1' }))[0]).toMatchObject({ agent: 'architect', subagent: true });
    expect(mapper.map(assistantText('From type', { parent: 'tu-x', subagentType: 'qa' }))[0]).toMatchObject({ agent: 'qa' });
    expect(mapper.map(assistantText('Unknown parent', { parent: 'tu-unknown' }))[0]).toMatchObject({ agent: 'subagent' });
    expect(mapper.map(assistantText('   '))).toEqual([]);
  });

  it('tracks subagent task lifecycle', () => {
    const mapper = new EventMapper();
    mapper.map(assistantToolUse('Task', { subagent_type: 'backend', description: 'API' }, 'tu-2'));
    expect(mapper.map(systemMessage('task_started', { task_id: 'k1', tool_use_id: 'tu-2', description: 'Build API' }))).toEqual([
      { kind: 'agent', taskId: 'k1', agent: 'backend', status: 'running', description: 'Build API' },
    ]);
    expect(mapper.agentForTask('k1')).toBe('backend');
    expect(mapper.map(systemMessage('task_progress', { task_id: 'k1', description: 'Build API', usage: {}, summary: 'Writing routes' }))[0]).toMatchObject({ summary: 'Writing routes' });
    expect(mapper.map(systemMessage('task_progress', { task_id: 'k1', description: 'Build API', usage: {} }))[0]).not.toHaveProperty('summary');
    expect(mapper.map(systemMessage('task_updated', { task_id: 'k1', patch: { status: 'killed' } }))[0]).toMatchObject({ status: 'stopped' });
    expect(mapper.map(systemMessage('task_updated', { task_id: 'k1', patch: { status: 'failed' } }))[0]).toMatchObject({ status: 'failed' });
    expect(mapper.map(systemMessage('task_updated', { task_id: 'k1', patch: { status: 'completed' } }))[0]).toMatchObject({ status: 'completed' });
    expect(mapper.map(systemMessage('task_updated', { task_id: 'k1', patch: { status: 'running' } }))[0]).toMatchObject({ status: 'running' });
    expect(mapper.map(systemMessage('task_updated', { task_id: 'k1', patch: { status: 'paused' } }))).toEqual([]);
    expect(mapper.map(systemMessage('task_updated', { task_id: 'k1', patch: {} }))).toEqual([]);
    expect(mapper.map(systemMessage('task_notification', { task_id: 'k1', status: 'completed', summary: 'API ready', output_file: '' }))[0]).toMatchObject({
      kind: 'agent',
      status: 'completed',
      summary: 'API ready',
    });
    // Unknown tasks and ambient tasks are ignored
    expect(mapper.map(systemMessage('task_progress', { task_id: 'nope', description: '', usage: {} }))).toEqual([]);
    expect(mapper.map(systemMessage('task_notification', { task_id: 'nope', status: 'failed', summary: '' }))).toEqual([]);
    expect(mapper.map(systemMessage('task_started', { task_id: 'k2', description: 'watch', ambient: true }))).toEqual([]);
    expect(mapper.map(systemMessage('task_started', { task_id: 'k3', description: 'x', subagent_type: 'qa' }))[0]).toMatchObject({ agent: 'qa' });
    expect(mapper.map(systemMessage('task_started', { task_id: 'k4', description: 'y' }))[0]).toMatchObject({ agent: 'subagent' });
  });

  it('maps results, budget errors and failures', () => {
    const mapper = new EventMapper();
    expect(mapper.map(resultMessage('s-1', 1.25))).toEqual([
      { kind: 'result', ok: true, subtype: 'success', text: 'Done', totalCostUsd: 1.25, durationMs: 1234, numTurns: 3, errors: [], sessionId: 's-1', budgetExceeded: false },
    ]);
    expect(mapper.map(resultMessage('s-1', 5, 'error_max_budget_usd'))[0]).toMatchObject({ ok: false, budgetExceeded: true, errors: ['budget exceeded'] });
    expect(mapper.map(resultMessage('s-1', 0, 'success', ''))[0]).not.toHaveProperty('text');
  });

  it('maps retries, status, notifications and denials', () => {
    const mapper = new EventMapper();
    expect(mapper.map(systemMessage('api_retry', { attempt: 1, max_retries: 10, retry_delay_ms: 500, error: 'overloaded', error_status: 529 }))).toEqual([
      { kind: 'retry', attempt: 1, maxRetries: 10, delayMs: 500, error: 'overloaded' },
    ]);
    expect(mapper.map(systemMessage('status', { status: 'compacting' }))).toEqual([{ kind: 'compacting', active: true }]);
    expect(mapper.map(systemMessage('status', { status: null }))).toEqual([{ kind: 'compacting', active: false }]);
    expect(mapper.map(systemMessage('notification', { key: 'k', text: 'Heads up', priority: 'high' }))).toEqual([{ kind: 'notice', text: 'Heads up' }]);
    expect(mapper.map(systemMessage('notification', { key: 'k', text: 'meh', priority: 'low' }))).toEqual([]);
    expect(mapper.map(systemMessage('permission_denied', { tool_name: 'Bash', tool_use_id: 't', message: 'no' }))).toEqual([{ kind: 'denied', tool: 'Bash', message: 'no' }]);
    expect(mapper.map(systemMessage('hook_started', {}))).toEqual([]);
    expect(mapper.map({ type: 'user' } as never)).toEqual([]);
  });

  it('turns assistant API errors into error events', () => {
    const mapper = new EventMapper();
    expect(mapper.map(assistantText('Invalid API key', { error: 'authentication_failed' }))).toEqual([{ kind: 'error', code: 'authentication_failed', message: 'Invalid API key' }]);
  });
});

describe('describeToolUse', () => {
  it('summarizes common tools without dumping content', () => {
    expect(describeToolUse('Bash', { command: 'npm test', description: 'Run tests' })).toBe('Run tests');
    expect(describeToolUse('Bash', { command: 'x'.repeat(300) })).toHaveLength(160);
    expect(describeToolUse('Write', { file_path: '/work/project/src/a.ts', content: 'secret' }, '/work/project')).toBe('src/a.ts');
    expect(describeToolUse('Edit', { file_path: '/elsewhere/b.ts' }, '/work/project')).toBe('/elsewhere/b.ts');
    expect(describeToolUse('NotebookEdit', { notebook_path: 'n.ipynb' })).toBe('n.ipynb');
    expect(describeToolUse('Grep', { pattern: 'TODO', path: '/work/project/src' }, '/work/project')).toBe('TODO in src');
    expect(describeToolUse('Glob', { pattern: '**/*.ts' })).toBe('**/*.ts');
    expect(describeToolUse('WebFetch', { url: 'https://x.dev' })).toBe('https://x.dev');
    expect(describeToolUse('WebSearch', { query: 'tanstack' })).toBe('tanstack');
    expect(describeToolUse('Skill', { skill: 'agent-crew:plan' })).toBe('agent-crew:plan');
    expect(describeToolUse('TodoWrite', { todos: [1, 2] })).toBe('2 todos');
    expect(describeToolUse('TodoWrite', {})).toBe('');
    expect(describeToolUse('Task', {})).toBe('agent:');
    expect(describeToolUse('Mystery', null)).toBe('');
    expect(describeToolUse('Read', {}, '/w')).toBe('');
  });
});
