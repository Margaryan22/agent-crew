import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import { rows } from '../scripts/subagent-status.mjs';

const pluginRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dirs = [];
after(() => dirs.forEach((d) => rmSync(d, { recursive: true, force: true })));

function project() {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'crew-status-'));
  dirs.push(dir);
  mkdirSync(path.join(dir, '.crew', 'tasks'), { recursive: true });
  writeFileSync(path.join(dir, '.crew', 'tasks', 'T-004.md'), '---\nid: T-004\ntitle: "Booking server functions"\nstatus: in_progress\n---\n');
  return dir;
}

describe('subagent status line', () => {
  const now = Date.parse('2026-10-02T10:02:30Z');

  it('shows the role, the crew task, the state, tokens and time for crew agents', () => {
    const cwd = project();
    const input = {
      cwd,
      columns: 120,
      tasks: [
        { id: 'a1', type: 'agent-crew:backend', description: 'Work on T-004. Task: .crew/tasks/T-004.md', status: 'running', tokenCount: 23456, startTime: '2026-10-02T10:00:00Z' },
        { id: 'a2', name: 'agent-crew:critic', description: 'Critic reviews brief round 2', status: 'completed', tokenCount: 800, startTime: now - 5000 },
        { id: 'a3', type: 'Explore', description: 'look around', status: 'running' },
      ],
    };
    assert.deepEqual(rows(input, now), [
      { id: 'a1', content: 'backend · T-004 Booking server functions · working · 23k tokens · 2m' },
      { id: 'a2', content: 'critic · Critic reviews brief round 2 · done · 800 tokens · 5s' },
    ]);
    // Other agents' rows are left to Claude Code; a narrow panel clips the text.
    assert.equal(rows({ ...input, columns: 30 }, now)[0].content, 'backend · T-004 Booking serve…');
    assert.deepEqual(rows({}, now), []);
  });

  it('runs as the command settings.json names and never fails', () => {
    const settings = JSON.parse(readFileSync(path.join(pluginRoot, 'settings.json'), 'utf8'));
    assert.deepEqual(Object.keys(settings), ['subagentStatusLine']);
    assert.equal(settings.subagentStatusLine.command, 'node "${CLAUDE_PLUGIN_ROOT}/scripts/subagent-status.mjs"');
    const script = path.join(pluginRoot, 'scripts', 'subagent-status.mjs');
    const ok = spawnSync(process.execPath, [script], { input: JSON.stringify({ cwd: project(), tasks: [{ id: 'x', type: 'agent-crew:qa', description: 'Review T-004 at stage qa', status: 'running' }] }), encoding: 'utf8' });
    assert.equal(ok.status, 0);
    assert.deepEqual(JSON.parse(ok.stdout), { id: 'x', content: 'qa · T-004 Booking server functions · working' });
    const broken = spawnSync(process.execPath, [script], { input: '{not json', encoding: 'utf8' });
    assert.deepEqual([broken.status, broken.stdout], [0, '']);
  });
});
