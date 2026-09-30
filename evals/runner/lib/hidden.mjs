// The hidden acceptance tests (evals/hidden-tests/<idea>/): copied into the project only after the
// crew finished, run with their own Playwright config against the project's dev server.

import { cpSync, existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { sh } from './workspace.mjs';

export const HIDDEN_DIR = 'e2e-hidden';
export const HIDDEN_CONFIG = 'playwright.hidden.config.ts';
const REPORT = 'hidden-results.json';

export const hiddenConfig = `import { defineConfig, devices } from '@playwright/test'

// Written by the eval runner: runs the hidden acceptance tests in ${HIDDEN_DIR}/.
export default defineConfig({
  testDir: './${HIDDEN_DIR}',
  timeout: 60_000,
  expect: { timeout: 10_000 },
  retries: 0,
  workers: 1,
  reporter: [['json', { outputFile: '${REPORT}' }]],
  use: { baseURL: 'http://localhost:3000', trace: 'off' },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  // A production build: no dev-server dependency re-optimization reloading pages mid-test.
  webServer: { command: 'npm run build && npm run preview', url: 'http://localhost:3000', reuseExistingServer: false, timeout: 300_000 },
})
`;

export function installHiddenTests(sourceDir, workdir) {
  const target = path.join(workdir, HIDDEN_DIR);
  rmSync(target, { recursive: true, force: true });
  cpSync(sourceDir, target, { recursive: true });
  writeFileSync(path.join(workdir, HIDDEN_CONFIG), hiddenConfig);
}

/** Counts from a Playwright JSON report. Tests that did not run count as failed. */
export function summarize(report) {
  const s = report?.stats ?? {};
  const passed = (s.expected ?? 0) + (s.flaky ?? 0);
  const total = passed + (s.unexpected ?? 0) + (s.skipped ?? 0);
  const failed = [];
  const walk = (suite, prefix) => {
    for (const spec of suite.specs ?? []) {
      for (const t of spec.tests ?? []) {
        if (t.status !== 'expected' && t.status !== 'flaky') failed.push(`${prefix}${spec.title}`);
      }
    }
    for (const child of suite.suites ?? []) walk(child, `${prefix}${child.title ? `${child.title} › ` : ''}`);
  };
  for (const suite of report?.suites ?? []) walk(suite, '');
  return { passed, total, failed };
}

/** Counts the hidden tests of an idea by scanning their files (the denominator when nothing ran). */
export function countTests(sourceDir, files) {
  return files.reduce((n, f) => n + (readFileSync(path.join(sourceDir, f), 'utf8').match(/^test\(/gm) ?? []).length, 0);
}

export function runHiddenTests({ workdir, env, log }) {
  try {
    sh(workdir, env, 'npx', ['playwright', 'test', '-c', HIDDEN_CONFIG], 30 * 60 * 1000);
  } catch (err) {
    // Playwright exits non-zero when tests fail; the report still has the counts.
    if (!existsSync(path.join(workdir, REPORT))) log(`  hidden tests did not run: ${String(err.stderr ?? err.message).split('\n').slice(-5).join(' ')}`);
  }
  const file = path.join(workdir, REPORT);
  return existsSync(file) ? summarize(JSON.parse(readFileSync(file, 'utf8'))) : undefined;
}
