// The golden fixture tree must stay valid: plugin and extension tests read the same files.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { artefactKind, readDecision, readEscalation, readStatus, readTask, validateCrewFile } from '../src/index';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'fixtures', 'valid');

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = path.join(dir, name);
    return statSync(full).isDirectory() ? walk(full) : [full];
  });
}

const files = walk(path.join(root, '.crew')).map((full) => path.relative(root, full).split(path.sep).join('/'));

describe('fixtures/valid', () => {
  it('covers every artefact kind', () => {
    const kinds = new Set(files.map((f) => artefactKind(f)));
    for (const kind of ['task', 'escalation', 'decision', 'status', 'brief', 'brief-review', 'manifest', 'session-marker', 'costs', 'hooks-log', 'edits-log', 'free-text']) {
      expect(kinds.has(kind as never), kind).toBe(true);
    }
  });

  it.each(files)('%s passes strict validation', (rel) => {
    const result = validateCrewFile(rel, readFileSync(path.join(root, rel), 'utf8'));
    expect(result?.issues).toEqual([]);
    expect(result?.ok).toBe(true);
  });

  it('lenient readers report no issues on valid files', () => {
    for (const rel of files) {
      const text = readFileSync(path.join(root, rel), 'utf8');
      const kind = artefactKind(rel);
      const issues =
        kind === 'task' ? readTask(text, rel).issues : kind === 'escalation' ? readEscalation(text, rel).issues : kind === 'decision' ? readDecision(text, rel).issues : kind === 'status' ? readStatus(text).issues : [];
      expect(issues, rel).toEqual([]);
    }
  });
});
