#!/usr/bin/env node
// Single entry point for every agent-crew hook: `node dispatch.mjs <HookEvent>`.
// Reads the hook input from stdin and prints the hook output to stdout. Outside crew sessions it
// exits immediately without loading the policy or the contract bundle.

import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { ensureCrewGitignore, isCrewCommand, isCrewSession, markerPath, pluginName } from './lib/session.mjs';

const pluginRoot = process.env.CLAUDE_PLUGIN_ROOT || process.env.PLUGIN_ROOT || path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

async function loadContract() {
  return import(pathToFileURL(path.join(pluginRoot, 'lib', 'crew-contract.mjs')).href);
}

function currentBranch(dir) {
  try {
    return execFileSync('git', ['rev-parse', '--abbrev-ref', 'HEAD'], { cwd: dir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], timeout: 5000 }).trim() || undefined;
  } catch {
    return undefined;
  }
}

function contextBlock(contract, config, root) {
  const lines = [
    'Agent Crew session. Project state lives in .crew/ (tasks, escalations, decisions, status); change it with the `crew` CLI, which writes files that match the contract.',
    `Crew config: autonomy=${config.autonomy}, stack_profile=${config.stackProfile}, budget_cap_usd=${config.budgetCapUsd}, brief_review_minutes=${config.briefReviewMinutes}, host=${config.host}.`,
  ];
  try {
    const status = contract.readStatus(readFileSync(path.join(root, '.crew', 'status.md'), 'utf8')).value;
    if (status.phase) lines.push(`Current phase: ${status.phase}${status.summary ? ` — ${status.summary}` : ''}`);
  } catch {
    // no status yet
  }
  return lines.join('\n');
}

/** @returns {Promise<object | undefined>} hook output */
export async function handle(event, input, env = process.env) {
  const root = path.resolve(env.CLAUDE_PROJECT_DIR || input.cwd || process.cwd());
  const now = new Date().toISOString();

  if (event === 'UserPromptExpansion') {
    if (!isCrewCommand(input.command_name, pluginName(pluginRoot))) return undefined;
    const contract = await loadContract();
    const marker = markerPath(root, input.session_id ?? 'unknown');
    const assistant = env.CODEX_HOME || env.PLUGIN_ROOT ? 'codex' : 'claude-code';
    const text = contract.renderSessionMarker({
      session_id: String(input.session_id ?? 'unknown'),
      command: String(input.command_name),
      started_at: now,
      assistant,
      ...(input.transcript_path ? { transcript_path: String(input.transcript_path) } : {}),
    });
    await contract.writeFileAtomic(marker, text);
    ensureCrewGitignore(root);
    const { config } = contract.resolveCrewConfig(env);
    return { hookSpecificOutput: { hookEventName: 'UserPromptExpansion', additionalContext: contextBlock(contract, config, root) } };
  }

  if (!isCrewSession(input, env, root)) return undefined;
  const contract = await loadContract();
  const { config } = contract.resolveCrewConfig(env);

  if (event === 'SessionStart') {
    return { hookSpecificOutput: { hookEventName: 'SessionStart', additionalContext: contextBlock(contract, config, root) } };
  }

  if (event === 'PreToolUse') {
    const { loadPolicy } = await import('./lib/policy.mjs');
    const { evaluatePreToolUse } = await import('./lib/rules.mjs');
    const { createRegistryChecker } = await import('./lib/registry.mjs');
    const { digest } = await import('./lib/util.mjs');
    const policy = loadPolicy(pluginRoot, config.stackProfile);
    const dataDir = env.CLAUDE_PLUGIN_DATA || env.PLUGIN_DATA;
    const checkPackage = createRegistryChecker({ packages: policy.packages, ...(dataDir ? { cacheFile: path.join(dataDir, 'registry-cache.json') } : {}) });
    const verdict = await evaluatePreToolUse(input, { root, policy, checkPackage, currentBranch });
    const logEntry = {
      ts: now,
      session_id: String(input.session_id ?? 'unknown'),
      hook: 'pre-tool-use',
      event,
      decision: verdict.decision,
      input_digest: digest(input.tool_input ?? {}),
      ...(input.tool_name ? { tool: String(input.tool_name) } : {}),
      ...(input.agent_type ? { agent_type: String(input.agent_type) } : {}),
      ...(verdict.reasons.length ? { reason: verdict.reasons.join('; ') } : {}),
    };
    await contract.appendJsonLine(path.join(root, '.crew', 'logs', 'hooks.jsonl'), logEntry).catch(() => undefined);
    if (verdict.decision === 'none') return undefined;
    const reason = verdict.decision === 'deny' ? `Blocked by the agent-crew policy: ${verdict.reasons.join('; ')}` : `agent-crew policy: ${verdict.reasons.join('; ')}`;
    return { hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: verdict.decision, permissionDecisionReason: reason } };
  }

  if (event === 'PostToolUse') {
    const { validateCrewWrite, editJournalEntries } = await import('./lib/after.mjs');
    for (const entry of editJournalEntries(input, root, now)) {
      await contract.appendJsonLine(path.join(root, '.crew', 'logs', 'edits.jsonl'), entry).catch(() => undefined);
    }
    const problem = validateCrewWrite(input, root, contract);
    return problem ? { decision: 'block', reason: problem } : undefined;
  }

  if (event === 'SubagentStop') {
    const { subagentCostEntry } = await import('./lib/after.mjs');
    const { loadPolicy } = await import('./lib/policy.mjs');
    const entry = subagentCostEntry(input, loadPolicy(pluginRoot, config.stackProfile).prices, now);
    if (entry) await contract.appendJsonLine(path.join(root, '.crew', 'costs.log'), entry).catch(() => undefined);
    return undefined;
  }

  return undefined;
}

async function main() {
  const event = process.argv[2] ?? '';
  let input = {};
  try {
    const raw = readFileSync(0, 'utf8');
    input = raw.trim() ? JSON.parse(raw) : {};
  } catch (err) {
    process.stderr.write(`agent-crew hook: invalid input: ${err instanceof Error ? err.message : String(err)}\n`);
    return;
  }
  try {
    const output = await handle(event, input);
    if (output) process.stdout.write(`${JSON.stringify(output)}\n`);
  } catch (err) {
    // Fail open: a bug in the hook must not wedge the session. The host's own permission
    // flow still applies to anything the policy would have decided.
    process.stderr.write(`agent-crew hook ${event} failed: ${err instanceof Error ? err.stack : String(err)}\n`);
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
