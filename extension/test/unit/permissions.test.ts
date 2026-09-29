import { describe, expect, it, vi } from 'vitest';
import type { PermissionUpdate } from '@anthropic-ai/claude-agent-sdk';
import { ALLOW, ALLOW_SESSION, createCanUseTool, DENY } from '../../src/agent/permissions';
import { EscalationCancelled, type EscalationRequest } from '../../src/crew/escalations';

const log = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };

function handler(answers: string[] | ((r: EscalationRequest) => Promise<string>)) {
  const requests: EscalationRequest[] = [];
  const raise = vi.fn(async (request: EscalationRequest) => {
    requests.push(request);
    return typeof answers === 'function' ? answers(request) : (answers.shift() ?? '');
  });
  const canUseTool = createCanUseTool({ raise, agentName: (id) => (id ? `agent-${id}` : 'lead'), log });
  return { canUseTool, requests };
}

const baseOptions = () => ({ signal: new AbortController().signal, toolUseID: 'tu-1', requestId: 'r-1' });

describe('createCanUseTool', () => {
  it('turns AskUserQuestion into question escalations and returns the answers', async () => {
    const { canUseTool, requests } = handler(['Postgres', 'Auth, Payments']);
    const input = {
      questions: [
        { question: 'Which database?', header: 'Database', options: [{ label: 'Postgres', description: 'Relational' }, { label: 'SQLite' }], multiSelect: false },
        { question: 'Which modules?', options: [{ label: 'Auth', description: 'Login' }, { label: 'Payments', description: 'Stripe' }], multiSelect: true },
        { header: 'ignored without question' },
        'junk',
      ],
    };
    const result = await canUseTool('AskUserQuestion', input, { ...baseOptions(), agentID: 'k1' });
    expect(requests).toHaveLength(2);
    expect(requests[0]).toMatchObject({ kind: 'question', title: 'agent-k1: Database', options: ['Postgres', 'SQLite'], agent: 'agent-k1' });
    expect(requests[0]?.question).toContain('• Postgres — Relational');
    expect(requests[1]?.title).toBe('agent-k1 has a question');
    expect(requests[1]?.question).toContain('Several options allowed');
    expect(result).toEqual({ behavior: 'allow', updatedInput: { ...input, answers: { 'Which database?': 'Postgres', 'Which modules?': 'Auth, Payments' } } });
  });

  it('handles AskUserQuestion input without questions', async () => {
    const { canUseTool } = handler([]);
    expect(await canUseTool('AskUserQuestion', {}, baseOptions())).toEqual({ behavior: 'allow', updatedInput: { answers: {} } });
  });

  it('escalates tool permissions and maps the answers', async () => {
    const suggestions: PermissionUpdate[] = [{ type: 'addRules', rules: [{ toolName: 'Bash', ruleContent: 'npm install' }], behavior: 'allow', destination: 'localSettings' }];
    const input = { command: 'npm install', description: 'Install deps' };

    const allow = handler([ALLOW]);
    expect(await allow.canUseTool('Bash', input, { ...baseOptions(), suggestions })).toEqual({ behavior: 'allow', updatedInput: input });
    expect(allow.requests[0]).toMatchObject({ kind: 'permission', options: [ALLOW, ALLOW_SESSION, DENY], title: 'lead: permission for Bash' });
    expect(allow.requests[0]?.question).toBe('lead wants to use Bash: Install deps.');

    const session = handler([ALLOW_SESSION]);
    const res = await session.canUseTool('Bash', input, { ...baseOptions(), suggestions, displayName: 'Run command', decisionReason: 'outside policy' });
    expect(res).toEqual({ behavior: 'allow', updatedInput: input, updatedPermissions: [{ ...suggestions[0], destination: 'session' }] });
    expect(session.requests[0]?.question).toContain('Reason: outside policy');

    const deny = handler([DENY]);
    expect(await deny.canUseTool('Write', { file_path: '/etc/hosts' }, { ...baseOptions(), title: 'Claude wants to write /etc/hosts' })).toMatchObject({ behavior: 'deny' });
    expect(deny.requests[0]).toMatchObject({ question: 'Claude wants to write /etc/hosts', options: [ALLOW, DENY] });

    const guidance = handler(['Use a temp dir instead']);
    const guided = await guidance.canUseTool('Write', { file_path: '/etc/hosts' }, { ...baseOptions(), suggestions, suppressAlwaysAllowRule: true });
    expect(guided).toMatchObject({ behavior: 'deny' });
    expect((guided as { message: string }).message).toContain('Use a temp dir instead');
    expect(guidance.requests[0]?.options).toEqual([ALLOW, DENY]);
  });

  it('denies with interrupt when the escalation is cancelled and denies on unexpected errors', async () => {
    const cancelled = handler(() => Promise.reject(new EscalationCancelled('Session ended')));
    expect(await cancelled.canUseTool('Bash', { command: 'ls' }, baseOptions())).toEqual({ behavior: 'deny', message: 'Not answered: Session ended.', interrupt: true });
    const broken = handler(() => Promise.reject(new Error('boom')));
    expect(await broken.canUseTool('Bash', { command: 'ls' }, baseOptions())).toMatchObject({ behavior: 'deny' });
    expect(log.error).toHaveBeenCalled();
  });
});
