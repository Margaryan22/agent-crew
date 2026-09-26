import { afterEach, describe, expect, it, vi } from 'vitest';
import { BRIEF_APPROVE, EscalationCancelled, type EscalationDeps, EscalationService, type LiveEscalation } from '../../src/crew/escalations';
import { parseEscalation } from '../../src/crew/parser';
import { tick } from './fakes';

function setup(overrides: Partial<EscalationDeps> = {}) {
  const files = new Map<string, string>();
  const sent: string[] = [];
  let sessionRunning = true;
  const deps: EscalationDeps = {
    readFile: (p) => Promise.resolve(files.get(p)),
    writeFile: (p, c) => {
      files.set(p, c);
      return Promise.resolve();
    },
    sendToSession: (text) => {
      if (!sessionRunning) return false;
      sent.push(text);
      return true;
    },
    autonomy: () => 'full',
    briefReviewMs: () => 60_000,
    now: () => new Date('2026-09-26T10:00:00Z'),
    log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
    ...overrides,
  };
  const service = new EscalationService(deps);
  const raised: LiveEscalation[] = [];
  const changed: LiveEscalation[] = [];
  service.onRaised((e) => raised.push({ ...e }));
  service.onChanged((e) => changed.push({ ...e }));
  return { service, files, sent, raised, changed, stopSession: () => (sessionRunning = false), deps };
}

afterEach(() => {
  vi.useRealTimers();
});

describe('EscalationService', () => {
  it('raises a live escalation, records it and resolves with the answer', async () => {
    const { service, files, raised, changed } = setup();
    const pending = service.raise({ kind: 'question', title: 'DB?', question: 'Which database?', options: ['Postgres', 'SQLite'], agent: 'architect', task: 'T-1' });
    await tick();
    expect(raised).toHaveLength(1);
    expect(raised[0]).toMatchObject({ id: 'E-001', status: 'open', agent: 'architect', task: 'T-1' });
    expect(parseEscalation(files.get('.crew/escalations/E-001.md')!, 'E-001.md')).toMatchObject({ status: 'open', options: ['Postgres', 'SQLite'] });

    expect(await service.answer('E-001', ' Postgres ')).toBe('delivered');
    expect(await pending).toBe('Postgres');
    expect(parseEscalation(files.get('.crew/escalations/E-001.md')!, 'E-001.md')).toMatchObject({ status: 'answered', answer: 'Postgres' });
    expect(changed.at(-1)).toMatchObject({ status: 'answered' });
    expect(await service.answer('E-001', 'SQLite')).toBe('closed');
    expect(await service.answer('E-404', 'x')).toBe('unknown');
  });

  it('surfaces plugin-written escalations once and sends answers into the session', async () => {
    const { service, raised, sent, files } = setup();
    const esc = parseEscalation('---\nid: E-003\noptions: [A, B]\n---\n# Pick one\n\nA or B?', '.crew/escalations/E-003.md');
    files.set('.crew/escalations/E-003.md', '---\nid: E-003\noptions: [A, B]\n---\n# Pick one\n\nA or B?');
    service.syncFromSnapshot([esc]);
    service.syncFromSnapshot([esc]);
    expect(raised.map((e) => e.id)).toEqual(['E-003']);
    expect(await service.answer('E-003', 'B')).toBe('delivered');
    expect(sent[0]).toContain('Answer to escalation E-003 (Pick one): B');
    expect(files.get('.crew/escalations/E-003.md')).toContain('## Answer\n\nB');
    expect(service.open()).toEqual([]);
  });

  it('records the answer when no session is running', async () => {
    const { service, stopSession } = setup();
    service.syncFromSnapshot([parseEscalation('Question?', '.crew/escalations/E-001.md')]);
    stopSession();
    expect(await service.answer('E-001', 'yes')).toBe('recorded');
  });

  it('follows status changes made by the plugin and skips closed ones', () => {
    const { service, raised, changed } = setup();
    const open = parseEscalation('---\nid: E-1\n---\nQ?', 'E-1.md');
    service.syncFromSnapshot([open, parseEscalation('---\nid: E-2\nstatus: resolved\n---\nQ?', 'E-2.md')]);
    expect(raised.map((e) => e.id)).toEqual(['E-1']);
    service.syncFromSnapshot([{ ...open, status: 'resolved' }]);
    expect(changed.at(-1)).toMatchObject({ id: 'E-1', status: 'resolved' });
    expect(service.get('E-1')?.status).toBe('resolved');
  });

  it('cancels pending escalations when the session ends or the signal aborts', async () => {
    const { service, files, changed } = setup();
    const first = service.raise({ kind: 'permission', title: 'Bash', question: 'Run?', options: ['Allow', 'Deny'] });
    await tick();
    service.cancelPending('Session ended');
    await expect(first).rejects.toBeInstanceOf(EscalationCancelled);
    await tick();
    expect(parseEscalation(files.get('.crew/escalations/E-001.md')!, 'x.md').status).toBe('cancelled');
    expect(changed.at(-1)).toMatchObject({ status: 'cancelled' });

    const controller = new AbortController();
    const second = service.raise({ kind: 'question', title: 'Q', question: 'Q?', options: [] }, controller.signal);
    await tick();
    controller.abort();
    await expect(second).rejects.toBeInstanceOf(EscalationCancelled);

    const aborted = new AbortController();
    aborted.abort();
    await expect(service.raise({ kind: 'question', title: 'Q', question: 'Q?', options: [] }, aborted.signal)).rejects.toBeInstanceOf(EscalationCancelled);
  });

  it('skips ids already taken on disk', async () => {
    const { service, files } = setup();
    files.set('.crew/escalations/E-001.md', 'taken');
    void service.raise({ kind: 'question', title: 'Q', question: 'Q?', options: [] });
    await tick();
    expect(files.has('.crew/escalations/E-002.md')).toBe(true);
  });

  it('auto-approves brief reviews in full autonomy', async () => {
    const { service, sent } = setup({ autonomy: () => 'full' });
    service.syncFromSnapshot([parseEscalation('---\nid: E-7\nkind: brief-review\noptions: [Approve, Request changes]\n---\nBrief ready', 'E-7.md')]);
    await tick();
    expect(service.get('E-7')).toMatchObject({ status: 'answered', answer: `${BRIEF_APPROVE} (autonomy: full)` });
    expect(sent[0]).toContain('Approve');
  });

  it('waits for the brief review in review autonomy and continues automatically', async () => {
    vi.useFakeTimers();
    const { service, raised, sent } = setup({ autonomy: () => 'review', briefReviewMs: () => 10 * 60_000 });
    service.syncFromSnapshot([parseEscalation('---\nid: E-8\nkind: brief-review\n---\nBrief ready', 'E-8.md')]);
    expect(raised[0]).toMatchObject({ id: 'E-8', autoContinueAt: Date.parse('2026-09-26T10:10:00Z') });
    expect(service.get('E-8')?.status).toBe('open');
    await vi.advanceTimersByTimeAsync(10 * 60_000);
    expect(service.get('E-8')?.answer).toBe('Approve (auto-approved after 10 min without a reply)');
    expect(sent).toHaveLength(1);
  });

  it('an explicit brief answer cancels the auto-continue timer', async () => {
    vi.useFakeTimers();
    const { service, sent } = setup({ autonomy: () => 'review' });
    service.syncFromSnapshot([parseEscalation('---\nid: E-9\nkind: brief-review\n---\nBrief', 'E-9.md')]);
    await service.answer('E-9', 'Request changes: add auth');
    await vi.advanceTimersByTimeAsync(120_000);
    expect(sent).toHaveLength(1);
    expect(service.get('E-9')?.answer).toBe('Request changes: add auth');
    service.dispose();
  });

  it('keeps working when the file cannot be written and survives throwing listeners', async () => {
    const { service, deps } = setup({ writeFile: () => Promise.reject(new Error('read-only')) });
    service.onRaised(() => {
      throw new Error('listener bug');
    });
    const pending = service.raise({ kind: 'question', title: 'Q', question: 'Q?', options: [] });
    await tick();
    expect(await service.answer('E-001', 'ok')).toBe('delivered');
    expect(await pending).toBe('ok');
    expect(deps.log.warn).toHaveBeenCalled();
    expect(deps.log.error).toHaveBeenCalled();
  });
});
