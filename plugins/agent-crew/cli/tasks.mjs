// `crew task …`: create tasks and move them through the cycle of SPEC §7.7
// (todo → in_progress → review/qa → review/security → done), counting failed attempts and
// climbing the escalation ladder of SPEC §8 (retry → stronger model → replan → escalate).

import { UsageError } from './args.mjs';
import { appendToSection, C, errorHash, normalizeId, NotFoundError, readBody, renderOrThrow, StateError } from './project.mjs';

/** Failed checks allowed per ladder rung before the task climbs to the next one (SPEC §8: N = 3). */
export const MAX_ATTEMPTS = 3;
export const STRONGER_MODEL = 'opus';

const NUMERIC = new Set(['attempts', 'budget_usd', 'spent_usd_estimate']);
const LISTS = new Set(['depends_on', 'files', 'active_tasks']);
const IMMUTABLE = new Set(['id', 'created_at']);

export function isStrongModel(model) {
  return typeof model === 'string' && /opus|fable/i.test(model);
}

function typed(key, raw) {
  if (raw === undefined) return undefined;
  if (NUMERIC.has(key)) {
    const n = Number(raw);
    if (!Number.isFinite(n)) throw new UsageError(`${key} must be a number, got "${raw}"`);
    return n;
  }
  if (LISTS.has(key)) return raw.split(',').map((s) => s.trim()).filter(Boolean);
  return raw;
}

function oneLine(text, max = 200) {
  const line = String(text).replace(/\s+/g, ' ').trim();
  return line.length > max ? `${line.slice(0, max - 1)}…` : line;
}

function logLine(project, text) {
  return `- ${project.now()} ${text}`;
}

function taskLine(t) {
  const d = t.data;
  const stage = d.status === 'review' && d.review_stage ? `/${d.review_stage}` : '';
  const extra = [d.model && `model ${d.model}`, d.ladder && d.ladder !== 'retry' && `ladder ${d.ladder}`, d.attempts ? `attempts ${d.attempts}` : '', d.escalation && `escalation ${d.escalation}`]
    .filter(Boolean)
    .join(', ');
  return `${t.id}  ${`${d.status}${stage}`.padEnd(16)} ${String(d.owner ?? '?').padEnd(10)} ${d.title ?? ''}${extra ? `  (${extra})` : ''}`;
}

function requireStatus(task, allowed, action) {
  if (!allowed.includes(task.data.status)) {
    throw new StateError(`${task.id} is ${task.data.status}${task.data.review_stage ? `/${task.data.review_stage}` : ''}; ${action} needs status ${allowed.join(' or ')}`);
  }
}

// ---------------------------------------------------------------------------

export async function taskNew(project, args, io) {
  const title = args.str('title');
  const owner = args.str('owner');
  if (!title) throw new UsageError('--title is required');
  if (!owner) throw new UsageError('--owner is required (the agent that does the work, e.g. frontend)');
  const dependsOn = args.list('depends-on').map((d) => normalizeId('task', d));
  const known = new Set(project.taskIds());
  const missing = dependsOn.filter((d) => !known.has(d));
  if (missing.length) throw new NotFoundError(`--depends-on: ${missing.join(', ')} not found`);
  const files = args.list('files');
  const model = args.str('model');
  const budget = args.num('budget');
  const body = readBody(args, io.stdin);
  const json = args.bool('json');
  args.done();

  const now = project.now();
  const data = (id) => ({
    id,
    title,
    status: 'todo',
    owner,
    attempts: 0,
    ...(model ? { model } : {}),
    ...(dependsOn.length ? { depends_on: dependsOn } : {}),
    ...(files.length ? { files } : {}),
    ...(budget !== undefined ? { budget_usd: budget } : {}),
    created_at: now,
    updated_at: now,
  });
  const bodyFor = (id) => {
    const text = body?.trim() ? body.trim() : `## Goal\n\n${title}`;
    return /^#\s/.test(text) ? `${text}\n` : `# ${id}: ${title}\n\n${text}\n`;
  };
  // Validate before allocating: a render error must not leave an empty file behind.
  renderOrThrow(() => C.renderTask(data('T-999'), bodyFor('T-999')));
  const { id } = await C.createWithNextId(project.abs(C.CREW_PATHS.tasks), 'task', (newId) => C.renderTask(data(newId), bodyFor(newId)));
  const rel = C.taskPath(id);
  if (json) io.json({ id, path: rel });
  else io.log(`Created ${id} (owner ${owner}) — ${rel}`);
}

export function taskShow(project, args, io) {
  const task = project.task(args.positional[0]);
  const json = args.bool('json');
  args.done();
  const estimate = C.taskEstimates(project.costs()).get(task.id);
  if (json) {
    io.json({ ...task.data, path: task.rel, body: task.body, ...(estimate ? { estimate } : {}) });
    return;
  }
  io.log(project.read(task.rel).replace(/\n+$/, ''));
  if (estimate) io.log(`\n(estimated so far: ${estimate.tokens} tokens, $${estimate.usd.toFixed(2)})`);
}

export function taskList(project, args, io) {
  const status = args.str('status');
  const owner = args.str('owner');
  const json = args.bool('json');
  args.done();
  const tasks = project.tasks().filter((t) => (!status || t.data.status === status) && (!owner || t.data.owner === owner));
  if (json) {
    io.json(tasks.map((t) => ({ ...t.data, path: t.rel })));
    return;
  }
  io.log(tasks.length ? tasks.map(taskLine).join('\n') : 'No tasks.');
}

/** Generic field update — the orchestrator's escape hatch; the cycle commands below cover normal work. */
export async function taskSet(project, args, io) {
  const [rawId, ...pairs] = args.positional;
  args.done();
  const task = project.task(rawId);
  if (!pairs.length) throw new UsageError('nothing to set: pass key=value pairs, e.g. status=todo model=opus');
  const patch = {};
  for (const w of pairs) {
    const eq = w.indexOf('=');
    if (eq <= 0) throw new UsageError(`expected key=value, got "${w}"`);
    const key = w.slice(0, eq).trim();
    if (IMMUTABLE.has(key)) throw new UsageError(`${key} can't be changed`);
    if (key === 'updated_at') continue;
    const raw = w.slice(eq + 1);
    patch[key] = raw === '' ? undefined : typed(key, raw);
  }
  if (patch.depends_on) patch.depends_on = patch.depends_on.map((d) => normalizeId('task', d));
  const status = patch.status ?? task.data.status;
  if (status !== 'review' && !('review_stage' in patch)) patch.review_stage = undefined;
  if (status !== 'blocked' && !('escalation' in patch)) patch.escalation = undefined;
  const saved = await project.saveTask(task, patch);
  io.log(taskLine(saved));
}

export async function taskStart(project, args, io) {
  const task = project.task(args.positional[0]);
  args.done();
  if (task.data.status === 'in_progress') {
    io.log(`${task.id} is already in progress.`);
    return;
  }
  requireStatus(task, ['todo'], 'start');
  const unmet = (task.data.depends_on ?? []).filter((d) => {
    try {
      return project.task(d).data.status !== 'done';
    } catch {
      return true;
    }
  });
  if (unmet.length) throw new StateError(`${task.id} depends on ${unmet.join(', ')}, which ${unmet.length > 1 ? 'are' : 'is'} not done yet`);
  await project.saveTask(task, { status: 'in_progress' });
  io.log(`${task.id} is in progress.`);
}

export async function taskSubmit(project, args, io) {
  const task = project.task(args.positional[0]);
  const files = args.list('files');
  const note = args.str('note');
  args.done();
  requireStatus(task, ['in_progress', 'todo'], 'submit');
  const allFiles = [...new Set([...(task.data.files ?? []), ...files])];
  const body = appendToSection(task.body, 'Log', logLine(project, `submitted for review by ${task.data.owner}${note ? `: ${oneLine(note)}` : ''}`));
  const filesPatch = allFiles.length ? { files: allFiles } : {};
  if (project.config().reviewDepth === 'final-only') {
    // The user chose one review of the whole project at the end instead of one per task.
    await project.saveTask({ ...task, body: appendToSection(body, 'Log', logLine(project, 'done without a task review (review depth: final-only)')) }, { status: 'done', review_stage: undefined, ...filesPatch });
    io.log(`${task.id} is done (review depth final-only: the final phase reviews the whole project).`);
    return;
  }
  await project.saveTask({ ...task, body }, { status: 'review', review_stage: 'qa', ...filesPatch });
  io.log(`${task.id} is waiting for QA review.`);
}

function stageArg(args) {
  const stage = args.str('stage');
  if (stage !== 'qa' && stage !== 'security') throw new UsageError('--stage must be qa or security');
  return stage;
}

export async function taskPass(project, args, io) {
  const task = project.task(args.positional[0]);
  const stage = stageArg(args);
  const note = args.str('note');
  args.done();
  requireStatus(task, ['review'], 'pass');
  if (task.data.review_stage !== stage) throw new StateError(`${task.id} is in ${task.data.review_stage ?? 'no'} review, not ${stage}`);
  const body = appendToSection(task.body, 'Log', logLine(project, `${stage} review passed${note ? `: ${oneLine(note)}` : ''}`));
  if (stage === 'qa' && project.config().reviewDepth !== 'every-task') {
    await project.saveTask({ ...task, body }, { status: 'done', review_stage: undefined });
    io.log(`${task.id} passed QA and is done (review depth ${project.config().reviewDepth}: security reviews the whole project in the final phase).`);
  } else if (stage === 'qa') {
    await project.saveTask({ ...task, body }, { review_stage: 'security' });
    io.log(`${task.id} passed QA and is waiting for security review.`);
  } else {
    await project.saveTask({ ...task, body }, { status: 'done', review_stage: undefined });
    io.log(`${task.id} is done.`);
  }
}

export async function taskReject(project, args, io) {
  const task = project.task(args.positional[0]);
  const stage = stageArg(args);
  const error = args.str('error');
  const json = args.bool('json');
  args.done();
  if (!error) throw new UsageError('--error is required: what failed, specifically enough for the executor to fix it');
  requireStatus(task, ['review'], 'reject');
  if (task.data.review_stage !== stage) throw new StateError(`${task.id} is in ${task.data.review_stage ?? 'no'} review, not ${stage}`);
  await recordFailure(project, task, error, `${stage} review rejected it`, json, io);
}

export async function taskFail(project, args, io) {
  const task = project.task(args.positional[0]);
  const error = args.str('error');
  const json = args.bool('json');
  args.done();
  if (!error) throw new UsageError('--error is required: the error or the reason the attempt failed');
  requireStatus(task, ['todo', 'in_progress', 'review'], 'fail');
  await recordFailure(project, task, error, 'attempt failed', json, io);
}

/**
 * Counts a failed attempt and decides the next rung (SPEC §8). The rung changes when the task
 * fails MAX_ATTEMPTS times on the current rung or repeats the previous error.
 */
export async function recordFailure(project, task, error, what, json, io) {
  const d = task.data;
  const attempts = (d.attempts ?? 0) + 1;
  const hash = errorHash(error);
  const repeated = d.last_error_hash === hash;
  const reason = repeated ? 'repeated_error' : attempts >= MAX_ATTEMPTS ? 'attempts_exceeded' : undefined;
  const rung = d.ladder ?? 'retry';
  const patch = { status: 'todo', review_stage: undefined, attempts, last_error_hash: hash };

  let action;
  if (!reason) {
    action = 'retry';
  } else if (rung === 'retry' && !isStrongModel(d.model)) {
    action = 'stronger_model';
    Object.assign(patch, { ladder: 'stronger_model', model: STRONGER_MODEL, attempts: 0, last_error_hash: undefined });
  } else if (rung !== 'replan') {
    action = 'replan';
    Object.assign(patch, { ladder: 'replan', attempts: 0, last_error_hash: undefined });
  } else {
    action = 'escalate';
  }

  const model = patch.model ?? d.model ?? 'default model';
  const body = appendToSection(task.body, 'Log', logLine(project, `${what} (attempt ${attempts} on ${d.model ?? 'default model'}${repeated ? ', same error as last time' : ''}): ${oneLine(error)}`));
  await project.saveTask({ ...task, body }, patch);

  const next = {
    retry: `Run ${task.id} again with the same agent (${d.owner}) and model; give it the error above. Attempt ${attempts} of ${MAX_ATTEMPTS} on this rung.`,
    stronger_model: `Stuck (${reason}). Ladder: retry → stronger model. Run ${task.id} again with model "${model}" — pass model: "${model}" to the Agent tool. Attempts start again from 0.`,
    replan: `Stuck (${reason}) on the stronger model too. Ladder: stronger model → replan. Ask the architect to replan ${task.id} (split it or change the approach), rewrite the task, then run it again. Attempts start again from 0.`,
    escalate: `Stuck (${reason}) after replanning. Ladder: replan → escalate. Ask the human: crew escalate --kind stuck --reason ${reason} --task ${task.id} --question "…" --option "…" --option "…" --recommended "…" --problem "…" --tried "…"`,
  }[action];

  if (json) io.json({ id: task.id, attempts, repeated, reason: reason ?? null, action, model: patch.model ?? d.model ?? null });
  else io.log(`${task.id}: ${what}.\nNext: ${next}`);
}

export async function taskBlock(project, args, io) {
  const task = project.task(args.positional[0]);
  const escalation = normalizeId('escalation', args.str('escalation'));
  args.done();
  project.escalation(escalation); // must exist
  await project.saveTask(task, { status: 'blocked', escalation, review_stage: undefined });
  io.log(`${task.id} is blocked on ${escalation}.`);
}

export { taskLine };
