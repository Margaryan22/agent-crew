// One headless Claude Code call, the same way for both modes: same model, permission mode, tool
// grants and budget; the plugin mode only adds --plugin-dir and CREW_HOST.

import { spawn } from 'node:child_process';

/** Tools both modes may use without a prompt (nothing else is approved in an unattended run). */
export const ALLOWED_TOOLS = [
  'Read',
  'Write',
  'Edit',
  'MultiEdit',
  'Glob',
  'Grep',
  'Agent',
  'Skill',
  'TodoWrite',
  'WebFetch',
  'WebSearch',
  'Bash(npm *)',
  'Bash(npx *)',
  'Bash(node *)',
  'Bash(git *)',
  'Bash(docker compose *)',
  'Bash(ls *)',
  'Bash(cat *)',
  'Bash(mkdir *)',
  'Bash(cp *)',
  'Bash(mv *)',
  'Bash(crew *)',
  'Bash(curl *)',
];

/**
 * @param {{ prompt: string, mode: 'baseline' | 'plugin', model: string, budgetUsd: number, pluginDir: string, auth: 'subscription' | 'api-key', resume?: string, systemPromptFile?: string }} o
 */
export function claudeArgs(o) {
  const args = ['-p', o.prompt, '--output-format', 'json', '--model', o.model, '--max-budget-usd', o.budgetUsd.toFixed(2), '--permission-mode', 'acceptEdits', '--permission-prompts', 'none', '--allowedTools', ALLOWED_TOOLS.join(',')];
  if (o.mode === 'plugin') args.push('--plugin-dir', o.pluginDir);
  if (o.auth === 'api-key') {
    // --bare skips CLAUDE.md discovery (and the user's settings): hand the project's CLAUDE.md to both modes explicitly.
    args.push('--bare');
    if (o.systemPromptFile) args.push('--append-system-prompt-file', o.systemPromptFile);
  }
  if (o.resume) args.push('--resume', o.resume);
  return args;
}

/**
 * Environment for the child: the caller's, without variables that would make it think it runs
 * inside another Claude Code session, plus the crew's host settings.
 * @param {NodeJS.ProcessEnv} base
 */
export function claudeEnv(base, o) {
  const env = {};
  for (const [k, v] of Object.entries(base)) {
    if (k === 'CLAUDECODE' || k.startsWith('CLAUDE_CODE_') || k.startsWith('CREW_') || k === 'CLAUDE_CONFIG_DIR') continue;
    env[k] = v;
  }
  if (o.auth === 'subscription') env.CLAUDE_CONFIG_DIR = o.configDir;
  if (o.mode === 'plugin') {
    env.CREW_HOST = 'eval';
    env.CREW_BUDGET_CAP_USD = String(o.capUsd);
  }
  env.COMPOSE_PROJECT_NAME = o.composeProject;
  // Background subagents may idle a while; let -p wait for them.
  env.CLAUDE_CODE_PRINT_BG_WAIT_CEILING_MS = String(30 * 60 * 1000);
  return env;
}

/** The result object Claude Code prints last with --output-format json. */
export function parseResult(stdout) {
  const text = stdout.trim();
  const start = text.lastIndexOf('\n{');
  const candidates = [text, start >= 0 ? text.slice(start + 1) : ''];
  for (const c of candidates) {
    try {
      const value = JSON.parse(c);
      if (value && typeof value === 'object' && 'session_id' in value) return value;
    } catch {
      // try the next candidate
    }
  }
  return undefined;
}

/**
 * Runs the Claude Code CLI and resolves with its parsed result.
 * @returns {Promise<{ result?: object, code: number | null, stderr: string, durationMs: number, timedOut: boolean }>}
 */
export function runClaude(bin, args, { cwd, env, timeoutMs }) {
  return new Promise((resolve) => {
    const started = Date.now();
    const child = spawn(bin, args, { cwd, env, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    let timedOut = false;
    child.stdout.on('data', (d) => (stdout += d));
    child.stderr.on('data', (d) => (stderr += d));
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill('SIGINT'); // ends the turn cleanly; SIGTERM if it hangs
      setTimeout(() => child.kill('SIGTERM'), 30_000).unref();
    }, timeoutMs);
    child.on('close', (code) => {
      clearTimeout(timer);
      resolve({ result: parseResult(stdout), code, stderr: stderr.slice(-4000), durationMs: Date.now() - started, timedOut, stdout: stdout.slice(-20000) });
    });
    child.on('error', (err) => {
      clearTimeout(timer);
      resolve({ result: undefined, code: null, stderr: String(err), durationMs: Date.now() - started, timedOut, stdout });
    });
  });
}
