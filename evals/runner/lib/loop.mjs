// The conversation with Claude Code for one (idea, mode) run. The plugin mode continues until the
// crew's status says done/stopped/failed: open escalations are answered with their recommended
// option (answered_by: eval) and the session is resumed; every resume counts as a human
// intervention. The baseline runs once and is resumed only if it ends with a question.

import { appendFileSync, existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import * as C from '../../../plugins/agent-crew/lib/crew-contract.mjs';
import { baselinePrompt, pluginPrompt } from './ideas.mjs';

const FINAL_PHASES = new Set(['done', 'stopped', 'failed']);

function iso(date) {
  return date.toISOString().replace(/\.\d{3}Z$/, 'Z');
}

function crewPhase(workdir) {
  const file = path.join(workdir, '.crew', 'status.md');
  return existsSync(file) ? C.readStatus(readFileSync(file, 'utf8')).value.phase : undefined;
}

export function escalationFiles(workdir) {
  const dir = path.join(workdir, '.crew', 'escalations');
  return existsSync(dir) ? readdirSync(dir).filter((n) => /^E-\d+.*\.md$/i.test(n)) : [];
}

/** Answers every open escalation with its recommended option; returns the ids answered. */
export function answerOpenEscalations(workdir, now) {
  const answered = [];
  for (const name of escalationFiles(workdir)) {
    const file = path.join(workdir, '.crew', 'escalations', name);
    const text = readFileSync(file, 'utf8');
    const e = C.readEscalation(text, name).value;
    if (e.status !== 'open') continue;
    const choice = e.recommended ?? e.options[0] ?? 'Proceed as you recommend.';
    writeFileSync(file, C.answerEscalation(text, { text: choice, by: 'eval', at: iso(now()) }));
    answered.push({ id: e.id, answer: choice });
  }
  return answered;
}

/** What to do after a plugin-mode turn ended. */
export function nextPluginStep(workdir, now) {
  const phase = crewPhase(workdir);
  if (phase && FINAL_PHASES.has(phase)) return { done: true, outcome: phase };
  const answered = answerOpenEscalations(workdir, now);
  if (answered.length) {
    return { done: false, answered, prompt: `${answered.map((a) => `${a.id}: "${a.answer}"`).join('; ')} — answered by the owner. Continue the crew run.` };
  }
  return { done: false, answered: [], prompt: 'Continue the crew run.' };
}

/** The baseline is only nudged when it stopped to ask a question nobody will answer. */
export function nextBaselineStep(result, nudges) {
  const text = String(result?.result ?? '').trim();
  if (text.endsWith('?') && nudges < 2) {
    return { done: false, answered: [], prompt: 'Nobody can answer questions in this run. Use your best judgment and finish the app and its tests.' };
  }
  return { done: true, outcome: 'done' };
}

function recordHeadlessCost(workdir, sessionId, totalUsd, now) {
  const dir = path.join(workdir, '.crew');
  if (!existsSync(dir)) return;
  mkdirSync(dir, { recursive: true });
  appendFileSync(path.join(dir, 'costs.log'), `${JSON.stringify({ ts: iso(now()), source: 'headless', session_id: sessionId, session_total_usd: totalUsd })}\n`);
}

/**
 * @param {{ mode: 'baseline' | 'plugin', idea: object, workdir: string, capUsd: number, maxRounds: number,
 *   callClaude: (o: { prompt: string, resume?: string, sessionId?: string, budgetUsd: number }) => Promise<{ result?: any, durationMs: number, timedOut: boolean }>,
 *   sessionId?: string, resume?: { sessionId: string, costUsd?: number, durationMs?: number, interventions?: number },
 *   onState?: (s: { sessionId?: string, costUsd: number, durationMs: number, interventions: number }) => void,
 *   now?: () => Date, log?: (s: string) => void }} o
 *   `sessionId` names a new conversation; `resume` continues a stopped one; `onState` is called
 *   before and after every call with what a later `resume` needs.
 */
export async function runConversation(o) {
  const now = o.now ?? (() => new Date());
  const log = o.log ?? (() => {});
  const prev = o.resume;
  const state = { sessionId: prev?.sessionId, costUsd: prev?.costUsd ?? 0, durationMs: prev?.durationMs ?? 0, rounds: 0, interventions: prev?.interventions ?? 0, answered: [], outcome: 'rounds', lastSubtype: undefined };
  const finish = () => ({ ...state, escalations: o.mode === 'plugin' ? escalationFiles(o.workdir).length : state.interventions });
  // A new conversation gets its id up front, so a call that is killed can still be continued.
  const newSessionId = prev ? undefined : o.sessionId;
  const save = () => o.onState?.({ sessionId: state.sessionId ?? newSessionId, costUsd: state.costUsd, durationMs: state.durationMs, interventions: state.interventions });

  let prompt;
  if (prev) {
    // Continuing a stopped run in the same session; the restart counts as a human intervention.
    const next = o.mode === 'plugin' ? nextPluginStep(o.workdir, now) : { done: false, answered: [], prompt: 'The run was interrupted. Continue and finish the app and its tests.' };
    if (next.done) return { ...finish(), outcome: next.outcome };
    state.answered.push(...next.answered);
    state.interventions += 1;
    prompt = next.prompt;
  } else {
    prompt = o.mode === 'plugin' ? pluginPrompt(o.idea) : baselinePrompt(o.idea);
  }

  while (state.rounds < o.maxRounds) {
    const budgetUsd = o.capUsd - state.costUsd;
    if (budgetUsd < 0.5) {
      state.outcome = 'budget';
      break;
    }
    save();
    const r = await o.callClaude({ prompt, resume: state.sessionId, sessionId: state.sessionId ? undefined : newSessionId, budgetUsd });
    state.rounds += 1;
    state.durationMs += r.durationMs;
    if (!r.result) {
      state.outcome = r.timedOut ? 'timeout' : 'error';
      break;
    }
    state.sessionId = r.result.session_id ?? state.sessionId ?? newSessionId;
    const before = state.costUsd;
    // On --resume Claude Code reports the conversation's running total.
    state.costUsd = Math.max(state.costUsd, Number(r.result.total_cost_usd ?? 0));
    state.lastSubtype = r.result.subtype;
    save();
    if (o.mode === 'plugin') recordHeadlessCost(o.workdir, state.sessionId, state.costUsd, now);
    log(`  round ${state.rounds}: ${r.result.subtype ?? 'result'}, $${state.costUsd.toFixed(2)} so far`);
    if (r.result.is_error && state.costUsd - before < 0.01 && !/budget/i.test(String(r.result.subtype ?? ''))) {
      // The model did no work: a usage limit, an expired sign-in, the API down. More rounds would fail the same way.
      state.outcome = 'error';
      state.error = String(r.result.result ?? r.result.subtype ?? '').slice(0, 300);
      log(`  stopped, Claude Code reported: ${state.error}`);
      break;
    }
    if (/budget/i.test(String(r.result.subtype ?? ''))) {
      state.outcome = 'budget';
      break;
    }
    if (r.timedOut) {
      state.outcome = 'timeout';
      break;
    }
    const next = o.mode === 'plugin' ? nextPluginStep(o.workdir, now) : nextBaselineStep(r.result, state.interventions);
    if (next.done) {
      state.outcome = next.outcome;
      break;
    }
    state.answered.push(...next.answered);
    state.interventions += 1;
    prompt = next.prompt;
  }
  save();
  return finish();
}
