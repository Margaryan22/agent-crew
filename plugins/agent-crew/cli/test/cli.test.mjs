import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import { findFlipFlops } from '../report.mjs';
import { main } from '../main.mjs';
import { errorHash } from '../project.mjs';

const pluginRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const dirs = [];
after(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

function project() {
  const dir = realpathSync(mkdtempSync(path.join(os.tmpdir(), 'crew-cli-')));
  dirs.push(dir);
  return dir;
}

let tick = 0;
/** Runs the CLI in-process; returns { code, out, err }. */
async function crew(cwd, argv, { env = {}, stdin = '' } = {}) {
  let out = '';
  let err = '';
  const code = await main(argv, {
    cwd,
    env,
    now: () => new Date(Date.UTC(2026, 8, 29, 12, 0, tick++)),
    stdout: (s) => (out += s),
    stderr: (s) => (err += s),
    stdin: () => stdin,
  });
  return { code, out, err };
}

async function ok(cwd, argv, opts) {
  const r = await crew(cwd, argv, opts);
  assert.equal(r.code, 0, `crew ${argv.join(' ')} → ${r.code}\n${r.err}`);
  return r.out;
}

async function json(cwd, argv) {
  return JSON.parse(await ok(cwd, [...argv, '--json']));
}

async function fails(cwd, argv, code, pattern) {
  const r = await crew(cwd, argv);
  assert.equal(r.code, code, `expected exit ${code} for crew ${argv.join(' ')}, got ${r.code}: ${r.out}${r.err}`);
  if (pattern) assert.match(r.err, pattern);
  return r;
}

const read = (root, rel) => readFileSync(path.join(root, rel), 'utf8');

async function started(extra = []) {
  const root = project();
  await ok(root, ['init', ...extra]);
  return root;
}

describe('help and routing', () => {
  it('prints help and rejects unknown commands and options', async () => {
    const root = project();
    assert.match(await ok(root, []), /crew task new/);
    assert.match(await ok(root, ['help']), /Exit codes/);
    await fails(root, ['frobnicate'], 1, /unknown command/);
    await fails(root, ['task', 'list'], 1, /no \.crew\/ folder/);
    assert.match(await ok(root, ['summary']), /No crew project in this folder yet/);
    assert.match(await ok(root, ['next']), /No crew project/);
    mkdirSync(path.join(root, '.crew', 'sessions'), { recursive: true });
    assert.match(await ok(root, ['summary']), /crew init has not run/);
    assert.deepEqual(await json(root, ['summary']), { initialised: false });
    await ok(root, ['init']);
    await fails(root, ['task', 'list', '--colour', 'red'], 1, /unknown option: --colour/);
    assert.match(await ok(root, ['task', 'list', '--help']), /crew task new/);
  });

  it('finds the project root from a subdirectory', async () => {
    const root = await started();
    mkdirSync(path.join(root, 'src', 'routes'), { recursive: true });
    await ok(path.join(root, 'src', 'routes'), ['task', 'new', '--title', 'A', '--owner', 'frontend']);
    assert.ok(existsSync(path.join(root, '.crew', 'tasks', 'T-001.md')));
  });

  it('the bin launcher passes exit codes through', () => {
    const root = project();
    const bin = path.join(pluginRoot, 'bin', 'crew');
    const bad = spawnSync(process.execPath, [bin, 'task', 'list'], { cwd: root, encoding: 'utf8' });
    assert.equal(bad.status, 1);
    assert.match(bad.stderr, /no \.crew\/ folder/);
    const good = spawnSync(process.execPath, [bin, 'init', '--language', 'en'], { cwd: root, encoding: 'utf8' });
    assert.equal(good.status, 0, good.stderr);
  });
});

describe('init and config', () => {
  it('creates the manifest, .gitignore and status, and is idempotent', async () => {
    const root = project();
    assert.match(await ok(root, ['init', '--language', 'ru']), /Initialised/);
    const manifest = JSON.parse(read(root, '.crew/crew.json'));
    assert.equal(manifest.contract_version, 1);
    assert.equal(manifest.plugin.name, 'agent-crew');
    assert.equal(manifest.plugin.version, JSON.parse(read(pluginRoot, '.claude-plugin/plugin.json')).version);
    assert.equal(manifest.stack_profile, 'auto');
    assert.equal(manifest.language, 'ru');
    assert.equal(read(root, '.crew/.gitignore'), 'logs/\nsessions/\n');
    assert.match(read(root, '.crew/status.md'), /phase: interview/);
    assert.match(await ok(root, ['init']), /already exists/);
    assert.match(await ok(root, ['init', '--language', 'en']), /language set to en/);
    assert.equal(JSON.parse(read(root, '.crew/crew.json')).language, 'en');
    await fails(root, ['init', '--language', 'English'], 1, /language/);
  });

  it('resolves config from env, then the newest session marker, then defaults', async () => {
    const root = await started();
    assert.deepEqual([(await json(root, ['config'])).budgetCapUsd, (await json(root, ['config'])).stackProfile], [0, 'auto']);
    mkdirSync(path.join(root, '.crew', 'sessions'), { recursive: true });
    writeFileSync(path.join(root, '.crew/sessions/a.json'), JSON.stringify({ started_at: '2026-09-29T10:00:00Z', config: { budgetCapUsd: 5, autonomy: 'review' } }));
    writeFileSync(path.join(root, '.crew/sessions/b.json'), JSON.stringify({ started_at: '2026-09-29T11:00:00Z', config: { budgetCapUsd: 7 } }));
    writeFileSync(path.join(root, '.crew/sessions/broken.json'), '{');
    const cfg = await json(root, ['config']);
    assert.equal(cfg.budgetCapUsd, 7);
    assert.equal(cfg.autonomy, 'full');
    const r = await crew(root, ['config'], { env: { CREW_BUDGET_CAP_USD: '3' } });
    assert.equal(JSON.parse(r.out).budgetCapUsd, 3);
  });
});

describe('tasks', () => {
  it('creates tasks with validated fields and never leaves a broken file behind', async () => {
    const root = await started();
    const created = await json(root, ['task', 'new', '--title', 'Schema', '--owner', 'db', '--budget', '2.5', '--model', 'sonnet', '--files', 'src/db/schema.ts']);
    assert.deepEqual(created, { id: 'T-001', path: '.crew/tasks/T-001.md' });
    await ok(root, ['task', 'new', '--title', 'Form', '--owner', 'frontend', '--depends-on', 'T-1', '--body', '-'], { stdin: '## Goal\n\nBook a slot.\n' });
    const t2 = await json(root, ['task', 'show', 'T-002']);
    assert.deepEqual(t2.depends_on, ['T-001']);
    assert.match(t2.body, /^# T-002: Form\n\n## Goal\n\nBook a slot\./);

    await fails(root, ['task', 'new', '--owner', 'db'], 1, /--title is required/);
    await fails(root, ['task', 'new', '--title', 'X'], 1, /--owner is required/);
    await fails(root, ['task', 'new', '--title', 'X', '--owner', 'Front End'], 1, /owner: expected a kebab-case/);
    await fails(root, ['task', 'new', '--title', 'X', '--owner', 'db', '--depends-on', 'T-009'], 2, /T-009 not found/);
    await fails(root, ['task', 'new', '--title', 'X', '--owner', 'db', '--budget', 'lots'], 1, /must be a number/);
    assert.deepEqual(readdirSync(path.join(root, '.crew/tasks')).sort(), ['T-001.md', 'T-002.md']);
  });

  it('lists, filters and shows tasks', async () => {
    const root = await started();
    await ok(root, ['task', 'new', '--title', 'Schema', '--owner', 'db']);
    await ok(root, ['task', 'new', '--title', 'Form', '--owner', 'frontend']);
    assert.match(await ok(root, ['task', 'list']), /T-001 {2}todo +db +Schema\nT-002 {2}todo +frontend +Form/);
    assert.equal((await json(root, ['task', 'list', '--owner', 'frontend'])).length, 1);
    assert.match(await ok(root, ['task', 'list', '--status', 'done']), /No tasks/);
    assert.match(await ok(root, ['task', 'show', '1']), /^---\nid: T-001/);
    await fails(root, ['task', 'show', 'T-042'], 2, /T-042 not found/);
    await fails(root, ['task', 'show', 'banana'], 1, /not a task id/);
  });

  it('moves a task through the cycle and enforces the order', async () => {
    const root = await started();
    await ok(root, ['task', 'new', '--title', 'Schema', '--owner', 'db']);
    await ok(root, ['task', 'new', '--title', 'Form', '--owner', 'frontend', '--depends-on', 'T-001']);
    await fails(root, ['task', 'start', 'T-002'], 3, /depends on T-001, which is not done/);
    await fails(root, ['task', 'pass', 'T-001', '--stage', 'qa'], 3, /needs status review/);
    await ok(root, ['task', 'start', 'T-001']);
    assert.match(await ok(root, ['task', 'start', 'T-001']), /already in progress/);
    await ok(root, ['task', 'submit', 'T-001', '--files', 'src/db/schema.ts,drizzle/0001.sql', '--note', 'schema']);
    await fails(root, ['task', 'pass', 'T-001', '--stage', 'security'], 3, /in qa review, not security/);
    await fails(root, ['task', 'pass', 'T-001', '--stage', 'design'], 1, /--stage must be qa or security/);
    await ok(root, ['task', 'pass', 'T-001', '--stage', 'qa']);
    let t = await json(root, ['task', 'show', 'T-001']);
    assert.equal(t.status, 'review');
    assert.equal(t.review_stage, 'security');
    assert.deepEqual(t.files, ['src/db/schema.ts', 'drizzle/0001.sql']);
    await ok(root, ['task', 'pass', 'T-001', '--stage', 'security', '--note', 'no findings']);
    t = await json(root, ['task', 'show', 'T-001']);
    assert.equal(t.status, 'done');
    assert.equal(t.review_stage, undefined);
    assert.match(t.body, /## Log\n\n- 2026-09-29T12:00:\d\dZ submitted for review by db: schema\n- .* qa review passed\n- .* security review passed: no findings\n$/);
    await ok(root, ['task', 'start', 'T-002']);
  });

  it('climbs the ladder: retry → stronger model → replan → escalate', async () => {
    const root = await started();
    await ok(root, ['task', 'new', '--title', 'Form', '--owner', 'frontend', '--model', 'sonnet']);
    await ok(root, ['task', 'start', 'T-001']);
    await ok(root, ['task', 'submit', 'T-001']);
    await fails(root, ['task', 'reject', 'T-001', '--stage', 'qa'], 1, /--error is required/);
    let r = await json(root, ['task', 'reject', 'T-001', '--stage', 'qa', '--error', 'Save button does nothing']);
    assert.deepEqual(r, { id: 'T-001', attempts: 1, repeated: false, reason: null, action: 'retry', model: 'sonnet' });
    r = await json(root, ['task', 'fail', 'T-001', '--error', 'Type error in form.tsx line 12']);
    assert.equal(r.action, 'retry');
    r = await json(root, ['task', 'fail', 'T-001', '--error', 'Timeout after 30000ms']);
    assert.deepEqual({ action: r.action, reason: r.reason, model: r.model }, { action: 'stronger_model', reason: 'attempts_exceeded', model: 'opus' });
    let t = await json(root, ['task', 'show', 'T-001']);
    assert.deepEqual({ status: t.status, attempts: t.attempts, ladder: t.ladder, model: t.model, hash: t.last_error_hash }, { status: 'todo', attempts: 0, ladder: 'stronger_model', model: 'opus', hash: undefined });

    // The same error twice in a row climbs at once, even with volatile numbers in it.
    r = await json(root, ['task', 'fail', 'T-001', '--error', 'POST /api/bookings returned 500 in 120ms']);
    assert.equal(r.action, 'retry');
    r = await json(root, ['task', 'fail', 'T-001', '--error', 'POST /api/bookings returned 500 in 98ms']);
    assert.deepEqual({ action: r.action, reason: r.reason, repeated: r.repeated }, { action: 'replan', reason: 'repeated_error', repeated: true });

    for (const e of ['a', 'b']) assert.equal((await json(root, ['task', 'fail', 'T-001', '--error', e])).action, 'retry');
    const out = await ok(root, ['task', 'fail', 'T-001', '--error', 'c']);
    assert.match(out, /Ladder: replan → escalate[\s\S]*crew escalate --kind stuck --reason attempts_exceeded --task T-001/);
    t = await json(root, ['task', 'show', 'T-001']);
    assert.equal(t.attempts, 3);
    assert.equal((t.body.match(/^- .*(attempt failed|rejected it)/gm) ?? []).length, 8);
  });

  it('skips the stronger-model rung when the task already runs on opus', async () => {
    const root = await started();
    await ok(root, ['task', 'new', '--title', 'Architecture', '--owner', 'architect', '--model', 'opus']);
    await json(root, ['task', 'fail', 'T-001', '--error', 'x']);
    const r = await json(root, ['task', 'fail', 'T-001', '--error', 'x']);
    assert.equal(r.action, 'replan');
  });

  it('set changes fields, cleans stale stage fields and protects ids', async () => {
    const root = await started();
    await ok(root, ['task', 'new', '--title', 'A', '--owner', 'db']);
    await ok(root, ['task', 'new', '--title', 'B', '--owner', 'db']);
    await ok(root, ['task', 'start', 'T-001']);
    await ok(root, ['task', 'submit', 'T-001']);
    await ok(root, ['task', 'set', 'T-001', 'status=todo', 'owner=backend', 'budget_usd=3', 'depends_on=2', 'model=']);
    const t = await json(root, ['task', 'show', 'T-001']);
    assert.deepEqual({ status: t.status, stage: t.review_stage, owner: t.owner, budget: t.budget_usd, deps: t.depends_on }, { status: 'todo', stage: undefined, owner: 'backend', budget: 3, deps: ['T-002'] });
    await fails(root, ['task', 'set', 'T-001', 'id=T-009'], 1, /id can't be changed/);
    await fails(root, ['task', 'set', 'T-001'], 1, /nothing to set/);
    await fails(root, ['task', 'set', 'T-001', 'status=wip'], 1, /status/);
    await fails(root, ['task', 'set', 'T-001', 'oops'], 1, /key=value/);
    await fails(root, ['task', 'set', 'T-001', 'attempts=many'], 1, /must be a number/);
  });

  it('accepts hand-named task files', async () => {
    const root = await started();
    mkdirSync(path.join(root, '.crew/tasks'), { recursive: true });
    writeFileSync(path.join(root, '.crew/tasks/T-007-login.md'), '---\nid: T-007\ntitle: Login\nstatus: todo\nowner: backend\nattempts: 0\ncreated_at: "2026-09-29T10:00:00Z"\nupdated_at: "2026-09-29T10:00:00Z"\n---\n\n# Login\n');
    await ok(root, ['task', 'start', '7']);
    assert.match(read(root, '.crew/tasks/T-007-login.md'), /status: in_progress/);
    assert.equal((await json(root, ['task', 'new', '--title', 'Next', '--owner', 'qa'])).id, 'T-008');
  });
});

describe('escalations and decisions', () => {
  it('escalates, blocks the task, records the answer, the ADR and unblocks', async () => {
    const root = await started();
    await ok(root, ['task', 'new', '--title', 'Payments', '--owner', 'backend']);
    await fails(root, ['escalate', '--kind', 'access', '--question', 'Stripe key?', '--option', 'Yes'], 1, /at least two --option/);
    await fails(root, ['escalate', '--kind', 'access', '--question', 'Stripe key?', '--option', 'Yes', '--option', 'Later'], 1, /--recommended is required/);
    await fails(root, ['escalate', '--kind', 'stuck', '--question', 'Q?', '--option', 'A', '--option', 'B', '--recommended', 'A'], 1, /reason is required/);
    await fails(root, ['escalate', '--kind', 'access', '--question', 'Q?', '--option', 'A', '--option', 'B', '--recommended', 'C'], 1, /recommended must be one of options/);
    assert.equal(readdirSync(path.join(root, '.crew')).includes('escalations'), false);

    const e = await json(root, ['escalate', '--kind', 'access', '--question', 'Which payment provider account can we use?', '--option', 'Stripe test account', '--option', 'Skip payments for now', '--recommended', 'Skip payments for now', '--task', 'T-001', '--agent', 'backend', '--problem', 'Deposits need a provider.', '--tried', 'Checked the brief and access checklist.']);
    assert.deepEqual(e, { id: 'E-001', path: '.crew/escalations/E-001.md', task: 'T-001' });
    const text = read(root, e.path);
    assert.match(text, /## Problem\n\nDeposits need a provider\.\n\n## Tried\n\nChecked the brief/);
    assert.match(text, /2\. Skip payments for now \(recommended\)/);
    let t = await json(root, ['task', 'show', 'T-001']);
    assert.deepEqual({ status: t.status, escalation: t.escalation }, { status: 'blocked', escalation: 'E-001' });
    assert.match(await ok(root, ['escalation', 'list', '--status', 'open']), /E-001 {2}open +access +T-001 Which payment/);
    assert.match(await ok(root, ['check']), /\[wait\] E-001 waits for the human/);

    await fails(root, ['escalation', 'resolve', 'E-001'], 3, /record the answer first/);
    await fails(root, ['escalation', 'answer', 'E-001', '--text', 'x', '--by', 'robot'], 1, /--by must be one of/);
    await ok(root, ['escalation', 'answer', 'E-001', '--text', 'Skip payments for now']);
    assert.match(await ok(root, ['check']), /\[act\] E-001 was answered \("Skip payments for now"\)/);
    await fails(root, ['escalation', 'resolve', 'E-001'], 1, /resolved with an ADR/);
    await fails(root, ['escalation', 'resolve', 'E-001', '--decision', 'ADR-004'], 2, /ADR-004 not found/);
    const adr = await json(root, ['decision', 'new', '--title', 'No payments in v1', '--source', 'E-001', '--body', '## Decision\n\nNo deposits in v1.']);
    assert.deepEqual(adr, { id: 'ADR-001', path: '.crew/decisions/ADR-001-no-payments-in-v1.md' });
    assert.match(await ok(root, ['escalation', 'resolve', 'E-001', '--decision', 'ADR-1']), /Unblocked: T-001/);
    t = await json(root, ['task', 'show', 'T-001']);
    assert.deepEqual({ status: t.status, escalation: t.escalation }, { status: 'todo', escalation: undefined });
    assert.match(read(root, '.crew/escalations/E-001.md'), /status: resolved[\s\S]*decision: ADR-001/);
    await fails(root, ['escalation', 'cancel', 'E-001'], 3, /already resolved/);
    assert.match(await ok(root, ['escalation', 'show', '1']), /## Answer\n\nSkip payments for now/);
    assert.match(await ok(root, ['validate']), /match the contract/);
  });

  it('cancels escalations and resolves ones that need no ADR', async () => {
    const root = await started();
    await ok(root, ['task', 'new', '--title', 'X', '--owner', 'backend']);
    await ok(root, ['escalate', '--kind', 'permission', '--question', 'Run docker?', '--option', 'Allow', '--option', 'Deny', '--task', 'T-001']);
    assert.match(await ok(root, ['escalation', 'cancel', 'E-001']), /Unblocked: T-001/);
    await ok(root, ['escalate', '--kind', 'brief-review', '--question', 'Approve the brief?', '--option', 'Approve', '--option', 'Request changes']);
    await ok(root, ['escalation', 'answer', 'E-002', '--text', 'Approve', '--by', 'auto']);
    await ok(root, ['escalation', 'resolve', 'E-002']);
    assert.match(await ok(root, ['escalation', 'list']), /E-001 {2}cancelled[\s\S]*E-002 {2}resolved +brief-review +Approve the brief\? {2}→ Approve/);
    assert.match(await ok(root, ['escalation', 'list', '--status', 'open']), /No escalations/);
  });

  it('supersedes decisions', async () => {
    const root = await started();
    await ok(root, ['decision', 'new', '--title', 'Use SQLite']);
    const r = await ok(root, ['decision', 'new', '--title', 'Use PostgreSQL', '--supersedes', 'ADR-001']);
    assert.match(r, /ADR-001 is now superseded/);
    assert.match(await ok(root, ['decision', 'list']), /ADR-001 {2}superseded +Use SQLite\nADR-002 {2}accepted +Use PostgreSQL/);
    await fails(root, ['decision', 'new', '--title', 'X', '--supersedes', 'ADR-009'], 2);
    await fails(root, ['decision', 'new', '--title', 'X', '--status', 'maybe'], 1, /status/);
    assert.match(read(root, '.crew/decisions/ADR-002-use-postgresql.md'), /## Context\n\n## Decision\n\n## Consequences/);
  });
});

describe('status, next, check, budget, summary', () => {
  it('status set keeps other keys and clears stop_reason when resuming', async () => {
    const root = await started();
    await ok(root, ['status', 'set', 'phase=tasks', 'active_tasks=T-001,T-002', '--summary', 'Building the form.']);
    let text = read(root, '.crew/status.md');
    assert.match(text, /phase: tasks\nupdated_at: .*\nactive_tasks: \["T-001", "T-002"\]\nsummary: Building the form\./);
    writeFileSync(path.join(root, '.crew/status.md'), text.replace('phase: tasks', 'phase: stopped\nstop_reason: user\nhost_note: kept'));
    await ok(root, ['status', 'set', 'phase=tasks', '--body', '# Status\n\nBack at it.']);
    text = read(root, '.crew/status.md');
    assert.doesNotMatch(text, /stop_reason/);
    assert.match(text, /host_note: kept/);
    assert.match(text, /Back at it\./);
    await fails(root, ['status', 'set', 'phase=stopped'], 1, /stop_reason is required/);
    await fails(root, ['status', 'set', 'phase=partying'], 1, /phase/);
    assert.match(await ok(root, ['status', 'show']), /phase: tasks/);
  });

  it('next groups tasks by what can happen now', async () => {
    const root = await started();
    assert.match(await ok(root, ['next']), /No tasks yet/);
    for (const [title, owner, deps] of [['Schema', 'db'], ['API', 'backend', 'T-001'], ['Form', 'frontend', 'T-002'], ['Seed', 'db']]) {
      await ok(root, ['task', 'new', '--title', title, '--owner', owner, ...(deps ? ['--depends-on', deps] : [])]);
    }
    await ok(root, ['task', 'start', 'T-001']);
    await ok(root, ['task', 'submit', 'T-001']);
    const n = await json(root, ['next']);
    assert.deepEqual(n.ready.map((t) => t.id), ['T-004']);
    assert.deepEqual(n.review.map((t) => t.id), ['T-001']);
    assert.deepEqual(n.waiting.map((t) => t.id), ['T-002', 'T-003']);
    assert.equal(n.total, 4);
    assert.match(await ok(root, ['next']), /Ready to start[\s\S]*Waiting for review[\s\S]*Waiting for dependencies[\s\S]*Done: 0 of 4/);
    for (const id of ['T-001', 'T-002', 'T-003', 'T-004']) await ok(root, ['task', 'set', id, 'status=done']);
    assert.match(await ok(root, ['next']), /All 4 tasks are done/);
  });

  it('check reports budget, task budget and edit flip-flops', async () => {
    const root = await started();
    await ok(root, ['task', 'new', '--title', 'Form', '--owner', 'frontend', '--budget', '1']);
    const est = (usd, task) => JSON.stringify({ ts: '2026-09-29T12:00:00Z', source: 'estimate', task, tokens: { input: 1000, output: 100 }, turn_cost_usd: usd });
    writeFileSync(path.join(root, '.crew/costs.log'), `${est(1.5, 'T-001')}\n${est(15, 'T-002')}\n`);
    // Without a cap spend alone is no finding; the cap below is one the user set for a pay-per-use session.
    assert.deepEqual((await json(root, ['check'])).map((f) => f.kind), ['task_budget']);
    mkdirSync(path.join(root, '.crew', 'sessions'), { recursive: true });
    writeFileSync(path.join(root, '.crew/sessions/s.json'), JSON.stringify({ started_at: '2026-09-29T10:00:00Z', config: { budgetCapUsd: 20 } }));
    let findings = await json(root, ['check']);
    assert.deepEqual(findings.map((f) => f.kind).sort(), ['budget_warning', 'task_budget']);
    assert.match(findings.find((f) => f.kind === 'task_budget').message, /T-001 used ~\$1\.5 of its \$1 share/);

    writeFileSync(path.join(root, '.crew/costs.log'), `${est(21, 'T-001')}\n`);
    findings = await json(root, ['check']);
    assert.ok(findings.some((f) => f.kind === 'budget_cap' && f.severity === 'stop'));
    // A host-reported total replaces the estimate as the basis.
    writeFileSync(path.join(root, '.crew/costs.log'), `${est(21, 'T-001')}\n${JSON.stringify({ ts: '2026-09-29T12:00:00Z', source: 'headless', session_id: 's', session_total_usd: 4 })}\n`);
    const b = await json(root, ['budget']);
    assert.deepEqual({ basis: b.basis, used: b.used_usd, est: b.estimated_usd, tokens: b.estimated_tokens }, { basis: 'reported', used: 4, est: 21, tokens: 1100 });
    assert.match(await ok(root, ['budget']), /Used: \$4 \(reported by the host\), 20% of the cap/);
    assert.match(await ok(root, ['budget'], { env: { CREW_BUDGET_CAP_USD: '0' } }), /no cap/);

    mkdirSync(path.join(root, '.crew/logs'), { recursive: true });
    const edit = (agent, before, after) => JSON.stringify({ ts: '2026-09-29T12:00:00Z', session_id: 's', agent_type: agent, file: 'src/a.ts', before, after });
    writeFileSync(path.join(root, '.crew/logs/edits.jsonl'), [edit('agent-crew:frontend', 'aaa111aaa111', 'bbb222bbb222'), edit('agent-crew:backend', 'bbb222bbb222', 'aaa111aaa111'), 'junk'].join('\n'));
    findings = await json(root, ['check']);
    assert.match(findings.find((f) => f.kind === 'edit_flipflop').message, /agent-crew:backend and agent-crew:frontend undid each other's edits in src\/a\.ts/);
  });

  it('finds flip-flops only between different agents', () => {
    const line = (agent, before, after, file = 'x.ts') => JSON.stringify({ file, agent_type: agent, before, after });
    assert.deepEqual(findFlipFlops([line('a', '1', '2'), line('a', '2', '1')].join('\n')), []);
    assert.deepEqual(findFlipFlops([line('a', '1', '2'), line(undefined, '2', '1')].join('\n')), [{ file: 'x.ts', agents: ['a', 'main thread'], times: 1 }]);
    assert.deepEqual(findFlipFlops([line('a', '1', '2'), line('b', '2', '1', 'y.ts')].join('\n')), []);
  });

  it('summary gathers phase, tasks, escalations, access and spend', async () => {
    const root = await started();
    await ok(root, ['task', 'new', '--title', 'A', '--owner', 'db']);
    await ok(root, ['escalate', '--kind', 'question', '--question', 'Colours?', '--option', 'Blue', '--option', 'Green', '--recommended', 'Blue']);
    writeFileSync(path.join(root, '.crew/access-checklist.md'), '# Access\n\n- [x] Domain — site\n- [ ] SMTP password — booking emails\n');
    const s = await json(root, ['summary']);
    assert.equal(s.phase, 'interview');
    assert.deepEqual(s.tasks, { total: 1, todo: 1 });
    assert.deepEqual(s.open_escalations, [{ id: 'E-001', status: 'open', kind: 'question', question: 'Colours?' }]);
    assert.deepEqual(s.access_needed, ['SMTP password — booking emails']);
    assert.match(await ok(root, ['summary']), /Phase: interview — Project started\.\nTasks: 1 \(1 todo\)\nDecisions: 0\nEscalations waiting: E-001 \[open\] Colours\?\nAccess still needed: SMTP password — booking emails\nSpend: \$0 \(estimate\), ~0 tokens estimated/);
  });
});

describe('validate, interview, id', () => {
  it('validates .crew/ and fails on broken files', async () => {
    const root = await started();
    await ok(root, ['task', 'new', '--title', 'A', '--owner', 'db']);
    assert.match(await ok(root, ['validate']), /All 3 checked files match the contract/);
    writeFileSync(path.join(root, '.crew/tasks/T-002.md'), '---\nid: T-003\nstatus: nope\n---\n');
    const r = await crew(root, ['validate']);
    assert.equal(r.code, 1);
    assert.match(r.out, /\.crew\/tasks\/T-002\.md:\n {2}- .*title[\s\S]*does not match the file name/);
    const one = await crew(root, ['validate', path.join(root, '.crew/tasks/T-001.md')]);
    assert.equal(one.code, 0);
    const missing = await crew(root, ['validate', 'nope.md', '--json']);
    assert.equal(missing.code, 1);
    assert.equal(JSON.parse(missing.out)[0].issues[0], 'file not found');
  });

  it('lists pending interview questions and writes answers in place', async () => {
    const root = await started();
    assert.match(await ok(root, ['interview', 'pending']), /No interview yet/);
    writeFileSync(
      path.join(root, '.crew/interview.md'),
      '# Interview\n\n## Users and roles\n\n### Q: Who uses the app?\nA: Owner and clients.\n\n### Q: Which roles exist?\n\n## Data\n\n### Q: What do you store about a client?\nNote: think GDPR.\n',
    );
    assert.equal(await ok(root, ['interview', 'pending']), '2. Which roles exist?\n3. What do you store about a client?\n');
    await ok(root, ['interview', 'answer', '2', '--text', 'Owner, barber, client']);
    await ok(root, ['interview', 'answer', '3', '--text', 'Name and phone.\nNo birthdays.']);
    await ok(root, ['interview', 'answer', '1', '--text', 'The owner only.']);
    assert.equal(
      read(root, '.crew/interview.md'),
      '# Interview\n\n## Users and roles\n\n### Q: Who uses the app?\nA: The owner only.\n\n### Q: Which roles exist?\nA: Owner, barber, client\n\n## Data\n\n### Q: What do you store about a client?\nNote: think GDPR.\nA: Name and phone.\nNo birthdays.\n',
    );
    assert.match(await ok(root, ['interview', 'pending']), /All 3 questions are answered/);
    await fails(root, ['interview', 'answer', '9', '--text', 'x'], 1, /only 3 questions/);
    await fails(root, ['interview', 'answer', 'x', '--text', 'x'], 1, /question number/);
  });

  it('prints the next free id', async () => {
    const root = await started();
    assert.equal(await ok(root, ['id', 'next', 'task']), 'T-001\n');
    await ok(root, ['decision', 'new', '--title', 'A']);
    assert.equal(await ok(root, ['id', 'next', 'decision']), 'ADR-002\n');
    await fails(root, ['id', 'next', 'thing'], 1);
  });

  it('hashes errors without volatile numbers', () => {
    assert.equal(errorHash('Timeout after 3000ms at /tmp/x-123/a.ts'), errorHash('timeout after 5000ms at /tmp/y-999/b.ts'));
    assert.notEqual(errorHash('Timeout'), errorHash('Type error'));
    assert.match(errorHash('x'), /^[0-9a-f]{12}$/);
  });
});

describe('scaffold', () => {
  it('copies the stack template without overwriting and creates .env', async () => {
    const root = path.join(project(), 'Barber Shop');
    mkdirSync(root);
    await ok(root, ['init']);
    writeFileSync(path.join(root, 'README.md'), '# Mine\n');
    // The default profile has nothing to copy: the architect builds the skeleton for the stack it chose.
    await fails(root, ['scaffold'], 1, /stack profile "auto" has no template: the architect chooses the stack/);
    rmSync(path.join(root, '.crew'), { recursive: true });
    await ok(root, ['init', '--stack', 'tanstack']);
    const out = await ok(root, ['scaffold']);
    assert.match(out, /Copied \d+ files from the tanstack template and created \.env from \.env\.example\./);
    assert.match(out, /Kept 1 existing file: README\.md/);
    assert.equal(read(root, 'README.md'), '# Mine\n');
    assert.equal(JSON.parse(read(root, 'package.json')).name, 'barber-shop');
    assert.equal(read(root, '.env'), read(pluginRoot, 'templates/tanstack/.env.example'));
    for (const f of ['src/routes/__root.tsx', 'src/server/session.server.ts', 'drizzle/0000_init.sql', '.gitignore', 'e2e/auth.spec.ts']) assert.ok(existsSync(path.join(root, f)), f);
    assert.ok(!existsSync(path.join(root, 'node_modules')));
    const again = await ok(root, ['scaffold']);
    assert.match(again, /^Copied 0 files/);
    await fails(root, ['scaffold', '--stack', 'rails'], 1, /no template for stack profile "rails"/);
  });
});
