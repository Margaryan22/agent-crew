import { describe, expect, it } from 'vitest';
import { BriefSchema, EscalationSchema, formatIssues, StatusSchema, TaskSchema } from '../src/schemas';

const baseTask = {
  id: 'T-001',
  title: 'Task',
  status: 'todo',
  owner: 'frontend',
  attempts: 0,
  created_at: '2026-09-29T10:00:00Z',
  updated_at: '2026-09-29T10:00:00Z',
};

const baseEscalation = {
  id: 'E-001',
  kind: 'question',
  source: 'plugin',
  status: 'open',
  question: 'Which database?',
  options: ['Postgres', 'SQLite'],
  created_at: '2026-09-29T10:00:00Z',
};

function issues(schema: { safeParse(v: unknown): { success: boolean; error?: unknown } }, value: unknown): string[] {
  const r = schema.safeParse(value) as { success: boolean; error?: Parameters<typeof formatIssues>[0] };
  return r.success ? [] : formatIssues(r.error!);
}

describe('TaskSchema', () => {
  it('accepts a minimal task and keeps unknown keys', () => {
    const parsed = TaskSchema.parse({ ...baseTask, custom: 'x' });
    expect(parsed.custom).toBe('x');
  });

  it.each([
    [{ ...baseTask, id: 'task-1' }, 'id: expected an id like T-001'],
    [{ ...baseTask, owner: 'Frontend Dev' }, 'owner: expected a kebab-case agent name'],
    [{ ...baseTask, status: 'wip' }, 'status:'],
    [{ ...baseTask, attempts: -1 }, 'attempts:'],
    [{ ...baseTask, review_stage: 'qa' }, 'review_stage is only allowed with status: review'],
    [{ ...baseTask, escalation: 'E-001' }, 'escalation is only allowed with status: blocked'],
    [{ ...baseTask, depends_on: ['T-001'] }, 'a task cannot depend on itself'],
    [{ ...baseTask, created_at: '29.09.2026' }, 'created_at:'],
    [{ ...baseTask, last_error_hash: 'XYZ' }, 'last_error_hash:'],
  ])('rejects %o', (value, message) => {
    expect(issues(TaskSchema, value).join('\n')).toContain(message);
  });
});

describe('EscalationSchema', () => {
  it('accepts an open question and a fully answered, resolved stuck escalation', () => {
    expect(issues(EscalationSchema, baseEscalation)).toEqual([]);
    expect(
      issues(EscalationSchema, {
        ...baseEscalation,
        kind: 'stuck',
        reason: 'repeated_error',
        status: 'resolved',
        recommended: 'Postgres',
        answer: 'Postgres',
        answered_at: '2026-09-29T11:00:00Z',
        answered_by: 'human',
        decision: 'ADR-003',
      }),
    ).toEqual([]);
    // Host-created permission escalations resolve without an ADR.
    expect(
      issues(EscalationSchema, { ...baseEscalation, kind: 'permission', source: 'host', status: 'resolved', answer: 'Allow', answered_at: '2026-09-29T11:00:00Z', answered_by: 'human' }),
    ).toEqual([]);
  });

  it.each([
    [{ ...baseEscalation, kind: 'stuck' }, 'reason is required when kind is stuck'],
    [{ ...baseEscalation, reason: 'repeated_error' }, 'reason is only allowed when kind is stuck'],
    [{ ...baseEscalation, recommended: 'MySQL' }, 'recommended must be one of options'],
    [{ ...baseEscalation, status: 'answered' }, 'answer is required once the escalation is answered'],
    [{ ...baseEscalation, status: 'resolved', answer: 'x', answered_at: '2026-09-29T11:00:00Z', answered_by: 'human' }, 'must reference the ADR it produced'],
    [{ ...baseEscalation, decision: 'ADR-001' }, 'decision is only set when the escalation is resolved'],
    [{ ...baseEscalation, question: 'line one\nline two' }, 'must be a single line'],
    [{ ...baseEscalation, options: [] }, 'options:'],
    [{ ...baseEscalation, options: ['a', 'b', 'c', 'd', 'e'] }, 'options:'],
  ])('rejects %o', (value, message) => {
    expect(issues(EscalationSchema, value).join('\n')).toContain(message);
  });
});

describe('Status and brief rules', () => {
  it('requires stop_reason when stopped and approved_at when approved', () => {
    expect(issues(StatusSchema, { phase: 'stopped', updated_at: '2026-09-29T10:00:00Z' }).join()).toContain('stop_reason is required');
    expect(issues(StatusSchema, { phase: 'stopped', stop_reason: 'budget_cap', updated_at: '2026-09-29T10:00:00Z' })).toEqual([]);
    expect(issues(BriefSchema, { version: 1, status: 'approved', review_rounds: 1 }).join()).toContain('approved_at is required');
  });
});
