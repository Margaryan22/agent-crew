import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import * as C from '../../../plugins/agent-crew/lib/crew-contract.mjs';
import { ALLOWED_TOOLS, authProblem, claudeArgs, claudeEnv, parseResult } from '../lib/claude.mjs';
import { appendRow, COLUMNS, csvLine } from '../lib/csv.mjs';
import { countTests, summarize } from '../lib/hidden.mjs';
import { baselinePrompt, interviewFile, loadIdeas, parseIdea, pluginPrompt } from '../lib/ideas.mjs';
import { nextBaselineStep, runConversation } from '../lib/loop.mjs';
import { envFile } from '../lib/workspace.mjs';
import { main, parseOptions } from '../run.mjs';

const evals = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const dirs = [];
after(() => dirs.forEach((d) => rmSync(d, { recursive: true, force: true })));
const temp = () => {
  const d = mkdtempSync(path.join(os.tmpdir(), 'crew-eval-test-'));
  dirs.push(d);
  return d;
};

describe('ideas', () => {
  const ideas = loadIdeas(path.join(evals, 'ideas'));

  it('loads the three example ideas with answered interviews', () => {
    assert.deepEqual(ideas.map((i) => i.id).sort(), ['bakery', 'barbershop', 'warehouse']);
    for (const idea of ideas) {
      assert.equal(idea.language, 'en');
      assert.ok(idea.interview.length >= 10, `${idea.id}: at least 10 answered questions`);
      assert.ok(idea.interview.every((p) => p.block && p.answer.length > 10));
    }
  });

  it('writes an interview the crew CLI reads as fully answered', () => {
    for (const idea of ideas) {
      const pairs = C.parseInterview(interviewFile(idea));
      assert.equal(pairs.length, idea.interview.length);
      assert.ok(pairs.every((p) => p.answer));
    }
  });

  it('gives both modes the same information', () => {
    const idea = ideas.find((i) => i.id === 'barbershop');
    assert.match(pluginPrompt(idea), /^\/agent-crew:new-project Online booking for a small barbershop/);
    const baseline = baselinePrompt(idea);
    for (const p of idea.interview) assert.ok(baseline.includes(p.answer.split('\n')[0]), p.question);
    assert.match(baseline, /nobody will answer questions/);
  });

  it('rejects malformed ideas', () => {
    assert.throws(() => parseIdea('# Idea\nx\n# Interview\n### Q: a\nA: b'), /needs an id/);
    assert.throws(() => parseIdea('---\nid: x\n---\n# Interview\n### Q: a\nA: b'), /Idea/);
    assert.throws(() => parseIdea('---\nid: x\n---\n# Idea\nx\n# Interview\n### Q: a\n'), /needs an answer/);
    assert.throws(() => loadIdeas(path.join(evals, 'ideas'), ['nope']), /unknown idea: nope/);
  });
});

describe('claude invocation', () => {
  const base = { prompt: 'go', model: 'claude-sonnet-5-5', budgetUsd: 12.345, pluginDir: '/p/agent-crew', auth: 'subscription' };

  it('uses the same flags for both modes, plus the plugin', () => {
    const baseline = claudeArgs({ ...base, mode: 'baseline' });
    const plugin = claudeArgs({ ...base, mode: 'plugin', resume: 'sess-1' });
    assert.deepEqual(baseline.slice(0, 14), ['-p', 'go', '--output-format', 'json', '--model', 'claude-sonnet-5-5', '--max-budget-usd', '12.35', '--permission-mode', 'acceptEdits', '--permission-prompts', 'none', '--allowedTools', ALLOWED_TOOLS.join(',')]);
    assert.deepEqual(plugin.slice(0, 14), baseline.slice(0, 14));
    assert.deepEqual(plugin.slice(14), ['--plugin-dir', '/p/agent-crew', '--resume', 'sess-1']);
    assert.ok(!ALLOWED_TOOLS.some((t) => /rm \*|sudo/.test(t)));
    const bare = claudeArgs({ ...base, mode: 'baseline', auth: 'api-key', systemPromptFile: '/w/CLAUDE.md' });
    assert.deepEqual(bare.slice(14), ['--bare', '--append-system-prompt-file', '/w/CLAUDE.md']);
  });

  it('isolates the child environment', () => {
    const env = claudeEnv(
      { PATH: '/bin', CLAUDECODE: '1', CLAUDE_CODE_ENTRYPOINT: 'cli', CREW_AUTONOMY: 'review', CLAUDE_CONFIG_DIR: '/home/.claude', ANTHROPIC_API_KEY: 'k' },
      { mode: 'plugin', auth: 'subscription', configDir: '/evals/.claude-config', capUsd: 20, composeProject: 'crew-eval-x' },
    );
    assert.equal(env.PATH, '/bin');
    assert.equal(env.CLAUDECODE, undefined);
    assert.equal(env.CLAUDE_CODE_ENTRYPOINT, undefined);
    assert.equal(env.CREW_AUTONOMY, undefined);
    assert.equal(env.CLAUDE_CONFIG_DIR, '/evals/.claude-config');
    assert.equal(env.CREW_HOST, 'eval');
    assert.equal(env.CREW_BUDGET_CAP_USD, '20');
    assert.equal(env.COMPOSE_PROJECT_NAME, 'crew-eval-x');
    const baseline = claudeEnv({ PATH: '/bin' }, { mode: 'baseline', auth: 'api-key', capUsd: 20, composeProject: 'p' });
    assert.equal(baseline.CREW_HOST, undefined);
    assert.equal(baseline.CLAUDE_CONFIG_DIR, undefined);
  });

  it('passes on only the credentials --auth names', () => {
    const base = { PATH: '/bin', ANTHROPIC_API_KEY: 'k', ANTHROPIC_AUTH_TOKEN: 't', CLAUDE_CODE_OAUTH_TOKEN: 'o', CLAUDE_CODE_USE_BEDROCK: '1' };
    const sub = claudeEnv(base, { mode: 'plugin', auth: 'subscription', configDir: '/c', capUsd: 20, composeProject: 'p' });
    assert.deepEqual([sub.ANTHROPIC_API_KEY, sub.ANTHROPIC_AUTH_TOKEN, sub.CLAUDE_CODE_OAUTH_TOKEN, sub.CLAUDE_CODE_USE_BEDROCK], [undefined, undefined, 'o', '1']);
    const key = claudeEnv(base, { mode: 'plugin', auth: 'api-key', capUsd: 20, composeProject: 'p' });
    assert.deepEqual([key.ANTHROPIC_API_KEY, key.CLAUDE_CODE_OAUTH_TOKEN], ['k', undefined]);
  });

  it('explains why the runs could not sign in', () => {
    const o = { auth: 'subscription', apiKey: false, bin: 'claude', configDir: '/evals/.claude-config' };
    assert.match(authProblem(undefined, o), /is Claude Code installed/);
    assert.match(authProblem({ loggedIn: false, authMethod: 'none' }, o), /CLAUDE_CONFIG_DIR=\/evals\/\.claude-config claude, then \/login.*setup-token/);
    assert.equal(authProblem({ loggedIn: true, authMethod: 'claude.ai' }, o), undefined);
    assert.match(authProblem({ loggedIn: true }, { ...o, auth: 'api-key' }), /needs ANTHROPIC_API_KEY/);
    assert.equal(authProblem({ loggedIn: true }, { ...o, auth: 'api-key', apiKey: true }), undefined);
  });

  it('parses the JSON result, also after other output', () => {
    const json = { type: 'result', subtype: 'success', session_id: 's', total_cost_usd: 1.5, result: 'done' };
    assert.deepEqual(parseResult(JSON.stringify(json)), json);
    assert.deepEqual(parseResult(`warning: something\n${JSON.stringify(json)}\n`), json);
    assert.equal(parseResult('not json'), undefined);
  });
});

describe('conversation loop', () => {
  const idea = parseIdea('---\nid: demo\n---\n# Idea\nA demo app.\n# Interview\n## Users\n### Q: Who?\nA: Owner.\n');

  function crewProject() {
    const dir = temp();
    mkdirSync(path.join(dir, '.crew', 'escalations'), { recursive: true });
    writeFileSync(path.join(dir, '.crew', 'status.md'), '---\nphase: interview\nupdated_at: "2026-09-30T10:00:00Z"\n---\n# Status\n');
    return dir;
  }

  const setPhase = (dir, phase) => writeFileSync(path.join(dir, '.crew', 'status.md'), `---\nphase: ${phase}\nupdated_at: "2026-09-30T10:00:00Z"\n---\n# Status\n`);
  const escalation = (dir) =>
    writeFileSync(
      path.join(dir, '.crew', 'escalations', 'E-001.md'),
      C.renderEscalation({ id: 'E-001', kind: 'question', source: 'plugin', status: 'open', question: 'Colours?', options: ['Blue', 'Green'], recommended: 'Green', created_at: '2026-09-30T10:00:00Z' }),
    );

  it('answers escalations with the recommended option and resumes until the crew is done', async () => {
    const dir = crewProject();
    const calls = [];
    const turns = [
      () => (setPhase(dir, 'tasks'), escalation(dir)),
      () => setPhase(dir, 'final'), // stopped without finishing: nudged
      () => setPhase(dir, 'done'),
    ];
    const result = await runConversation({
      mode: 'plugin',
      idea,
      workdir: dir,
      capUsd: 20,
      maxRounds: 6,
      now: () => new Date('2026-09-30T12:00:00Z'),
      callClaude: async (o) => {
        calls.push(o);
        turns[calls.length - 1]();
        return { result: { session_id: 'sess-1', subtype: 'success', total_cost_usd: calls.length * 2.5 }, durationMs: 60_000, timedOut: false };
      },
    });
    assert.equal(calls[0].prompt, '/agent-crew:new-project A demo app.');
    assert.equal(calls[0].resume, undefined);
    assert.deepEqual(
      calls.map((c) => [c.resume, c.budgetUsd]),
      [
        [undefined, 20],
        ['sess-1', 17.5],
        ['sess-1', 15],
      ],
    );
    assert.equal(calls[1].prompt, 'E-001: "Green" — answered by the owner. Continue the crew run.');
    assert.equal(calls[2].prompt, 'Continue the crew run.');
    assert.deepEqual({ outcome: result.outcome, rounds: result.rounds, interventions: result.interventions, escalations: result.escalations, cost: result.costUsd, minutes: result.durationMs / 60000 }, {
      outcome: 'done',
      rounds: 3,
      interventions: 2,
      escalations: 1,
      cost: 7.5,
      minutes: 3,
    });
    const answered = C.readEscalation(readFileSync(path.join(dir, '.crew', 'escalations', 'E-001.md'), 'utf8'), 'E-001.md').value;
    assert.deepEqual([answered.status, answered.answer, answered.answered_by], ['answered', 'Green', 'eval']);
    const costs = C.parseCostsLog(readFileSync(path.join(dir, '.crew', 'costs.log'), 'utf8')).entries;
    assert.equal(C.projectSpentUsd(costs), 7.5);
  });

  it('stops at the budget, on errors and after the last round', async () => {
    const call = (r) => async () => r;
    const run = (callClaude, extra = {}) => runConversation({ mode: 'plugin', idea, workdir: crewProject(), capUsd: 5, maxRounds: 2, callClaude, ...extra });
    assert.equal((await run(call({ result: { session_id: 's', subtype: 'error_max_budget_usd', total_cost_usd: 5 }, durationMs: 1, timedOut: false }))).outcome, 'budget');
    assert.equal((await run(call({ result: undefined, durationMs: 1, timedOut: false }))).outcome, 'error');
    assert.equal((await run(call({ result: undefined, durationMs: 1, timedOut: true }))).outcome, 'timeout');
    const rounds = await run(call({ result: { session_id: 's', subtype: 'success', total_cost_usd: 1 }, durationMs: 1, timedOut: false }));
    assert.deepEqual([rounds.outcome, rounds.rounds, rounds.interventions], ['rounds', 2, 2]);
    const spent = await run(call({ result: { session_id: 's', subtype: 'success', total_cost_usd: 4.8 }, durationMs: 1, timedOut: false }));
    assert.equal(spent.outcome, 'budget');
  });

  it('runs the baseline once unless it ends with a question', async () => {
    const dir = temp();
    const texts = ['Should I use Postgres?', 'Done: the app is built.'];
    let i = 0;
    const result = await runConversation({
      mode: 'baseline',
      idea,
      workdir: dir,
      capUsd: 20,
      maxRounds: 6,
      callClaude: async () => ({ result: { session_id: 'b', subtype: 'success', total_cost_usd: 3, result: texts[i++] }, durationMs: 1000, timedOut: false }),
    });
    assert.deepEqual([result.outcome, result.rounds, result.interventions, result.escalations], ['done', 2, 1, 1]);
    assert.deepEqual(nextBaselineStep({ result: 'Why?' }, 2), { done: true, outcome: 'done' });
    assert.deepEqual(readdirSync(dir), [], 'the baseline gets no .crew/');
  });
});

describe('hidden tests, csv, workspace', () => {
  it('summarizes a Playwright JSON report', () => {
    const report = {
      stats: { expected: 5, unexpected: 2, flaky: 1, skipped: 0 },
      suites: [
        { title: 'booking.spec.ts', specs: [{ title: 'books', tests: [{ status: 'expected' }] }, { title: 'double', tests: [{ status: 'unexpected' }] }], suites: [{ title: 'inner', specs: [{ title: 'x', tests: [{ status: 'skipped' }] }] }] },
      ],
    };
    assert.deepEqual(summarize(report), { passed: 6, total: 8, failed: ['double', 'inner › x'] });
    assert.deepEqual(summarize(undefined), { passed: 0, total: 0, failed: [] });
  });

  it('counts the hidden tests of every idea', () => {
    for (const [id, n] of [['barbershop', 8], ['warehouse', 7], ['bakery', 7]]) {
      const dir = path.join(evals, 'hidden-tests', id);
      assert.equal(countTests(dir, readdirSync(dir).filter((f) => f.endsWith('.spec.ts'))), n, id);
    }
  });

  it('writes CSV rows with the SPEC columns first', () => {
    assert.deepEqual(COLUMNS.slice(0, 8), ['idea_id', 'mode', 'hidden_tests_passed', 'hidden_tests_total', 'cost_usd', 'duration_min', 'escalations', 'human_interventions']);
    assert.equal(csvLine({ idea_id: 'a,b', mode: 'plugin', outcome: 'say "hi"' }).split(',').length > 8, true);
    const file = path.join(temp(), 'r', 'x.csv');
    appendRow(file, { idea_id: 'barbershop', mode: 'plugin', hidden_tests_passed: 7, hidden_tests_total: 8 });
    appendRow(file, { idea_id: 'barbershop', mode: 'baseline' });
    const lines = readFileSync(file, 'utf8').trim().split('\n');
    assert.equal(lines.length, 3);
    assert.equal(lines[0], COLUMNS.join(','));
    assert.match(lines[1], /^barbershop,plugin,7,8,/);
  });

  it('points .env at the run database port', () => {
    const example = 'DATABASE_URL=postgres://postgres:postgres@localhost:5432/app\nSEED_OWNER_EMAIL=owner@example.com\n';
    assert.equal(envFile(example, 55433), 'DATABASE_URL=postgres://postgres:postgres@localhost:55433/app\nSEED_OWNER_EMAIL=owner@example.com\nDB_PORT=55433\n');
  });
});

describe('command line', () => {
  it('parses options and refuses bad ones', () => {
    const o = parseOptions(['--ideas', 'bakery', '--modes', 'plugin', '--budget', '5', '--auth', 'api-key']);
    assert.deepEqual([o.ideas, o.modes, o.budget, o.auth, o.model, o.claude], [['bakery'], ['plugin'], 5, 'api-key', 'claude-sonnet-5-5', 'claude']);
    assert.equal(parseOptions(['--claude', 'tools/fake.mjs']).claude, path.resolve('tools/fake.mjs'));
    assert.throws(() => parseOptions(['--modes', 'solo']), /unknown mode/);
    assert.throws(() => parseOptions(['--budget', '0']), /positive/);
    assert.throws(() => parseOptions(['--auth', 'magic']), /subscription or api-key/);
  });

  it('never starts paid runs without --yes', async () => {
    const lines = [];
    assert.equal(await main(['--ideas', 'bakery', '--dry-run'], (s) => lines.push(s)), 0);
    assert.match(lines[0], /2 runs \(bakery × baseline, plugin\).*at most \$40\.00 in total/);
    lines.length = 0;
    assert.equal(await main(['--ideas', 'bakery,warehouse', '--modes', 'plugin', '--budget', '3'], (s) => lines.push(s)), 1);
    assert.match(lines.at(-1), /Nothing started/);
  });

  it('checks the sign-in before any setup', async () => {
    const lines = [];
    process.env.FAKE_CLAUDE_AUTH = 'none';
    try {
      await assert.rejects(main(['--ideas', 'bakery', '--yes', '--claude', path.join(evals, 'runner', 'test', 'fake-claude.mjs')], (s) => lines.push(s)), /not signed in/);
    } finally {
      delete process.env.FAKE_CLAUDE_AUTH;
    }
    assert.ok(!lines.some((l) => l.includes('▶')));
  });
});
