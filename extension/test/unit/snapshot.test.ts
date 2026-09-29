import { describe, expect, it } from 'vitest';
import { EMPTY_SNAPSHOT } from '../../src/crew/model';
import { type CrewReader, loadSnapshot } from '../../src/crew/snapshot';

function reader(files: Record<string, string>): CrewReader {
  return {
    list: async (dir) =>
      Object.keys(files)
        .filter((p) => p.startsWith(`${dir}/`) && !p.slice(dir.length + 1).includes('/'))
        .map((p) => p.slice(dir.length + 1)),
    read: async (path) => files[path],
    exists: async (path) => path in files || Object.keys(files).some((p) => p.startsWith(`${path}/`)),
  };
}

describe('loadSnapshot', () => {
  it('returns the empty snapshot without .crew/', async () => {
    expect(await loadSnapshot(reader({ 'README.md': 'x' }))).toBe(EMPTY_SNAPSHOT);
  });

  it('reads tasks, escalations, decisions, costs, status and brief', async () => {
    const snapshot = await loadSnapshot(
      reader({
        '.crew/brief.md': '# Brief',
        '.crew/status.md': '---\nphase: build\n---\nBuilding.',
        '.crew/costs.log': '2026-09-26T10:00:00Z session=s1 session_total_usd=1.5\n',
        '.crew/tasks/T-010.md': '---\nstatus: done\n---\n# Ten',
        '.crew/tasks/T-002.md': '---\nstatus: todo\n---\n# Two',
        '.crew/tasks/README.md': 'ignored',
        '.crew/tasks/.hidden.md': 'ignored',
        '.crew/tasks/notes.txt': 'ignored',
        '.crew/escalations/E-001.md': 'Question?',
        '.crew/decisions/ADR-001-stack.md': '# ADR-001: Stack',
        '.crew/decisions/meeting.md': 'not an ADR',
      }),
    );
    expect(snapshot.exists).toBe(true);
    expect(snapshot.hasBrief).toBe(true);
    expect(snapshot.tasks.map((t) => t.id)).toEqual(['T-002', 'T-010']);
    expect(snapshot.escalations.map((e) => e.id)).toEqual(['E-001']);
    expect(snapshot.decisions.map((d) => d.title)).toEqual(['Stack']);
    expect(snapshot.costs).toHaveLength(1);
    expect(snapshot.status).toEqual({ phase: 'build', summary: 'Building.' });
  });

  it('skips files that disappear while reading', async () => {
    const base = reader({ '.crew/tasks/T-1.md': 'x' });
    const snapshot = await loadSnapshot({ ...base, read: async () => undefined });
    expect(snapshot.tasks).toEqual([]);
    expect(snapshot.status).toBeUndefined();
  });
});
