#!/usr/bin/env node
// End-to-end eval runner (SPEC §11): for each idea and mode, builds the app from the stack template
// with headless Claude Code — `baseline` (no plugin) or `plugin` (agent-crew) — then runs the
// hidden acceptance tests and appends a row to evals/results/<date>.csv.
//
//   node evals/runner/run.mjs --dry-run
//   node evals/runner/run.mjs --yes [--ideas barbershop,bakery] [--modes baseline,plugin]
//        [--model claude-sonnet-5-5] [--budget 20] [--auth subscription|api-key] [--claude claude]
//        [--rounds 6] [--timeout-min 180] [--keep]
//   node evals/runner/run.mjs --yes --continue <run id> [--ideas …] [--modes …]   (a run kept with --keep)
//
// Every run calls the model and costs money or plan usage: at most ideas × modes × --budget.

import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { copyFileSync, cpSync, existsSync, mkdirSync, readdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { authProblem, authStatus, claudeArgs, claudeEnv, runClaude, stopRunning } from './lib/claude.mjs';
import { appendRow } from './lib/csv.mjs';
import { countTests, installHiddenTests, runHiddenTests } from './lib/hidden.mjs';
import { interviewFile, loadIdeas } from './lib/ideas.mjs';
import { runConversation } from './lib/loop.mjs';
import { prepareWorkspace, refreshDatabase, setupWorkspace, sh, teardownWorkspace } from './lib/workspace.mjs';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const evalsDir = path.join(repo, 'evals');
const pluginDir = path.join(repo, 'plugins', 'agent-crew');

export function parseOptions(argv) {
  const get = (name, fallback) => {
    const i = argv.indexOf(`--${name}`);
    return i >= 0 && argv[i + 1] !== undefined ? argv[i + 1] : fallback;
  };
  const list = (v) => (v ? v.split(',').map((s) => s.trim()).filter(Boolean) : undefined);
  const options = {
    ideas: list(get('ideas')),
    modes: list(get('modes')) ?? ['baseline', 'plugin'],
    model: get('model', 'claude-sonnet-5-5'),
    budget: Number(get('budget', '20')),
    auth: get('auth', 'subscription'),
    // A path is resolved now (the CLI runs inside each project folder); a bare name is looked up on PATH.
    claude: ((c) => (c.includes('/') || c.includes(path.sep) ? path.resolve(c) : c))(get('claude', 'claude')),
    rounds: Number(get('rounds', '6')),
    timeoutMin: Number(get('timeout-min', '180')),
    stack: get('stack', 'tanstack'),
    configDir: path.resolve(get('config-dir', path.join(evalsDir, '.claude-config'))),
    out: path.resolve(get('out', path.join(evalsDir, 'results'))),
    keep: argv.includes('--keep'),
    // The id of a stopped run (its folder name in results/) to pick up where it was.
    continue: get('continue'),
    yes: argv.includes('--yes'),
    dryRun: argv.includes('--dry-run'),
    skipHidden: argv.includes('--skip-hidden'),
  };
  for (const m of options.modes) if (m !== 'baseline' && m !== 'plugin') throw new Error(`--modes: unknown mode "${m}"`);
  if (options.auth !== 'subscription' && options.auth !== 'api-key') throw new Error('--auth must be subscription or api-key');
  if (!(options.budget > 0)) throw new Error('--budget must be a positive number of USD');
  if (options.continue !== undefined && !/^\d{8}T\d{6}Z$/.test(options.continue)) throw new Error('--continue takes a run id like 20261001T100746Z');
  return options;
}

function stamp(date) {
  return date.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
}

export async function main(argv, log = (s) => process.stdout.write(`${s}\n`)) {
  const o = parseOptions(argv);
  const ideas = loadIdeas(path.join(evalsDir, 'ideas'), o.ideas);
  const plan = ideas.flatMap((idea) => o.modes.map((mode) => ({ idea, mode })));
  log(`Agent Crew eval${o.continue ? `, continuing ${o.continue}` : ''}: ${plan.length} run${plan.length > 1 ? 's' : ''} (${ideas.map((i) => i.id).join(', ')} × ${o.modes.join(', ')}), model ${o.model}, up to $${o.budget} each — at most $${(o.budget * plan.length).toFixed(2)} in total.`);
  log(o.auth === 'subscription' ? `Auth: the Claude subscription signed in under ${o.configDir}; API keys in the environment are not passed on.` : 'Auth: ANTHROPIC_API_KEY with --bare.');
  if (o.dryRun) {
    for (const { idea, mode } of plan) log(`  ${idea.id} / ${mode}`);
    return 0;
  }
  if (!o.yes) {
    log('Nothing started. Every run calls the model; pass --yes to confirm the spend above (or --dry-run to see the plan).');
    return 1;
  }
  // A free check before any setup: without it every run would fail on its own, one after another.
  const status = authStatus(o.claude, claudeEnv(process.env, { mode: 'baseline', auth: o.auth, configDir: o.configDir, composeProject: 'crew-eval-auth' }));
  const problem = authProblem(status, { auth: o.auth, apiKey: Boolean(process.env.ANTHROPIC_API_KEY), bin: o.claude, configDir: o.configDir });
  if (problem) throw new Error(problem);
  if (o.auth === 'subscription') log(`Signed in: ${status.authMethod}${status.apiProvider && status.apiProvider !== 'firstParty' ? ` via ${status.apiProvider}` : ''}.`);

  // A run takes hours. On macOS hold off idle sleep while this process lives: a sleeping machine
  // freezes the run and cuts the agent call in flight. (A closed lid on battery still sleeps.)
  if (process.platform === 'darwin') {
    spawn('caffeinate', ['-i', '-w', String(process.pid)], { stdio: 'ignore', detached: true })
      .on('error', () => undefined)
      .unref();
  }

  const started = new Date();
  const runId = o.continue ?? stamp(started);
  const csvFile = path.join(o.out, `${started.toISOString().slice(0, 10)}.csv`);
  const workRoot = path.join(os.tmpdir(), 'agent-crew-eval', runId);
  if (o.continue && !existsSync(workRoot)) throw new Error(`nothing is kept for run ${runId} (${workRoot}): only a run started with --keep can be continued`);
  // The crew loads a copy of the plugin far from this repository, so no agent can wander from the
  // plugin folder into evals/hidden-tests; the plugin's own component evals stay behind too.
  // A continued run gets a fresh copy, so a fix made to the plugin in between takes effect.
  const pluginCopy = path.join(workRoot, 'plugin');
  rmSync(pluginCopy, { recursive: true, force: true });
  cpSync(pluginDir, pluginCopy, { recursive: true, filter: (src) => path.basename(src) !== 'node_modules' && !(path.basename(src) === 'evals' && path.dirname(src) === pluginDir) });
  let port = 55432;
  let browsersInstalled = false;
  // Ctrl+C or a CI timeout must not leave a database container behind.
  let current;
  const stop = (signal) => {
    stopRunning();
    if (current && !o.keep) teardownWorkspace(current);
    log(`\nStopped by ${signal}.`);
    process.exit(signal === 'SIGINT' ? 130 : 143);
  };
  process.once('SIGINT', stop);
  process.once('SIGTERM', stop);

  for (const { idea, mode } of plan) {
    const name = `${idea.id}-${mode}`;
    const workdir = path.join(workRoot, name);
    const artifacts = path.join(o.out, runId, name);
    const stateFile = path.join(artifacts, 'run-state.json');
    const callsFile = path.join(artifacts, 'claude-calls.json');
    if (o.continue && !(existsSync(workdir) && existsSync(stateFile))) {
      log(`\n▷ ${idea.id} / ${mode}: nothing to continue (no kept project or no ${path.basename(stateFile)})`);
      continue;
    }
    mkdirSync(artifacts, { recursive: true });
    const resume = o.continue ? JSON.parse(readFileSync(stateFile, 'utf8')) : undefined;
    const env = claudeEnv(process.env, { mode, auth: o.auth, configDir: o.configDir, capUsd: o.budget, composeProject: `crew-eval-${runId.toLowerCase()}-${name}` });
    const runStart = new Date();
    current = { workdir, env };
    log(`\n▶ ${idea.id} / ${mode}  (${workdir})`);
    let conversation;
    let hidden;
    try {
      if (resume) {
        log('  database up');
        sh(workdir, env, 'docker', ['compose', 'up', '-d', '--wait'], 5 * 60 * 1000);
      } else {
        prepareWorkspace({ templateDir: path.join(pluginCopy, 'templates', o.stack), workdir, dbPort: port++ });
        setupWorkspace({ workdir, env, log });
        if (!browsersInstalled) {
          sh(workdir, env, 'npx', ['playwright', 'install', 'chromium']);
          browsersInstalled = true;
        }
        if (mode === 'plugin') {
          sh(workdir, env, process.execPath, [path.join(pluginCopy, 'bin', 'crew'), 'init', '--stack', o.stack, '--language', idea.language]);
          writeFileSync(path.join(workdir, '.crew', 'interview.md'), interviewFile(idea));
        }
      }
      const calls = resume && existsSync(callsFile) ? JSON.parse(readFileSync(callsFile, 'utf8')) : [];
      conversation = await runConversation({
        mode,
        idea,
        workdir,
        capUsd: o.budget,
        maxRounds: o.rounds,
        log,
        sessionId: randomUUID(),
        resume,
        // What --continue needs, saved before and after every call: a killed call leaves no result.
        onState: (state) => writeFileSync(stateFile, `${JSON.stringify(state, null, 2)}\n`),
        callClaude: async ({ prompt, resume: session, sessionId, budgetUsd }) => {
          const args = claudeArgs({ prompt, mode, model: o.model, budgetUsd, pluginDir: pluginCopy, auth: o.auth, resume: session, sessionId, systemPromptFile: path.join(workdir, 'CLAUDE.md') });
          const r = await runClaude(o.claude, args, { cwd: workdir, env, timeoutMs: o.timeoutMin * 60 * 1000 });
          calls.push({ prompt, resume: session, code: r.code, timedOut: r.timedOut, durationMs: r.durationMs, result: r.result, stderr: r.stderr });
          writeFileSync(callsFile, JSON.stringify(calls, null, 2));
          return r;
        },
      });
      if (!o.skipHidden) {
        const source = path.join(evalsDir, 'hidden-tests', idea.id);
        log('  hidden tests');
        refreshDatabase({ workdir, env, log });
        installHiddenTests(source, workdir);
        hidden = runHiddenTests({ workdir, env, log }) ?? {
          passed: 0,
          total: countTests(source, readdirSync(source).filter((f) => f.endsWith('.spec.ts'))),
          failed: ['(the hidden tests could not run)'],
        };
        writeFileSync(path.join(artifacts, 'hidden-tests.json'), JSON.stringify(hidden, null, 2));
      }
    } catch (err) {
      log(`  run failed: ${err instanceof Error ? err.message : String(err)}`);
      conversation ??= { outcome: 'setup_failed', costUsd: 0, durationMs: 0, rounds: 0, interventions: 0, escalations: 0 };
    } finally {
      for (const f of ['.crew/report.md', '.crew/status.md', '.crew/brief.md']) {
        if (existsSync(path.join(workdir, f))) copyFileSync(path.join(workdir, f), path.join(artifacts, path.basename(f)));
      }
      if (!o.keep) {
        teardownWorkspace({ workdir, env });
        rmSync(workdir, { recursive: true, force: true });
      }
      current = undefined;
    }
    const row = {
      idea_id: idea.id,
      mode,
      hidden_tests_passed: hidden?.passed ?? '',
      hidden_tests_total: hidden?.total ?? '',
      cost_usd: conversation.costUsd.toFixed(2),
      duration_min: (conversation.durationMs / 60000).toFixed(1),
      escalations: conversation.escalations,
      human_interventions: conversation.interventions,
      model: o.model,
      outcome: conversation.outcome,
      rounds: conversation.rounds,
      run_id: runId,
      started_at: runStart.toISOString(),
    };
    appendRow(csvFile, row);
    log(`  → ${row.hidden_tests_passed}/${row.hidden_tests_total} hidden tests, $${row.cost_usd}, ${row.duration_min} min, ${row.escalations} escalations, ${row.human_interventions} interventions (${row.outcome})`);
  }
  if (!o.keep) rmSync(workRoot, { recursive: true, force: true });
  log(`\nResults: ${csvFile}${o.keep ? `\nProjects kept in ${workRoot}` : ''}`);
  return 0;
}

// Compared by real path: Node resolves symlinks for the module but not for argv.
if (process.argv[1] && existsSync(process.argv[1]) && realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url))) {
  main(process.argv.slice(2)).then(
    (code) => {
      process.exitCode = code;
    },
    (err) => {
      process.stderr.write(`eval runner: ${err instanceof Error ? err.message : String(err)}\n`);
      process.exitCode = 1;
    },
  );
}
