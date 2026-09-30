// A run's project folder: the stack template, its own database (own compose project and port),
// dependencies installed, database migrated and seeded, first commit — identical for both modes.

import { execFileSync } from 'node:child_process';
import { cpSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const SKIP = new Set(['node_modules', '.output', 'dist', 'test-results', 'playwright-report', '.tanstack', '.DS_Store']);

/** .env from .env.example, pointed at this run's database port. */
export function envFile(example, dbPort) {
  const lines = example
    .split('\n')
    .filter((l) => !/^DB_PORT=/.test(l))
    .map((l) => (l.startsWith('DATABASE_URL=') ? l.replace(/@localhost:\d+\//, `@localhost:${dbPort}/`) : l));
  return `${lines.join('\n').trimEnd()}\nDB_PORT=${dbPort}\n`;
}

export function prepareWorkspace({ templateDir, workdir, dbPort }) {
  cpSync(templateDir, workdir, { recursive: true, filter: (src) => !SKIP.has(path.basename(src)) });
  writeFileSync(path.join(workdir, '.env'), envFile(readFileSync(path.join(workdir, '.env.example'), 'utf8'), dbPort));
}

export function sh(cwd, env, cmd, args, timeoutMs = 20 * 60 * 1000) {
  return execFileSync(cmd, args, { cwd, env, stdio: ['ignore', 'pipe', 'pipe'], timeout: timeoutMs, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
}

export function setupWorkspace({ workdir, env, log }) {
  log(`  npm ci`);
  sh(workdir, env, 'npm', ['ci', '--no-audit', '--no-fund']);
  log(`  database up, migrate, seed`);
  sh(workdir, env, 'npm', ['run', 'setup']);
  sh(workdir, env, 'git', ['init', '-q']);
  sh(workdir, env, 'git', ['add', '-A']);
  sh(workdir, env, 'git', ['-c', 'user.name=Eval Runner', '-c', 'user.email=eval@agent-crew.test', 'commit', '-qm', 'chore: project template']);
}

/** Starts the database again (the crew may have stopped it) and applies the crew's migrations and seed. */
export function refreshDatabase({ workdir, env, log }) {
  for (const [cmd, args] of [
    ['docker', ['compose', 'up', '-d', '--wait']],
    ['npm', ['run', 'db:migrate']],
    ['npm', ['run', 'db:seed']],
  ]) {
    try {
      sh(workdir, env, cmd, args, 5 * 60 * 1000);
    } catch (err) {
      log(`  ${cmd} ${args.join(' ')} failed: ${String(err.stderr ?? err.message).split('\n').slice(-3).join(' ')}`);
    }
  }
}

export function teardownWorkspace({ workdir, env }) {
  if (!existsSync(path.join(workdir, 'docker-compose.yml'))) return;
  try {
    sh(workdir, env, 'docker', ['compose', 'down', '-v', '--remove-orphans'], 5 * 60 * 1000);
  } catch {
    // best effort
  }
}
