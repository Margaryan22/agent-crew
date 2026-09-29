import { describe, expect, it } from 'vitest';
import {
  answerEscalation,
  cancelEscalation,
  markStopped,
  parseFrontmatter,
  readEscalation,
  readStatus,
  renderDecision,
  renderEscalation,
  renderManifest,
  renderSessionMarker,
  renderStatus,
  renderTask,
  resolveEscalation,
  validateCrewFile,
} from '../src/index';

const at = '2026-09-29T12:00:00Z';

describe('renderers produce files that validate strictly', () => {
  it('task, with canonical key order and a default body', () => {
    const text = renderTask({ updated_at: at, created_at: at, attempts: 1, owner: 'qa', status: 'review', review_stage: 'security', title: 'Harden auth', id: 'T-004', extra: 'kept' });
    expect(Object.keys(parseFrontmatter(text).data)).toEqual(['id', 'title', 'status', 'owner', 'attempts', 'review_stage', 'created_at', 'updated_at', 'extra']);
    expect(text).toContain('# T-004: Harden auth');
    expect(validateCrewFile('.crew/tasks/T-004.md', text)?.ok).toBe(true);
    expect(() => renderTask({ id: 'bad' } as never)).toThrow();
  });

  it('escalation with problem, tried, option notes and recommendation', () => {
    const text = renderEscalation(
      { id: 'E-007', kind: 'stuck', reason: 'repeated_error', source: 'plugin', status: 'open', question: 'Which provider?', options: ['Stripe', 'YooKassa'], recommended: 'Stripe', created_at: at },
      { problem: 'Payments fail.', tried: 'Two mocks.', optionNotes: { YooKassa: 'needed for Russian cards' } },
    );
    expect(text).toContain('## Problem\n\nPayments fail.');
    expect(text).toContain('## Tried\n\nTwo mocks.');
    expect(text).toContain('1. Stripe (recommended)');
    expect(text).toContain('2. YooKassa — needed for Russian cards');
    expect(validateCrewFile('.crew/escalations/E-007.md', text)?.issues).toEqual([]);
    expect(readEscalation(text, 'E-007.md').value.options).toEqual(['Stripe', 'YooKassa']);
  });

  it('decision, status, manifest and session marker', () => {
    expect(validateCrewFile('.crew/decisions/ADR-009-x.md', renderDecision({ id: 'ADR-009', title: 'X', status: 'accepted', date: '2026-09-29', source: 'E-001' }, ''))?.ok).toBe(true);
    expect(validateCrewFile('.crew/status.md', renderStatus({ phase: 'tasks', updated_at: at, summary: 'Busy.' }, '# Status\n'))?.ok).toBe(true);
    expect(validateCrewFile('.crew/crew.json', renderManifest({ contract_version: 1, plugin: { name: 'agent-crew', version: '0.1.0' }, stack_profile: 'tanstack', created_at: at }))?.ok).toBe(true);
    expect(validateCrewFile('.crew/sessions/abc.json', renderSessionMarker({ session_id: 'abc', command: 'agent-crew:new-project', started_at: at, assistant: 'claude-code' }))?.ok).toBe(true);
  });
});

describe('lifecycle changes', () => {
  const open = renderEscalation({ id: 'E-001', kind: 'question', source: 'plugin', status: 'open', question: 'DB?', options: ['Postgres', 'SQLite'], created_at: at });

  it('host answers, plugin resolves with an ADR', () => {
    const answered = answerEscalation(open, { text: 'Postgres', by: 'human', at });
    expect(readEscalation(answered, 'E-001.md').value).toMatchObject({ status: 'answered', answer: 'Postgres', answered_by: 'human', answered_at: at });
    expect(answered.match(/## Answer/g)).toHaveLength(1);
    const again = answerEscalation(answered, { text: 'SQLite', by: 'human', at });
    expect(again.match(/## Answer/g)).toHaveLength(1);
    const resolved = resolveEscalation(answered, 'ADR-002');
    expect(validateCrewFile('.crew/escalations/E-001.md', resolved)?.issues).toEqual([]);
    expect(parseFrontmatter(resolveEscalation(answered)).data.decision).toBeUndefined();
    expect(parseFrontmatter(cancelEscalation(open)).data.status).toBe('cancelled');
  });

  it('host marks the session stopped with a note', () => {
    const status = renderStatus({ phase: 'tasks', updated_at: at }, '# Status\n\nWorking.\n');
    const stopped = markStopped(status, { reason: 'budget_cap', at, note: 'Stopped: budget cap reached\n($20 of $20).' });
    expect(readStatus(stopped).value).toMatchObject({ phase: 'stopped', stop_reason: 'budget_cap' });
    expect(stopped.trimEnd().endsWith('> Stopped: budget cap reached ($20 of $20).')).toBe(true);
    expect(validateCrewFile('.crew/status.md', stopped)?.ok).toBe(true);
    expect(markStopped(status, { reason: 'user', at })).not.toContain('>');
  });
});
