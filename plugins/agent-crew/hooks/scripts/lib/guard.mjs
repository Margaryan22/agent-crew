// Guards that keep an autonomous crew run moving (SPEC §12: the run reaches the final report
// without a human): the orchestrator may not end its turn while work can still progress, and
// executors and reviewers may not finish without recording their result in .crew/.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { Project } from '../../../cli/project.mjs';
import { checkProject, nextData } from '../../../cli/report.mjs';
import { digest } from './util.mjs';

/** Phases in which ending the turn is expected (the interview waits for answers). */
const RESTING_PHASES = new Set(['interview', 'done', 'stopped', 'failed']);
const BEFORE_TASKS = new Set(['brief', 'architecture', 'acceptance_tests', 'decomposition']);
/** How many times the same state may block a stop before the guard gives up (no endless loops). */
const MAX_BLOCKS_PER_STATE = 2;

const ids = (tasks) => tasks.map((t) => t.id).join(', ');

function readJson(file) {
  try {
    return JSON.parse(readFileSync(file, 'utf8'));
  } catch {
    return {};
  }
}

function writeJson(file, value) {
  try {
    mkdirSync(path.dirname(file), { recursive: true });
    writeFileSync(file, `${JSON.stringify(value)}\n`);
  } catch {
    // the guard state is best effort
  }
}

/** Why the orchestrator should keep going, or undefined when stopping is fine. */
export function pendingWork(project, phase) {
  if (!phase || RESTING_PHASES.has(phase)) return undefined;
  const escalations = project.escalations();
  const open = escalations.filter((e) => e.data.status === 'open');
  const answered = escalations.filter((e) => e.data.status === 'answered');
  if (checkProject(project).some((f) => f.kind === 'budget_cap')) {
    return 'the budget cap is reached. Stop the run properly: crew status set phase=stopped stop_reason=budget_cap --summary "…", write .crew/report.md with what is done and what is left, then finish.';
  }
  if (answered.length) return `${answered.map((e) => e.id).join(', ')} ${answered.length > 1 ? 'were' : 'was'} answered by the human. Act on the answers (crew check) and continue.`;
  if (BEFORE_TASKS.has(phase)) {
    return open.length ? undefined : `the run is in phase "${phase}" and nothing waits for the human. Continue with the next step of the orchestration skill.`;
  }
  const n = nextData(project);
  if (phase === 'tasks') {
    if (n.ready.length || n.review.length || n.in_progress.length) {
      const parts = [n.ready.length && `ready: ${ids(n.ready)}`, n.review.length && `in review: ${ids(n.review)}`, n.in_progress.length && `in progress: ${ids(n.in_progress)}`].filter(Boolean);
      return `tasks can still move (${parts.join('; ')}). Continue the task loop: crew check, then crew next.`;
    }
    if (!n.tasks.length) return 'the phase is "tasks" but no tasks exist. Decompose the work with crew task new.';
    if (n.done === n.tasks.length) return 'all tasks are done. Run the final phase: final QA, .crew/report.md, then crew status set phase=done.';
    return undefined; // everything left waits for the human (or on blocked tasks)
  }
  if (phase === 'final') return 'finish the final phase: .crew/report.md, then crew status set phase=done.';
  return undefined;
}

/** Stop hook of the main session. */
export function stopDecision(input, root, env) {
  if (!existsSync(path.join(root, '.crew'))) return undefined;
  const project = new Project(root, { env });
  const statusText = project.readIfExists('.crew/status.md') ?? '';
  const phase = /^phase:\s*["']?([a-z_]+)/m.exec(statusText)?.[1];
  const reason = pendingWork(project, phase);
  if (!reason) return undefined;

  // Same state blocked twice already: the orchestrator cannot move it; let the turn end.
  const n = nextData(project);
  const fingerprint = digest({ phase, reason, ready: ids(n.ready), review: ids(n.review), wip: ids(n.in_progress), done: n.done });
  const stateFile = path.join(root, '.crew', 'logs', 'stop-guard.json');
  const state = readJson(stateFile);
  const session = String(input.session_id ?? 'unknown');
  const previous = state[session];
  const count = previous?.fingerprint === fingerprint ? previous.count + 1 : 1;
  state[session] = { fingerprint, count };
  writeJson(stateFile, state);
  if (count > MAX_BLOCKS_PER_STATE) return undefined;
  return { decision: 'block', reason: `Agent Crew: ${reason}` };
}

const EXECUTORS = new Set(['frontend', 'backend', 'db', 'qa']);
const REVIEWERS = new Set(['qa', 'security']);

/**
 * SubagentStop: an executor or reviewer that leaves its task without a recorded result gets one
 * reminder (`stop_hook_active` is set on the retry, so it never loops).
 */
export function unrecordedResult(input, root, env, taskId) {
  if (input.stop_hook_active || !taskId) return undefined;
  const role = String(input.agent_type ?? '').split(':').pop();
  if (!EXECUTORS.has(role) && !REVIEWERS.has(role)) return undefined;
  let task;
  try {
    task = new Project(root, { env }).task(taskId);
  } catch {
    return undefined;
  }
  const { status, review_stage: stage, owner } = task.data;
  if (status === 'in_progress' && owner === role) {
    return {
      decision: 'block',
      reason: `${taskId} is still in progress and its result is not recorded. If your checks pass: commit, then crew task submit ${taskId} --files <paths> --note "<what changed>". If not: crew task fail ${taskId} --error "<what fails>".`,
    };
  }
  if (status === 'review' && stage === role && REVIEWERS.has(role)) {
    return {
      decision: 'block',
      reason: `${taskId} is waiting for your ${stage} decision. Record it: crew task pass ${taskId} --stage ${stage} --note "<what you checked>" or crew task reject ${taskId} --stage ${stage} --error "<what is wrong>".`,
    };
  }
  return undefined;
}
