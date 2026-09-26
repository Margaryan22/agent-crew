import { describe, expect, it } from 'vitest';
import {
  appendStatusNote,
  applyEscalationAnswer,
  formatCostEntry,
  nextEscalationId,
  normalizeKey,
  normalizeTaskStatus,
  parseCostLine,
  parseCostsLog,
  parseDecision,
  parseEscalation,
  parseFrontmatter,
  parseInlineFields,
  parseScalar,
  parseStatus,
  parseTask,
  projectSpentUsd,
  renderEscalationFile,
  section,
  sessionTotalUsd,
  setFrontmatterFields,
  truncate,
} from '../../src/crew/parser';

describe('parseFrontmatter', () => {
  it('parses scalars, quoted strings, lists and block scalars', () => {
    const text = [
      '---',
      'id: T-001',
      'title: "Login: form & validation"',
      "quote: 'it''s fine'",
      'attempts: 2',
      'ratio: 0.5',
      'draft: false',
      'done: true',
      'nothing: ~',
      'empty:',
      'files: [src/a.ts, "src/b, c.ts"]',
      'tags:',
      '  - one',
      '  - "two"',
      'notes: |',
      '  line one',
      '  line two',
      'folded: >',
      '  a',
      '  b',
      'comment: value # trailing comment',
      '  indented: ignored',
      '---',
      '',
      '# Heading',
    ].join('\n');
    const fm = parseFrontmatter(text);
    expect(fm.hasFrontmatter).toBe(true);
    expect(fm.data).toMatchObject({
      id: 'T-001',
      title: 'Login: form & validation',
      quote: "it's fine",
      attempts: 2,
      ratio: 0.5,
      draft: false,
      done: true,
      nothing: null,
      empty: null,
      files: ['src/a.ts', 'src/b, c.ts'],
      tags: ['one', 'two'],
      notes: 'line one\nline two',
      folded: 'a b',
      comment: 'value',
    });
    expect(fm.data.indented).toBeUndefined();
    expect(fm.body).toBe('# Heading');
  });

  it('handles CRLF, BOM and missing/closing markers', () => {
    expect(parseFrontmatter('\uFEFF---\r\nid: X\r\n---\r\nbody').data.id).toBe('X');
    const unterminated = parseFrontmatter('---\nid: X\nbody');
    expect(unterminated.hasFrontmatter).toBe(false);
    expect(unterminated.body).toBe('---\nid: X\nbody');
    expect(parseFrontmatter('no frontmatter').hasFrontmatter).toBe(false);
    expect(parseFrontmatter('---\nid: Y\n...\nrest').data.id).toBe('Y');
  });

  it('parseScalar falls back for broken JSON strings', () => {
    expect(parseScalar('"unterminated \\"')).toBe('unterminated \\');
    expect(parseScalar('null')).toBeNull();
    expect(parseScalar('-3')).toBe(-3);
  });
});

describe('inline fields', () => {
  it('reads bold and plain key/value lines at the top of the body', () => {
    const body = ['# Task', '**Status:** In Progress', '- **Assignee**: backend', 'Attempts: 3', '', '## Details', 'Owner: nobody'].join('\n');
    expect(parseInlineFields(body)).toMatchObject({ status: 'In Progress', assignee: 'backend', attempts: '3' });
    expect(parseInlineFields(body).assignee).toBe('backend');
  });

  it('normalizes key aliases, including Russian ones', () => {
    expect(normalizeKey('Исполнитель')).toBe('assignee');
    expect(normalizeKey('Base Branch')).toBe('base');
    expect(normalizeKey('custom-key')).toBe('custom_key');
  });
});

describe('parseTask', () => {
  it('parses a task with frontmatter', () => {
    const task = parseTask(
      ['---', 'id: T-007', 'title: Checkout page', 'status: in-progress', 'assignee: frontend', 'attempts: 2', 'branch: crew/T-007', 'base: main', 'files:', '  - src/routes/checkout.tsx', '---', 'Body'].join('\n'),
      '.crew/tasks/T-007.md',
    );
    expect(task).toEqual({
      id: 'T-007',
      title: 'Checkout page',
      status: 'in_progress',
      assignee: 'frontend',
      attempts: 2,
      branch: 'crew/T-007',
      base: 'main',
      files: ['src/routes/checkout.tsx'],
      path: '.crew/tasks/T-007.md',
    });
  });

  it('falls back to the file name, heading and inline fields', () => {
    const task = parseTask('# T-003: Set up routing\n\nStatus: done\nОтветственный: x\nИсполнитель: architect\nFiles: a.ts, b.ts\n', '.crew/tasks/T-003.md');
    expect(task).toMatchObject({ id: 'T-003', title: 'Set up routing', status: 'done', assignee: 'architect', attempts: 0, files: ['a.ts', 'b.ts'] });
  });

  it('uses the id as title when nothing else is available and ignores bad attempts', () => {
    const task = parseTask('---\nattempts: many\n---\n', 'tasks/T-9.md');
    expect(task.title).toBe('T-9');
    expect(task.attempts).toBe(0);
    expect(task.status).toBe('todo');
  });
});

describe('normalizeTaskStatus', () => {
  it.each([
    ['todo', 'todo'],
    ['Backlog', 'todo'],
    ['in progress', 'in_progress'],
    ['WIP', 'in_progress'],
    ['в работе', 'in_progress'],
    ['In Review', 'review'],
    ['completed', 'done'],
    ['Готово', 'done'],
    ['failed', 'blocked'],
    ['whatever', 'todo'],
    [undefined, 'todo'],
  ])('%s → %s', (raw, expected) => {
    expect(normalizeTaskStatus(raw)).toBe(expected);
  });
});

describe('parseEscalation', () => {
  it('parses frontmatter options and sections', () => {
    const esc = parseEscalation(
      [
        '---',
        'id: E-002',
        'task: T-004',
        'agent: backend',
        'kind: question',
        'created_at: 2026-09-26T10:00:00Z',
        'options: ["Postgres", "SQLite"]',
        '---',
        '# Which database?',
        '',
        '## Question',
        '',
        'We need persistence. Which database should we use?',
      ].join('\n'),
      '.crew/escalations/E-002.md',
    );
    expect(esc).toMatchObject({
      id: 'E-002',
      title: 'Which database?',
      question: 'We need persistence. Which database should we use?',
      options: ['Postgres', 'SQLite'],
      status: 'open',
      kind: 'question',
      task: 'T-004',
      agent: 'backend',
      createdAt: '2026-09-26T10:00:00Z',
    });
  });

  it('reads options from a list section and an answer section', () => {
    const esc = parseEscalation(
      ['# E-010 — Payment provider', '', 'Stripe or Paddle?', '', '## Варианты', '1. **Stripe**', '2. Paddle', '- [ ] Later', '', '## Ответ', '', 'Stripe'].join('\n'),
      '.crew/escalations/E-010.md',
    );
    expect(esc.options).toEqual(['Stripe', 'Paddle', 'Later']);
    expect(esc.answer).toBe('Stripe');
    expect(esc.status).toBe('answered');
    expect(esc.title).toBe('Payment provider');
    expect(esc.question).toBe('Stripe or Paddle?');
  });

  it('maps status and kind aliases', () => {
    expect(parseEscalation('---\nstatus: closed\nkind: approval\n---\nQ?', 'E-1.md')).toMatchObject({ status: 'resolved', kind: 'permission' });
    expect(parseEscalation('---\nstatus: canceled\ntype: brief\n---\nQ?', 'E-2.md')).toMatchObject({ status: 'cancelled', kind: 'brief-review' });
    expect(parseEscalation('---\nstatus: weird\n---\nQ?', 'E-3.md').status).toBe('open');
    expect(parseEscalation('', 'E-4.md')).toMatchObject({ id: 'E-4', question: 'E-4', title: 'E-4' });
  });

  it('allocates the next id', () => {
    expect(nextEscalationId(['E-001', 'E-009', 'X-100', 'e-010-extra'])).toBe('E-011');
    expect(nextEscalationId([])).toBe('E-001');
  });
});

describe('parseDecision', () => {
  it('parses ADR files', () => {
    expect(parseDecision('---\nstatus: accepted\n---\n# ADR-001: Use TanStack Start\n', '.crew/decisions/ADR-001-tanstack.md')).toEqual({
      id: 'ADR-001',
      title: 'Use TanStack Start',
      status: 'accepted',
      path: '.crew/decisions/ADR-001-tanstack.md',
    });
    expect(parseDecision('Status: proposed\n', '.crew/decisions/adr-002-auth_strategy.md')).toMatchObject({ id: 'ADR-002', title: 'auth strategy', status: 'proposed' });
    expect(parseDecision('', 'notes.md')).toMatchObject({ id: 'notes', title: 'notes' });
  });
});

describe('parseStatus', () => {
  it('reads phase and summary', () => {
    expect(parseStatus('---\nphase: build\n---\n# Status\n\nThree tasks in progress.\n')).toEqual({ phase: 'build', summary: 'Three tasks in progress.' });
    expect(parseStatus('# Status\nФаза: review\n\nAlmost done.')).toEqual({ phase: 'review', summary: 'Almost done.' });
    expect(parseStatus('')).toEqual({});
  });
});

describe('section', () => {
  it('stops at the next heading of the same level and ignores empty sections', () => {
    const body = '## A\n\none\n### nested\nstill A\n## B\n\n## C\ntext';
    expect(section(body, ['A'])).toBe('one\n### nested\nstill A');
    expect(section(body, ['B'])).toBeUndefined();
    expect(section(body, ['missing'])).toBeUndefined();
  });
});

describe('costs.log', () => {
  it('parses key=value, JSON and loose lines', () => {
    const log = [
      '# comment',
      '2026-09-26T10:00:00Z session=s1 turn_cost_usd=0.5 session_total_usd=0.5 source=sdk',
      '2026-09-26T10:05:00Z session=s1 turn_cost_usd=0.25 session_total_usd=0.75 source=sdk',
      '{"ts":"2026-09-26T11:00:00Z","session_id":"s2","total_cost_usd":1.5}',
      '2026-09-26T12:00:00Z $0.10',
      '2026-09-26T12:00:00Z session=s3 cost=0.2',
      '2026-09-26T12:00:00Z session=s3 cost=0.3',
      '{broken json',
      'no numbers here',
      '',
    ].join('\n');
    const entries = parseCostsLog(log);
    expect(entries).toHaveLength(6);
    expect(entries[0]).toEqual({ timestamp: '2026-09-26T10:00:00Z', sessionId: 's1', costUsd: 0.5, sessionTotalUsd: 0.5, source: 'sdk' });
    expect(entries[2]).toMatchObject({ timestamp: '2026-09-26T11:00:00Z', sessionId: 's2', sessionTotalUsd: 1.5 });
    expect(entries[3]).toMatchObject({ costUsd: 0.1 });
    // s1 max total 0.75 + s2 1.5 + loose 0.10 + s3 deltas 0.5
    expect(projectSpentUsd(entries)).toBeCloseTo(2.85);
    expect(projectSpentUsd(entries, 's2')).toBeCloseTo(1.35);
    expect(sessionTotalUsd(entries, 's1')).toBe(0.75);
    expect(sessionTotalUsd(entries, 'nope')).toBe(0);
  });

  it('counts a total-only entry without a session and ignores negatives', () => {
    expect(projectSpentUsd([{ timestamp: '', sessionTotalUsd: 2 }])).toBe(2);
    expect(parseCostLine('2026-01-01 session=x cost=-1')).toBeUndefined();
  });

  it('round-trips formatted entries', () => {
    const line = formatCostEntry({ timestamp: '2026-09-26T10:00:00.000Z', sessionId: 'abc', costUsd: 0.1234567, sessionTotalUsd: 1.5, source: 'sdk' });
    expect(line).toBe('2026-09-26T10:00:00.000Z session=abc turn_cost_usd=0.123457 session_total_usd=1.500000 source=sdk');
    expect(parseCostLine(line)).toMatchObject({ sessionId: 'abc', sessionTotalUsd: 1.5 });
    expect(formatCostEntry({ timestamp: 't', costUsd: 1 })).toBe('t turn_cost_usd=1.000000');
  });
});

describe('writers', () => {
  it('setFrontmatterFields replaces, appends and creates frontmatter', () => {
    const text = '---\nid: E-1\nstatus: open\noptions:\n  - A\n  - B\n---\n# Title\n';
    const updated = setFrontmatterFields(text, { status: 'answered', options: ['C'], answer: 'Use: C', count: 2 });
    expect(parseFrontmatter(updated).data).toMatchObject({ id: 'E-1', status: 'answered', options: ['C'], answer: 'Use: C', count: 2 });
    expect(updated).toContain('# Title');
    const created = setFrontmatterFields('Just text', { status: 'open', flag: true });
    expect(created.startsWith('---\nstatus: open\nflag: true\n---\n\nJust text')).toBe(true);
    expect(setFrontmatterFields('---\na: 1\n---\n', { b: 'true' })).toContain('b: "true"');
  });

  it('applyEscalationAnswer records the answer once', () => {
    const answered = applyEscalationAnswer('---\nid: E-1\nstatus: open\n---\n# Q\n\nWhich?\n', 'Postgres', '2026-09-26T10:00:00Z');
    const parsed = parseEscalation(answered, 'E-1.md');
    expect(parsed).toMatchObject({ status: 'answered', answer: 'Postgres' });
    expect(answered).toContain('## Answer\n\nPostgres');
    const again = applyEscalationAnswer(answered, 'SQLite', '2026-09-26T11:00:00Z');
    expect(again.match(/## Answer/g)).toHaveLength(1);
    expect(parseEscalation(again, 'E-1.md').answer).toBe('SQLite');
  });

  it('renderEscalationFile produces a parseable file', () => {
    const text = renderEscalationFile({
      id: 'E-005',
      title: 'Permission for Bash',
      question: 'lead wants to run npm install',
      options: ['Allow', 'Deny'],
      status: 'open',
      kind: 'permission',
      agent: 'lead',
      task: 'T-001',
      createdAt: '2026-09-26T10:00:00Z',
      answer: 'Allow',
    });
    expect(parseEscalation(text, '.crew/escalations/E-005.md')).toMatchObject({
      id: 'E-005',
      title: 'Permission for Bash',
      question: 'lead wants to run npm install',
      options: ['Allow', 'Deny'],
      kind: 'permission',
      agent: 'lead',
      task: 'T-001',
      answer: 'Allow',
    });
    const minimal = renderEscalationFile({ id: 'E-6', title: 'T', question: 'Q', options: [], status: 'open', kind: 'question' });
    expect(minimal).not.toContain('## Options');
  });

  it('appendStatusNote and truncate', () => {
    expect(appendStatusNote('# Status\n\n', 'stopped')).toBe('# Status\n\n> stopped\n');
    expect(appendStatusNote('', 'x')).toBe('> x\n');
    expect(truncate('a  b\nc', 10)).toBe('a b c');
    expect(truncate('abcdefghijk', 5)).toBe('abcd…');
  });
});
