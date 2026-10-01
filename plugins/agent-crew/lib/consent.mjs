// The user's standing approval for crew sessions: asked once, kept in the plugin's own data
// folder — never in a project, where a cloned repository could bring its own "yes".
// Hand-written, shared by the hooks and the crew CLI.

import { mkdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import path from 'node:path';

export const CONSENT_FILE = 'consent.json';
/** The header of the one question; the hook finds the answer by it, whatever language the rest is in. */
export const CONSENT_HEADER = 'Crew access';
/** The options, in the order the question must list them. */
export const CONSENT_CHOICES = ['always', 'project', 'manual'];

function real(p) {
  try {
    return realpathSync(p);
  } catch {
    return path.resolve(p);
  }
}

export function readConsent(dataDir) {
  if (!dataDir) return { projects: {} };
  try {
    const json = JSON.parse(readFileSync(path.join(dataDir, CONSENT_FILE), 'utf8'));
    return { ...(json.always === 'auto' || json.always === 'manual' ? { always: json.always } : {}), projects: json.projects && typeof json.projects === 'object' ? json.projects : {} };
  } catch {
    return { projects: {} };
  }
}

/** 'auto' | 'manual' for this project, or undefined when the user has not been asked yet. */
export function consentFor(dataDir, root) {
  const store = readConsent(dataDir);
  const own = store.projects[real(root)];
  return own === 'auto' || own === 'manual' ? own : store.always;
}

/** @param {'always' | 'project' | 'manual'} choice */
export function recordConsent(dataDir, root, choice, now = new Date()) {
  const store = readConsent(dataDir);
  if (choice === 'always') store.always = 'auto';
  else if (choice === 'project') store.projects[real(root)] = 'auto';
  else store.always = 'manual';
  store.updated_at = now.toISOString();
  mkdirSync(dataDir, { recursive: true });
  writeFileSync(path.join(dataDir, CONSENT_FILE), `${JSON.stringify(store, null, 2)}\n`);
  return store;
}

export function resetConsent(dataDir) {
  mkdirSync(dataDir, { recursive: true });
  writeFileSync(path.join(dataDir, CONSENT_FILE), `${JSON.stringify({ projects: {} }, null, 2)}\n`);
}

/**
 * Which option of the "Crew access" question the user picked, from an AskUserQuestion call's
 * input and response. The response's shape is the host's business, so the chosen label is looked
 * for in its `answers` first and then anywhere in it.
 */
export function consentChoice(toolInput, toolResponse) {
  const question = (toolInput?.questions ?? []).find((q) => String(q?.header ?? '').trim().toLowerCase() === CONSENT_HEADER.toLowerCase());
  if (!question) return undefined;
  const labels = (question.options ?? []).map((o) => String(o?.label ?? ''));
  if (labels.length < CONSENT_CHOICES.length) return undefined;
  const answers = toolResponse && typeof toolResponse === 'object' ? toolResponse.answers : undefined;
  const direct = answers && typeof answers === 'object' ? answers[question.question] : undefined;
  const haystack = typeof direct === 'string' ? direct : typeof toolResponse === 'string' ? toolResponse : JSON.stringify(toolResponse ?? '');
  const hits = labels.map((label, i) => (label && haystack.includes(label) ? i : -1)).filter((i) => i >= 0 && i < CONSENT_CHOICES.length);
  // Exactly one of the three labels must be there: a free-text reply decides nothing.
  return hits.length === 1 ? CONSENT_CHOICES[hits[0]] : undefined;
}
