import { mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import {
  artefactKind,
  CONFIG_DEFAULTS,
  decisionPath,
  escalationPath,
  estimatedTokens,
  formatCostEntry,
  formatId,
  idFromFileName,
  nextId,
  parseChecklist,
  parseCostsLog,
  parseInterview,
  projectSpentUsd,
  renderInterview,
  resolveCrewConfig,
  sessionMarkerPath,
  sessionTotalUsd,
  slugify,
  taskEstimates,
  taskPath,
  validateCrewFile,
} from '../src/index';
import { appendJsonLine, createWithNextId, writeFileAtomic } from '../src/node';

describe('ids and paths', () => {
  it('allocates and parses ids', () => {
    expect(nextId('escalation', ['E-001', 'E-009', 'X-100', 'e-010-extra'])).toBe('E-011');
    expect(nextId('task', [])).toBe('T-001');
    expect(nextId('decision', ['ADR-002-x.md'])).toBe('ADR-003');
    expect(idFromFileName('decision', 'ADR-7-db.md')).toBe('ADR-007');
    expect(idFromFileName('task', 'notes.md')).toBeUndefined();
    expect(formatId('task', 1234)).toBe('T-1234');
  });

  it('builds paths', () => {
    expect(taskPath('T-001')).toBe('.crew/tasks/T-001.md');
    expect(escalationPath('E-001')).toBe('.crew/escalations/E-001.md');
    expect(decisionPath('ADR-001', 'Use TanStack Start!')).toBe('.crew/decisions/ADR-001-use-tanstack-start.md');
    expect(decisionPath('ADR-002', 'Рус')).toBe('.crew/decisions/ADR-002.md');
    expect(sessionMarkerPath('a/b c')).toBe('.crew/sessions/a_b_c.json');
    expect(slugify('  Hello,   World  ', 5)).toBe('hello');
  });
});

describe('validateCrewFile', () => {
  it('classifies paths', () => {
    expect(artefactKind('src/a.ts')).toBeUndefined();
    expect(artefactKind('./.crew/tasks/T-1.md')).toBe('task');
    expect(artefactKind('.crew\\escalations\\E-1.md')).toBe('escalation');
    expect(artefactKind('.crew/report.md')).toBe('free-text');
    expect(validateCrewFile('src/a.ts', '')).toBeUndefined();
    expect(validateCrewFile('.crew/report.md', 'anything')?.ok).toBe(true);
  });

  it('reports missing frontmatter, id/file mismatches and bad JSON', () => {
    expect(validateCrewFile('.crew/tasks/T-001.md', '# no frontmatter')?.issues).toEqual(['missing YAML frontmatter (--- … ---) at the top of the file']);
    const task = '---\nid: T-002\ntitle: t\nstatus: todo\nowner: qa\nattempts: 0\ncreated_at: "2026-09-29T10:00:00Z"\nupdated_at: "2026-09-29T10:00:00Z"\n---\n';
    expect(validateCrewFile('.crew/tasks/T-001.md', task)?.issues).toEqual(['id "T-002" does not match the file name (T-001)']);
    expect(validateCrewFile('.crew/tasks/login.md', task)?.issues.join()).toContain('file name must start with the task id');
    expect(validateCrewFile('.crew/crew.json', '{')?.issues).toEqual(['not valid JSON']);
    expect(validateCrewFile('.crew/sessions/x.json', '{}')?.ok).toBe(false);
    // Object-level rules run once every field is valid.
    expect(validateCrewFile('.crew/costs.log', '{"ts":"2026-09-29T11:00:00Z","source":"sdk"}')?.issues).toEqual(['line 1: a cost entry needs turn_cost_usd, session_total_usd or tokens']);
    expect(validateCrewFile('.crew/costs.log', '# comment\n{"ts":"x"}\nnope')?.issues).toEqual([
      'line 2: ts: Invalid ISO datetime',
      'line 2: source: Invalid option: expected one of "sdk"|"headless"|"estimate"|"manual"',
      'line 3: not valid JSON',
    ]);
  });
});

describe('costs.log', () => {
  const log = [
    '# comment',
    '2026-09-29T10:00:00.000Z session=s1 turn_cost_usd=0.500000 session_total_usd=0.500000 source=sdk',
    '2026-09-29T10:05:00.000Z session=s1 turn_cost_usd=0.250000 session_total_usd=0.750000 source=sdk',
    '{"ts":"2026-09-29T11:00:00Z","source":"headless","session_id":"s2","session_total_usd":1.5}',
    '{"ts":"2026-09-29T11:00:00Z","source":"headless","session_id":"s3","turn_cost_usd":0.2}',
    '{"ts":"2026-09-29T11:00:00Z","source":"headless","session_id":"s3","turn_cost_usd":0.3}',
    '{"ts":"2026-09-29T11:00:00Z","source":"manual","turn_cost_usd":0.1}',
    '{"ts":"2026-09-29T11:00:00Z","source":"estimate","task":"T-001","turn_cost_usd":9,"tokens":{"input":100,"output":50,"cache_read":10}}',
    '{"ts":"2026-09-29T11:00:00Z","source":"estimate","task":"T-001","tokens":{"input":1,"output":1}}',
    '{"ts":"2026-09-29T11:00:00Z","source":"headless","turn_cost_usd":0.4}',
    '{broken',
    'garbage line',
    '{"ts":"2026-09-29T11:00:00Z","source":"sdk"}',
  ].join('\n');

  it('parses JSONL and legacy lines and reports bad ones', () => {
    const { entries, issues } = parseCostsLog(log);
    expect(entries).toHaveLength(9);
    expect(entries[0]).toEqual({ ts: '2026-09-29T10:00:00.000Z', session_id: 's1', turn_cost_usd: 0.5, session_total_usd: 0.5, source: 'sdk' });
    expect(issues.map((i) => i.line)).toEqual([11, 12, 13]);
  });

  it('sums authoritative spend only, per-session max, and estimates separately', () => {
    const { entries } = parseCostsLog(log);
    // s1 0.75 + s2 1.5 + s3 0.5 + loose headless 0.4
    expect(projectSpentUsd(entries)).toBeCloseTo(3.15);
    expect(projectSpentUsd(entries, { excludeSession: 's2' })).toBeCloseTo(1.65);
    expect(projectSpentUsd(entries, { sources: ['manual'] })).toBeCloseTo(0.1);
    expect(sessionTotalUsd(entries, 's1')).toBe(0.75);
    expect(sessionTotalUsd(entries, 'nope')).toBe(0);
    expect(taskEstimates(entries).get('T-001')).toEqual({ tokens: 162, usd: 9 });
    expect(estimatedTokens(entries)).toBe(162);
  });

  it('formats entries as validated JSON lines', () => {
    expect(formatCostEntry({ ts: '2026-09-29T11:00:00Z', source: 'headless', session_total_usd: 1 })).toBe('{"ts":"2026-09-29T11:00:00Z","source":"headless","session_total_usd":1}');
    expect(() => formatCostEntry({ ts: 'x', source: 'sdk' } as never)).toThrow();
  });
});

describe('resolveCrewConfig', () => {
  it('uses defaults when nothing is set', () => {
    expect(resolveCrewConfig({})).toEqual({
      config: CONFIG_DEFAULTS,
      sources: { autonomy: 'default', briefReviewMinutes: 'default', budgetCapUsd: 'default', stackProfile: 'default', modelTier: 'default', reviewDepth: 'default', parallelTasks: 'default', host: 'default' },
      issues: [],
    });
  });

  it('prefers CREW_* over userConfig over EVAL_CREW_* and reports invalid values', () => {
    const { config, sources, issues } = resolveCrewConfig({
      CREW_AUTONOMY: 'review',
      CLAUDE_PLUGIN_OPTION_AUTONOMY: 'full',
      CLAUDE_PLUGIN_OPTION_BUDGET_CAP_USD: '7',
      EVAL_CREW_BRIEF_REVIEW_MINUTES: '3',
      CREW_STACK_PROFILE: 'nextjs',
      CREW_HOST: 'eval',
    });
    expect(config).toEqual({ autonomy: 'review', briefReviewMinutes: 3, budgetCapUsd: 7, stackProfile: 'auto', modelTier: 'balanced', reviewDepth: 'every-task', parallelTasks: 'same-folder', host: 'eval' });
    expect(resolveCrewConfig({ CLAUDE_PLUGIN_OPTION_MODEL_TIER: 'economy', CLAUDE_PLUGIN_OPTION_REVIEW_DEPTH: 'qa-only' }).config).toMatchObject({ modelTier: 'economy', reviewDepth: 'qa-only' });
    expect(resolveCrewConfig({ CREW_MODEL_TIER: 'turbo' }).issues[0]).toContain('model_tier');
    expect(sources).toMatchObject({ autonomy: 'env', budgetCapUsd: 'userConfig', briefReviewMinutes: 'eval', stackProfile: 'default', host: 'env' });
    expect(issues).toEqual(['Ignoring invalid stack_profile "nextjs" from env; using auto.']);
    expect(resolveCrewConfig({ CLAUDE_PLUGIN_OPTION_STACK_PROFILE: 'tanstack' }).config.stackProfile).toBe('tanstack');
    // No spending cap unless the user sets one: on a subscription the plan's limits apply.
    expect(CONFIG_DEFAULTS.budgetCapUsd).toBe(0);
    expect(resolveCrewConfig({ CREW_BUDGET_CAP_USD: '-1' }).issues[0]).toContain('budget_cap_usd');
  });

  it('detects eval hosts and rejects unknown ones', () => {
    expect(resolveCrewConfig({ CREW_EVAL: '1' }).config.host).toBe('eval');
    expect(resolveCrewConfig({ EVAL_CREW: '1' }).sources.host).toBe('eval');
    expect(resolveCrewConfig({ CREW_HOST: 'robot' }).issues).toEqual(['Ignoring unknown CREW_HOST "robot".']);
  });
});

describe('checklist and interview', () => {
  it('parses access-checklist items with notes', () => {
    expect(parseChecklist('---\na: 1\n---\n- [x] Domain — for the site\n- [ ] Stripe key - payments\n* [X] Logo\n- not a checkbox')).toEqual([
      { done: true, text: 'Domain', note: 'for the site' },
      { done: false, text: 'Stripe key', note: 'payments' },
      { done: true, text: 'Logo' },
    ]);
  });

  it('parses and renders interview Q/A blocks', () => {
    const md = '# Interview\n\nintro\n### Q: Who uses it?\nA: Clients\nand the owner.\n\n### Вопрос: Отчёты?\nОтвет: Дневной.\n### Q: Integrations?\n';
    const pairs = parseInterview(md);
    expect(pairs).toEqual([{ question: 'Who uses it?', answer: 'Clients\nand the owner.' }, { question: 'Отчёты?', answer: 'Дневной.' }, { question: 'Integrations?' }]);
    expect(parseInterview(renderInterview(pairs))).toEqual(pairs);
  });
});

describe('node helpers', () => {
  const dirs: string[] = [];
  const tempDir = (prefix: string): string => {
    const dir = mkdtempSync(path.join(os.tmpdir(), prefix));
    dirs.push(dir);
    return dir;
  };
  afterAll(() => {
    for (const dir of dirs) rmSync(dir, { recursive: true, force: true });
  });

  it('allocates unique ids under concurrent writers', async () => {
    const dir = tempDir('crew-ids-');
    const results = await Promise.all(Array.from({ length: 12 }, (_, i) => createWithNextId(dir, 'escalation', (id) => `${id} ${i}\n`)));
    const ids = results.map((r) => r.id).sort();
    expect(new Set(ids).size).toBe(12);
    expect(readdirSync(dir)).toHaveLength(12);
    for (const r of results) expect(readFileSync(r.file, 'utf8').startsWith(r.id)).toBe(true);
    const adr = await createWithNextId(dir, 'decision', () => 'x', { fileName: (id) => `${id}-slug.md` });
    expect(path.basename(adr.file)).toBe('ADR-001-slug.md');
  });

  it('gives up after maxAttempts and rethrows other errors', async () => {
    const dir = tempDir('crew-ids-');
    await expect(createWithNextId(dir, 'task', () => 'x', { fileName: () => 'same.md', maxAttempts: 2 }).then(() => createWithNextId(dir, 'task', () => 'x', { fileName: () => 'same.md', maxAttempts: 2 }))).rejects.toThrow(
      'after 2 attempts',
    );
    await expect(createWithNextId(dir, 'task', () => 'x', { fileName: () => 'missing/dir/x.md' })).rejects.toThrow();
  });

  it('appends JSON lines and writes atomically', async () => {
    const dir = tempDir('crew-io-');
    await appendJsonLine(path.join(dir, 'logs', 'a.jsonl'), { a: 1 });
    await appendJsonLine(path.join(dir, 'logs', 'a.jsonl'), { b: 2 });
    expect(readFileSync(path.join(dir, 'logs', 'a.jsonl'), 'utf8')).toBe('{"a":1}\n{"b":2}\n');
    await writeFileAtomic(path.join(dir, 'x', 'f.md'), 'one');
    await writeFileAtomic(path.join(dir, 'x', 'f.md'), 'two');
    expect(readFileSync(path.join(dir, 'x', 'f.md'), 'utf8')).toBe('two');
    expect(readdirSync(path.join(dir, 'x'))).toEqual(['f.md']);
  });
});
