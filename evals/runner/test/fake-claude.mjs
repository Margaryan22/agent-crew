#!/usr/bin/env node
// Stand-in for `claude -p … --output-format json` in the runner's self-test: "builds" the app by
// copying the idea's reference implementation (evals/reference/<id>/) over the template. In the
// plugin mode the first turn also leaves an open escalation, so the runner has to answer it and
// resume. No model is called.
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const evals = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const argv = process.argv.slice(2);

// The runner's sign-in check; FAKE_CLAUDE_AUTH=none plays a profile nobody signed in to.
if (argv[0] === 'auth' && argv[1] === 'status') {
  const loggedIn = process.env.FAKE_CLAUDE_AUTH !== 'none';
  process.stdout.write(`${JSON.stringify({ loggedIn, authMethod: loggedIn ? 'fake' : 'none', apiProvider: 'firstParty' })}\n`);
  process.exit(loggedIn ? 0 : 1);
}

const prompt = argv[argv.indexOf('-p') + 1] ?? '';
const plugin = argv.includes('--plugin-dir');
const resume = argv.includes('--resume') ? argv[argv.indexOf('--resume') + 1] : undefined;
const cwd = process.cwd();

// Which idea: the one whose first words appear in the prompt.
const ideaId = readdirSync(path.join(evals, 'ideas'))
  .map((n) => readFileSync(path.join(evals, 'ideas', n), 'utf8'))
  .map((t) => ({ id: /^id:\s*(\S+)/m.exec(t)?.[1], first: /# Idea\s+([^\n]{20,60})/.exec(t)?.[1] }))
  .find((i) => i.first && prompt.includes(i.first.slice(0, 40)))?.id;

const crew = (rel, text) => {
  mkdirSync(path.dirname(path.join(cwd, '.crew', rel)), { recursive: true });
  writeFileSync(path.join(cwd, '.crew', rel), text);
};
const status = (phase) => crew('status.md', `---\nphase: ${phase}\nupdated_at: "${new Date().toISOString().replace(/\.\d{3}Z$/, 'Z')}"\n---\n\n# Status\n`);

if (!resume) {
  if (!ideaId) {
    process.stdout.write(`${JSON.stringify({ type: 'result', subtype: 'error_during_execution', session_id: 'fake', total_cost_usd: 0, is_error: true, result: 'unknown idea' })}\n`);
    process.exit(1);
  }
  cpSync(path.join(evals, 'reference', ideaId), cwd, { recursive: true });
  if (plugin) {
    status('tasks');
    crew(
      'escalations/E-001.md',
      `---\nid: E-001\nkind: question\nsource: plugin\nstatus: open\nquestion: Show prices with cents?\noptions: ["Yes", "No"]\nrecommended: "Yes"\ncreated_at: "2026-09-30T10:00:00Z"\n---\n\n# E-001: Show prices with cents?\n`,
    );
  }
} else if (plugin && existsSync(path.join(cwd, '.crew'))) {
  status('done');
  crew('report.md', '# Report\n\nBuilt by the fake crew.\n');
}

const calls = resume ? 2 : 1;
process.stdout.write(`${JSON.stringify({ type: 'result', subtype: 'success', is_error: false, session_id: resume ?? `fake-${ideaId}-${plugin ? 'plugin' : 'baseline'}`, total_cost_usd: calls * 1.25, num_turns: 3, duration_ms: 1000, result: 'Done.' })}\n`);
