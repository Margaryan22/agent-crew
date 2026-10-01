// Crew-session detection (decision 6 in PLAN.md): hooks act only in sessions started by a crew
// command or by a crew host. Detection must stay cheap — it runs before anything heavy loads.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

export const CREW_COMMANDS = ['new-project', 'feature', 'continue', 'fix'];

export function markerPath(root, sessionId) {
  return path.join(root, '.crew', 'sessions', `${String(sessionId).replace(/[^\w.-]/g, '_')}.json`);
}

/**
 * A crew host (eval runner, SDK) sets CREW_HOST — or EVAL_CREW_HOST under `claude plugin eval`,
 * which passes only EVAL_* variables; otherwise the session needs a marker.
 */
export function isCrewSession(input, env, root) {
  if ((env.CREW_HOST ?? env.EVAL_CREW_HOST ?? '').trim() !== '') return true;
  if (!input.session_id) return false;
  return existsSync(markerPath(root, input.session_id));
}

export function pluginName(pluginRoot) {
  try {
    return JSON.parse(readFileSync(path.join(pluginRoot, '.claude-plugin', 'plugin.json'), 'utf8')).name ?? 'agent-crew';
  } catch {
    return 'agent-crew';
  }
}

/** Does `/agent-crew:new-project` (or `/new-project` when unambiguous) start a crew session? `status` only reads, so it does not. */
export function isCrewCommand(commandName, plugin) {
  if (!commandName) return false;
  const [prefix, cmd] = commandName.includes(':') ? commandName.split(':') : [plugin, commandName];
  return prefix === plugin && CREW_COMMANDS.includes(cmd);
}

/** Writes .crew/.gitignore so markers and logs stay out of the user's commits. */
export function ensureCrewGitignore(root) {
  const file = path.join(root, '.crew', '.gitignore');
  if (existsSync(file)) {
    const text = readFileSync(file, 'utf8');
    const missing = ['logs/', 'sessions/'].filter((l) => !text.split(/\r?\n/).includes(l));
    if (missing.length) writeFileSync(file, `${text.replace(/\n*$/, '\n')}${missing.join('\n')}\n`);
    return;
  }
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, 'logs/\nsessions/\n');
}
