import { describe, expect, it } from 'vitest';
import { normalizeEscalationKind, normalizeKey, normalizeTaskStatus, parseInlineFields, readDecision, readEscalation, readStatus, readTask, truncate } from '../src/lenient';

describe('readTask', () => {
  it('reads the extension v0.1 format (assignee) and reports what a strict writer would fix', () => {
    const { value, issues } = readTask(
      '---\nid: T-007\ntitle: Checkout\nstatus: in-progress\nassignee: frontend\nattempts: 2\nbranch: crew/T-007\nbase: main\nfiles:\n  - src/checkout.tsx\nbudget_usd: 3\n---\nBody',
      '.crew/tasks/T-007.md',
    );
    expect(value).toMatchObject({ id: 'T-007', title: 'Checkout', status: 'in_progress', owner: 'frontend', attempts: 2, branch: 'crew/T-007', base: 'main', files: ['src/checkout.tsx'], budget_usd: 3 });
    expect(issues.join('\n')).toContain('owner:');
    expect(issues.join('\n')).toContain('created_at:');
  });

  it('falls back to inline Russian fields, the heading and the file name', () => {
    const { value, issues } = readTask('# T-003: Роутинг\n\nСтатус: в работе\nИсполнитель: architect\nПопытки: 3\nФайлы: a.ts, b.ts\n', '.crew/tasks/T-003.md');
    expect(value).toMatchObject({ id: 'T-003', title: 'Роутинг', status: 'in_progress', owner: 'architect', attempts: 3, files: ['a.ts', 'b.ts'] });
    expect(issues).toEqual(['missing YAML frontmatter']);
    const bare = readTask('---\nattempts: many\n---\n', 'tasks/T-9.md').value;
    expect(bare).toMatchObject({ id: 'T-009', title: 'T-009', status: 'todo', owner: 'unassigned', attempts: 0 });
  });

  it.each([
    ['Backlog', 'todo'],
    ['WIP', 'in_progress'],
    ['на ревью', 'review'],
    ['completed', 'done'],
    ['Готово', 'done'],
    ['failed', 'blocked'],
    ['whatever', 'todo'],
    [undefined, 'todo'],
  ])('normalizeTaskStatus(%s) = %s', (raw, expected) => {
    expect(normalizeTaskStatus(raw)).toBe(expected);
  });
});

describe('readEscalation', () => {
  it('reads plugin-written sections, options with recommendation and an answer section', () => {
    const { value } = readEscalation(
      '# E-010 — Payment provider\n\n## Что застряло\n\nStripe or YooKassa?\n\n## Варианты\n\n1. **Stripe** (recommended)\n2. YooKassa\n- [ ] Later\n\n## Ответ\n\nStripe',
      '.crew/escalations/E-010.md',
    );
    expect(value).toMatchObject({ id: 'E-010', title: 'Payment provider', question: 'Stripe or YooKassa?', options: ['Stripe', 'YooKassa', 'Later'], status: 'answered', answer: 'Stripe', kind: 'question', source: 'plugin' });
  });

  it('maps status, kind and source aliases and keeps optional fields', () => {
    const { value } = readEscalation(
      '---\nstatus: closed\ntype: approval\nsource: host\nfrom: backend\nзадача: T-001\nreason: repeated_error\nrecommendation: Allow\nanswered_by: auto\ndecision: ADR-004\n---\nQ?',
      'E-5.md',
    );
    expect(value).toMatchObject({ id: 'E-005', status: 'resolved', kind: 'permission', source: 'host', agent: 'backend', task: 'T-001', reason: 'repeated_error', recommended: 'Allow', answered_by: 'auto', decision: 'ADR-004' });
    expect(readEscalation('---\nstatus: weird\n---\nQ?', 'E-3.md').value.status).toBe('open');
    expect(readEscalation('', 'E-4.md').value).toMatchObject({ id: 'E-004', question: 'E-004', title: 'E-004' });
  });

  it.each([
    ['approval', 'permission'],
    ['brief', 'brief-review'],
    ['blocked', 'stuck'],
    ['credentials', 'access'],
    [undefined, 'question'],
  ])('normalizeEscalationKind(%s) = %s', (raw, expected) => {
    expect(normalizeEscalationKind(raw)).toBe(expected);
  });
});

describe('readDecision and readStatus', () => {
  it('reads ADRs with and without frontmatter', () => {
    expect(readDecision('---\nstatus: accepted\ndate: "2026-09-29"\nsource: E-001\nsupersedes: ADR-000\n---\n# ADR-003: Use Drizzle\n', '.crew/decisions/ADR-003-drizzle.md').value).toEqual({
      id: 'ADR-003',
      title: 'Use Drizzle',
      status: 'accepted',
      date: '2026-09-29',
      source: 'E-001',
      supersedes: 'ADR-000',
      path: '.crew/decisions/ADR-003-drizzle.md',
    });
    expect(readDecision('Status: Proposed\n', 'decisions/adr-002-auth_strategy.md').value).toMatchObject({ id: 'ADR-002', title: 'auth strategy', status: 'proposed' });
    expect(readDecision('', 'notes.md').value).toMatchObject({ id: 'notes', title: 'notes', status: 'proposed' });
  });

  it('reads status phase, stop reason, active tasks and summary', () => {
    expect(readStatus('---\nphase: stopped\nstop_reason: budget_cap\nupdated_at: "2026-09-29T10:00:00Z"\nactive_tasks: [T-001]\n---\n# Status\n\nOut of budget.\n').value).toEqual({
      phase: 'stopped',
      stop_reason: 'budget_cap',
      updated_at: '2026-09-29T10:00:00Z',
      active_tasks: ['T-001'],
      summary: 'Out of budget.',
    });
    expect(readStatus('# Status\nФаза: acceptance tests\n\nAlmost done.').value).toEqual({ phase: 'acceptance_tests', summary: 'Almost done.' });
    expect(readStatus('').value).toEqual({});
  });
});

describe('helpers', () => {
  it('normalizeKey, parseInlineFields and truncate', () => {
    expect(normalizeKey('Base Branch')).toBe('base_branch');
    expect(normalizeKey('Статус')).toBe('status');
    expect(parseInlineFields('**Status:** WIP\n- **Owner**: qa\n\n## Details\nOwner: nobody')).toEqual({ Status: 'WIP', Owner: 'qa' });
    expect(truncate('a  b\nc', 10)).toBe('a b c');
    expect(truncate('abcdefghijk', 5)).toBe('abcd…');
  });
});
