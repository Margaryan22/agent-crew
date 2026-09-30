import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { loadSnapshot, progress } from '../../src/crew/snapshot';
import { loadTree, memoryReader } from './memoryReader';

const golden = loadTree(path.resolve(__dirname, '../../../crew-contract/fixtures/valid'));

describe('loadSnapshot', () => {
  it('returns the empty snapshot without .crew/', async () => {
    const s = await loadSnapshot(memoryReader({ 'README.md': '#' }));
    expect(s.exists).toBe(false);
    expect(s.tasks).toEqual([]);
  });

  it('reads the golden .crew/ folder through the contract', async () => {
    const s = await loadSnapshot(memoryReader(golden));
    expect(s.exists).toBe(true);
    expect(s.initialised).toBe(true);
    expect(s.manifest).toEqual({ contractVersion: 1, stackProfile: 'tanstack', pluginVersion: '0.1.0' });
    expect(s.status?.phase).toBe('tasks');
    expect(s.tasks.map((t) => `${t.id}:${t.status}:${t.owner}`)).toEqual(['T-001:done:db', 'T-002:review:frontend', 'T-003:blocked:backend']);
    expect(s.tasks[1]?.review_stage).toBe('qa');
    expect(s.escalations.map((e) => `${e.id}:${e.status}`)).toEqual(['E-001:resolved', 'E-002:open', 'E-003:answered']);
    expect(s.decisions.map((d) => d.id)).toEqual(['ADR-001', 'ADR-002']);
    expect(s.checklist).toEqual([
      { done: true, text: 'Domain name', note: 'for the booking page' },
      { done: false, text: 'Payment provider account', note: 'to take deposits' },
    ]);
    expect(s.spend).toEqual({ usedUsd: 3.2, basis: 'reported', estimatedTokens: 228100 });
    expect(s.latestSession?.id).toBe('1b2c3d4e-0000-4000-8000-000000000001');
    expect(s.files).toEqual({ brief: true, report: true, accessChecklist: true });
    expect(s.problems).toEqual([]);
  });

  it('counts what needs the user and task progress', async () => {
    const p = progress(await loadSnapshot(memoryReader(golden)));
    expect(p).toEqual({ total: 3, done: 1, inProgress: 0, review: 1, blocked: 1, needsYou: 2 });
  });

  it('treats a .crew/ without crew.json as not initialised and falls back to estimates', async () => {
    const s = await loadSnapshot(
      memoryReader({
        '.crew/sessions/abc.json': JSON.stringify({ session_id: 'abc', command: 'agent-crew:new-project', started_at: '2026-09-30T10:00:00Z', config: { budgetCapUsd: 15 } }),
        '.crew/sessions/old.json': JSON.stringify({ session_id: 'old', command: 'agent-crew:new-project', started_at: '2026-09-29T10:00:00Z' }),
        '.crew/sessions/broken.json': '{',
        '.crew/costs.log': `${JSON.stringify({ ts: '2026-09-30T10:00:00Z', source: 'estimate', task: 'T-001', tokens: { input: 1000, output: 500 }, turn_cost_usd: 0.126 })}\n`,
      }),
    );
    expect(s.exists).toBe(true);
    expect(s.initialised).toBe(false);
    expect(s.latestSession).toEqual({ id: 'abc', command: 'agent-crew:new-project', startedAt: '2026-09-30T10:00:00Z', capUsd: 15 });
    expect(s.spend).toEqual({ usedUsd: 0.13, basis: 'estimate', estimatedTokens: 1500 });
  });

  it('reports a newer contract and files that break the contract', async () => {
    const s = await loadSnapshot(
      memoryReader({
        '.crew/crew.json': JSON.stringify({ contract_version: 2, plugin: { name: 'agent-crew', version: '9.0.0' }, stack_profile: 'tanstack', created_at: '2026-09-30T10:00:00Z', language: 'ru' }),
        '.crew/tasks/T-001.md': '---\nid: T-001\ntitle: Hand-written\nstatus: wip\n---\n',
        '.crew/tasks/README.md': '# not a task',
      }),
    );
    expect(s.manifest?.language).toBe('ru');
    expect(s.problems).toHaveLength(2);
    expect(s.problems[0]).toMatch(/newer agent-crew plugin \(contract 2\)/);
    expect(s.problems[1]).toMatch(/1 file in \.crew\/ does not match the contract/);
    expect(s.tasks).toHaveLength(1);
  });
});
