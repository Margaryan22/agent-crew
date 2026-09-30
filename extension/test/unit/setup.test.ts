import { describe, expect, it } from 'vitest';
import { checkTools, type Exec, nodeMajor } from '../../src/setup';

function fakeExec(results: Record<string, { ok: boolean; stdout: string }>): Exec {
  return (command, args) => Promise.resolve(results[`${command} ${args[0]}`] ?? { ok: false, stdout: '' });
}

describe('setup check', () => {
  it('parses Node versions', () => {
    expect(nodeMajor('v24.21.0\n')).toBe(24);
    expect(nodeMajor('22.1.0')).toBe(22);
    expect(nodeMajor('nope')).toBeUndefined();
  });

  it('passes when every tool is there', async () => {
    const checks = await checkTools(
      fakeExec({
        'node --version': { ok: true, stdout: 'v22.12.0\n' },
        'git --version': { ok: true, stdout: 'git version 2.50.0\n' },
        'docker --version': { ok: true, stdout: 'Docker version 29.4.0\n' },
        'docker info': { ok: true, stdout: '29.4.0\n' },
      }),
    );
    expect(checks.map((c) => [c.name, c.ok])).toEqual([
      ['Node.js', true],
      ['git', true],
      ['Docker', true],
    ]);
  });

  it('explains what is missing', async () => {
    const checks = await checkTools(
      fakeExec({
        'node --version': { ok: true, stdout: 'v20.11.0' },
        'docker --version': { ok: true, stdout: 'Docker version 29.4.0' },
      }),
    );
    expect(checks.map((c) => `${c.name}:${c.ok}:${c.detail}`)).toEqual(['Node.js:false:v20.11.0 is too old', 'git:false:not found', 'Docker:false:Docker version 29.4.0, but the engine is not running']);
    expect(checks.every((c) => c.fix)).toBe(true);
    const none = await checkTools(fakeExec({}));
    expect(none.map((c) => c.detail)).toEqual(['not found', 'not found', 'not found']);
  });
});
