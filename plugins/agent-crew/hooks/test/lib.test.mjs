import assert from 'node:assert/strict';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { describe, it } from 'node:test';
import { estimateUsd, priceFor, transcriptUsage } from '../scripts/lib/after.mjs';
import { hostAllowed, mergePolicy, roleOf, zonesFor } from '../scripts/lib/policy.mjs';
import { createRegistryChecker } from '../scripts/lib/registry.mjs';
import { ensureCrewGitignore, isCrewCommand } from '../scripts/lib/session.mjs';
import { globToRegExp, isEnvSecretFile, looksLikeSecret, matchesAny, secretKeysIn } from '../scripts/lib/util.mjs';
import { policy, tempDir } from './helpers.mjs';

const DAY = 24 * 60 * 60 * 1000;
const NOW = Date.parse('2026-09-29T12:00:00Z');

function fakeFetch(routes) {
  const calls = [];
  const fetch = async (url) => {
    calls.push(url);
    const r = routes[url];
    if (r instanceof Error) throw r;
    if (r === undefined) return { status: 404, ok: false, json: async () => ({}) };
    if (typeof r === 'number') return { status: r, ok: false, json: async () => ({}) };
    return { status: 200, ok: true, json: async () => r };
  };
  return { fetch, calls };
}

const REG = 'https://registry.npmjs.org';
const DL = 'https://api.npmjs.org/downloads/point/last-week';
const created = (days) => ({ time: { created: new Date(NOW - days * DAY).toISOString() } });

describe('registry checker', () => {
  it('passes old, popular packages and encodes scoped names', async () => {
    const { fetch, calls } = fakeFetch({ [`${REG}/@acme%2Fwidgets`]: created(400), [`${DL}/@acme%2Fwidgets`]: { downloads: 5000 } });
    const check = createRegistryChecker({ fetch, now: () => NOW, packages: policy.packages });
    assert.deepEqual(await check('@acme/widgets'), { ok: true });
    assert.deepEqual(calls, [`${REG}/@acme%2Fwidgets`, `${DL}/@acme%2Fwidgets`]);
  });

  it('rejects missing, new, unpopular and undated packages', async () => {
    const { fetch } = fakeFetch({
      [`${REG}/fresh`]: created(5),
      [`${REG}/quiet`]: created(400),
      [`${DL}/quiet`]: { downloads: 10 },
      [`${REG}/undated`]: {},
    });
    const check = createRegistryChecker({ fetch, now: () => NOW, packages: policy.packages });
    assert.match((await check('missing')).reason, /does not exist/);
    assert.match((await check('fresh')).reason, /only 5 day\(s\) old \(minimum 30\)/);
    assert.match((await check('quiet')).reason, /10 weekly downloads \(minimum 1000\)/);
    assert.match((await check('undated')).reason, /only 0 day/);
  });

  it('fails closed on network errors and does not cache them', async () => {
    const routes = { [`${REG}/flaky`]: new Error('ECONNRESET') };
    const { fetch, calls } = fakeFetch(routes);
    const check = createRegistryChecker({ fetch, now: () => NOW, packages: policy.packages });
    assert.match((await check('flaky')).reason, /could not verify package "flaky".*ECONNRESET/);
    routes[`${REG}/flaky`] = 503;
    assert.match((await check('flaky')).reason, /HTTP 503/);
    assert.equal(calls.length, 2);
  });

  it('caches passes for a day and failures for an hour, on disk', async () => {
    const cacheFile = path.join(tempDir('crew-reg-'), 'sub', 'cache.json');
    const { fetch, calls } = fakeFetch({ [`${REG}/good`]: created(400), [`${DL}/good`]: { downloads: 5000 }, [`${REG}/fresh`]: created(1) });
    let now = NOW;
    const make = () => createRegistryChecker({ fetch, cacheFile, now: () => now, packages: policy.packages });
    const first = make();
    await first('good');
    await first('fresh');
    assert.equal(calls.length, 3);
    assert.ok(JSON.parse(readFileSync(cacheFile, 'utf8')).good.ok);

    now = NOW + 2 * 60 * 60 * 1000; // +2h: the failure expired, the pass did not
    const second = make();
    assert.deepEqual(await second('good'), { ok: true });
    assert.equal((await second('fresh')).ok, false);
    assert.equal(calls.length, 4);

    now = NOW + 25 * 60 * 60 * 1000;
    await make()('good');
    assert.equal(calls.length, 6);
  });
});

describe('policy', () => {
  it('merges the stack profile on top of the core policy', () => {
    const merged = mergePolicy(
      { protectedBranches: ['main'], network: { allowHosts: ['a'] }, packages: { minAgeDays: 30, allow: ['x'] }, zones: { frontend: ['a/**'] }, safeCommands: [['ls']], prices: {} },
      { network: { allowHosts: ['b'] }, packages: { allow: ['y'] }, zones: { frontend: ['b/**'], qa: ['e2e/**'] }, safeCommands: [['make']] },
    );
    assert.deepEqual(merged.network.allowHosts, ['a', 'b']);
    assert.deepEqual(merged.packages, { minAgeDays: 30, allow: ['x', 'y'] });
    assert.deepEqual(merged.zones, { frontend: ['a/**', 'b/**'], qa: ['e2e/**'] });
    assert.deepEqual(merged.safeCommands, [['ls'], ['make']]);
  });

  it('maps agent types to roles', () => {
    assert.equal(roleOf(undefined, policy), 'orchestrator');
    assert.equal(roleOf('agent-crew:frontend', policy), 'frontend');
    assert.equal(roleOf('frontend', policy), 'frontend');
    assert.equal(roleOf('other-plugin:frontend', policy), 'orchestrator');
    assert.equal(roleOf('agent-crew:*', policy), 'orchestrator');
    assert.equal(roleOf('agent-crew:constructor', policy), 'orchestrator');
    assert.equal(roleOf('general-purpose', policy), 'orchestrator');
    assert.ok(zonesFor('qa', policy).includes('.crew/tasks/**'));
  });

  it('matches hosts with wildcards', () => {
    const p = { network: { allowHosts: ['localhost', '*.example.com'] } };
    assert.ok(hostAllowed('LOCALHOST', p));
    assert.ok(hostAllowed('api.example.com', p));
    assert.ok(hostAllowed('example.com', p));
    assert.ok(!hostAllowed('evilexample.com', p));
  });

  it('adds missing lines to an existing .crew/.gitignore without duplicating', () => {
    const root = tempDir('crew-gi-');
    mkdirSync(path.join(root, '.crew'));
    writeFileSync(path.join(root, '.crew', '.gitignore'), 'tmp/\nlogs/');
    ensureCrewGitignore(root);
    ensureCrewGitignore(root);
    assert.equal(readFileSync(path.join(root, '.crew', '.gitignore'), 'utf8'), 'tmp/\nlogs/\nsessions/\n');
  });

  it('knows every crew command', () => {
    assert.ok(isCrewCommand('agent-crew:new-project', 'agent-crew'));
    assert.ok(isCrewCommand('feature', 'agent-crew'));
    assert.ok(!isCrewCommand('agent-crew:status', 'agent-crew'));
    assert.ok(!isCrewCommand(undefined, 'agent-crew'));
  });
});

describe('globs', () => {
  it('translates *, ** and ?', () => {
    assert.ok(matchesAny('src/routes/a/b.tsx', ['src/routes/**']));
    assert.ok(matchesAny('src/routes', ['src/routes/**']) === false);
    assert.ok(matchesAny('a.ts', ['**/*.ts']));
    assert.ok(matchesAny('x/y/a.ts', ['**/*.ts']));
    assert.ok(!matchesAny('src/a/b.ts', ['src/*.ts']));
    assert.ok(globToRegExp('T-00?.md').test('T-001.md'));
    assert.ok(!globToRegExp('a.b').test('axb'));
  });
});

describe('secrets', () => {
  it('knows which files are .env files', () => {
    for (const f of ['.env', '.env.local', 'apps/web/.env.production', '.ENV']) assert.ok(isEnvSecretFile(f), f);
    for (const f of ['.env.example', '.env.sample', '.env.template', 'env.ts', '.envrc']) assert.ok(!isEnvSecretFile(f), f);
  });

  it('tells secrets from placeholders', () => {
    const secrets = ['sk-ant-api03-abcdefghijklmnopqrstuv', 'sk_live_51Habcdefghijk', 'ghp_abcdefghijklmnopqrstuvwxyz', 'AKIAABCDEFGHIJKLMNOP', 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0In0.sig', '-----BEGIN RSA PRIVATE KEY-----', 'redis://user:hunter22222@cache.example.com:6379', '"Zx8#qP2!mL9$vR4@tK7&wN1*bH5"'];
    const fine = ['', '<your-key>', '${STRIPE_KEY}', 'changeme', 'your_api_key_here', 'xxxxxxxx', '3000', 'true', 'postgres://postgres:postgres@localhost:5432/app', 'postgresql://app:app@db:5432/app', 'http://localhost:3000', 'development', 'a-perfectly-normal-sentence-of-words', "'placeholder'  # set me"];
    for (const s of secrets) assert.ok(looksLikeSecret(s), s);
    for (const s of fine) assert.ok(!looksLikeSecret(s), s);
  });

  it('reports the keys that carry secrets', () => {
    assert.deepEqual(secretKeysIn('# comment\nexport A=sk_live_51Habcdefghijk\nB=changeme\r\nC = AKIAABCDEFGHIJKLMNOP\nnot a line'), ['A', 'C']);
  });
});

describe('cost estimates', () => {
  it('resolves model aliases and dated ids to prices', () => {
    assert.equal(priceFor('sonnet', policy.prices).id, 'claude-sonnet-5-5');
    assert.equal(priceFor('claude-opus-5-5[1m]', policy.prices).id, 'claude-opus-5-5');
    assert.equal(priceFor('claude-haiku-4-5-20251001', policy.prices).input, 1);
    assert.equal(priceFor('gpt-5', policy.prices), undefined);
    assert.equal(priceFor(undefined, policy.prices), undefined);
    assert.equal(estimateUsd({ input: 1, output: 1, cache_read: 0, cache_write: 0 }, undefined), undefined);
  });

  it('reads usage from transcripts with string and block content', () => {
    const text = [
      '{bad json',
      JSON.stringify({ type: 'user', message: { content: [{ type: 'text', text: 'Task T-012 please' }] } }),
      JSON.stringify({ type: 'assistant', message: { model: 'claude-haiku-4-5', usage: { input_tokens: 5, output_tokens: 7 } } }),
      '',
    ].join('\n');
    assert.deepEqual(transcriptUsage(text), { tokens: { input: 5, output: 7, cache_read: 0, cache_write: 0 }, model: 'claude-haiku-4-5', task: 'T-012', messages: 1 });
  });
});
