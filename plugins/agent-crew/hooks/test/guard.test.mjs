import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import path from 'node:path';
import { describe, it } from 'node:test';
import { main } from '../../cli/main.mjs';
import { stopDecision, unrecordedResult } from '../scripts/lib/guard.mjs';
import { tempProject } from './helpers.mjs';

const env = {};

async function crew(root, ...argv) {
  let err = '';
  const code = await main(argv, { cwd: root, env, stdout: () => {}, stderr: (s) => (err += s), stdin: () => '' });
  assert.equal(code, 0, `crew ${argv.join(' ')}: ${err}`);
}

async function projectInPhase(phase) {
  const root = tempProject();
  await crew(root, 'init');
  await crew(root, 'status', 'set', `phase=${phase}`);
  return root;
}

const stop = (root, session = 's1') => stopDecision({ session_id: session }, root, env);

describe('stop guard (main session)', () => {
  it('lets the session stop while interviewing, when done, stopped or without .crew/', async () => {
    assert.equal(stop(tempProject()), undefined);
    assert.equal(stop(await projectInPhase('interview')), undefined);
    assert.equal(stop(await projectInPhase('done')), undefined);
    const stopped = await projectInPhase('tasks');
    await crew(stopped, 'status', 'set', 'phase=stopped', 'stop_reason=user');
    assert.equal(stop(stopped), undefined);
  });

  it('keeps the orchestrator going between phases unless the human is being asked', async () => {
    const root = await projectInPhase('architecture');
    assert.match(stop(root).reason, /phase "architecture" and nothing waits for the human/);
    await crew(root, 'escalate', '--kind', 'brief-review', '--question', 'Approve the brief?', '--option', 'Approve', '--option', 'Request changes');
    assert.equal(stop(root), undefined);
    await crew(root, 'escalation', 'answer', 'E-001', '--text', 'Approve');
    assert.match(stop(root).reason, /E-001 was answered by the human/);
  });

  it('blocks while tasks can move and allows it when only the human can unblock them', async () => {
    const root = await projectInPhase('tasks');
    assert.match(stop(root).reason, /no tasks exist/);
    await crew(root, 'task', 'new', '--title', 'Schema', '--owner', 'db');
    await crew(root, 'task', 'new', '--title', 'Form', '--owner', 'frontend', '--depends-on', 'T-001');
    const out = stop(root, 's2');
    assert.equal(out.decision, 'block');
    assert.match(out.reason, /^Agent Crew: tasks can still move \(ready: T-001\)/);

    await crew(root, 'escalate', '--kind', 'access', '--task', 'T-001', '--question', 'DB password?', '--option', 'Later', '--option', 'Now', '--recommended', 'Later');
    assert.equal(stop(root, 's2'), undefined, 'T-001 blocked on the human, T-002 waits for it');
  });

  it('gives up after blocking the same state twice', async () => {
    const root = await projectInPhase('tasks');
    await crew(root, 'task', 'new', '--title', 'Schema', '--owner', 'db');
    assert.equal(stop(root, 'loop').decision, 'block');
    assert.equal(stop(root, 'loop').decision, 'block');
    assert.equal(stop(root, 'loop'), undefined);
    // progress resets the counter
    await crew(root, 'task', 'start', 'T-001');
    assert.equal(stop(root, 'loop').decision, 'block');
  });

  it('sends the run to the final phase and the stop at the budget cap', async () => {
    const root = await projectInPhase('tasks');
    await crew(root, 'task', 'new', '--title', 'Schema', '--owner', 'db');
    await crew(root, 'task', 'set', 'T-001', 'status=done');
    assert.match(stop(root).reason, /all tasks are done\. Run the final phase/);
    await crew(root, 'status', 'set', 'phase=final');
    assert.match(stop(root).reason, /finish the final phase/);
    writeFileSync(path.join(root, '.crew', 'costs.log'), `${JSON.stringify({ ts: '2026-09-30T10:00:00Z', source: 'estimate', task: 'T-001', tokens: { input: 1, output: 1 }, turn_cost_usd: 25 })}\n`);
    // No cap by default: spend alone never stops a run…
    assert.match(stop(root).reason, /finish the final phase/);
    // …a cap the user (or a host) set does.
    assert.match(stopDecision({ session_id: 's1' }, root, { CREW_BUDGET_CAP_USD: '20' }).reason, /budget cap is reached/);
  });
});

describe('unrecorded result (subagents)', () => {
  it('reminds an executor once to submit or fail its task', async () => {
    const root = await projectInPhase('tasks');
    await crew(root, 'task', 'new', '--title', 'Form', '--owner', 'frontend');
    await crew(root, 'task', 'start', 'T-001');
    const out = unrecordedResult({ agent_type: 'agent-crew:frontend' }, root, env, 'T-001');
    assert.equal(out.decision, 'block');
    assert.match(out.reason, /T-001 is still in progress[\s\S]*crew task submit T-001[\s\S]*crew task fail T-001/);
    assert.equal(unrecordedResult({ agent_type: 'agent-crew:frontend', stop_hook_active: true }, root, env, 'T-001'), undefined);
    assert.equal(unrecordedResult({ agent_type: 'agent-crew:backend' }, root, env, 'T-001'), undefined, 'not its task');
    assert.equal(unrecordedResult({ agent_type: 'agent-crew:frontend' }, root, env, undefined), undefined);
    assert.equal(unrecordedResult({ agent_type: 'agent-crew:frontend' }, root, env, 'T-404'), undefined);
    await crew(root, 'task', 'submit', 'T-001');
    assert.equal(unrecordedResult({ agent_type: 'agent-crew:frontend' }, root, env, 'T-001'), undefined);
  });

  it('reminds the reviewer of the current stage to pass or reject', async () => {
    const root = await projectInPhase('tasks');
    await crew(root, 'task', 'new', '--title', 'Form', '--owner', 'frontend');
    await crew(root, 'task', 'start', 'T-001');
    await crew(root, 'task', 'submit', 'T-001');
    assert.match(unrecordedResult({ agent_type: 'agent-crew:qa' }, root, env, 'T-001').reason, /waiting for your qa decision/);
    assert.equal(unrecordedResult({ agent_type: 'agent-crew:security' }, root, env, 'T-001'), undefined);
    await crew(root, 'task', 'pass', 'T-001', '--stage', 'qa');
    assert.match(unrecordedResult({ agent_type: 'agent-crew:security' }, root, env, 'T-001').reason, /crew task pass T-001 --stage security/);
    assert.equal(unrecordedResult({ agent_type: 'agent-crew:keeper' }, root, env, 'T-001'), undefined);
  });
});
