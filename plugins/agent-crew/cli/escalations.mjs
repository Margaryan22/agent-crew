// `crew escalate`, `crew escalation …` and `crew decision …`: questions to the human (SPEC §8)
// and the ADRs that record their answers.

import { UsageError } from './args.mjs';
import { C, normalizeId, NotFoundError, readBody, renderOrThrow, StateError } from './project.mjs';

const NEEDS_RECOMMENDATION = new Set(['stuck', 'access', 'question']);

export async function escalate(project, args, io) {
  const kind = args.str('kind');
  const reason = args.str('reason');
  const question = args.str('question');
  const options = args.all('option');
  const recommended = args.str('recommended');
  const rawTask = args.str('task');
  const agent = args.str('agent');
  const problem = args.str('problem');
  const tried = args.str('tried');
  const json = args.bool('json');
  args.done();

  if (!kind) throw new UsageError(`--kind is required: ${C.EscalationKind.options.join(', ')}`);
  if (!question) throw new UsageError('--question is required: one line, what the human has to decide');
  if (options.length < 2) throw new UsageError('give at least two --option values (SPEC §8: 2–3 options with a recommendation)');
  if (NEEDS_RECOMMENDATION.has(kind) && !recommended) throw new UsageError('--recommended is required: one of the --option values');
  const task = rawTask ? project.task(rawTask) : undefined;

  const data = (id) => ({
    id,
    kind,
    ...(reason ? { reason } : {}),
    source: 'plugin',
    status: 'open',
    question: question.replace(/\s+/g, ' ').trim(),
    options,
    ...(recommended ? { recommended } : {}),
    ...(task ? { task: task.id } : {}),
    ...(agent ? { agent } : {}),
    created_at: project.now(),
  });
  const body = { ...(problem ? { problem } : {}), ...(tried ? { tried } : {}) };
  renderOrThrow(() => C.renderEscalation(data('E-999'), body));
  const { id } = await C.createWithNextId(project.abs(C.CREW_PATHS.escalations), 'escalation', (newId) => C.renderEscalation(data(newId), body));
  if (task) await project.saveTask(task, { status: 'blocked', escalation: id, review_stage: undefined });

  if (json) io.json({ id, path: C.escalationPath(id), task: task?.id ?? null });
  else io.log(`Created ${id} (${kind}) — ${C.escalationPath(id)}${task ? `; ${task.id} is blocked until it is resolved` : ''}.`);
}

function escalationLine(e) {
  const d = e.data;
  return `${e.id}  ${String(d.status).padEnd(9)} ${String(d.kind).padEnd(12)} ${d.task ? `${d.task} ` : ''}${d.question ?? ''}${d.answer ? `  → ${d.answer}` : ''}`;
}

export function escalationList(project, args, io) {
  const status = args.str('status');
  const json = args.bool('json');
  args.done();
  const items = project.escalations().filter((e) => !status || e.data.status === status);
  if (json) io.json(items.map((e) => ({ ...e.data, path: e.rel })));
  else io.log(items.length ? items.map(escalationLine).join('\n') : 'No escalations.');
}

export function escalationShow(project, args, io) {
  const e = project.escalation(args.positional[0]);
  args.done();
  io.log(e.text.replace(/\n+$/, ''));
}

/** Records the human's answer (in a CLI session the orchestrator writes it on the human's behalf). */
export async function escalationAnswer(project, args, io) {
  const e = project.escalation(args.positional[0]);
  const text = args.str('text');
  const by = args.str('by') ?? 'human';
  args.done();
  if (!text) throw new UsageError('--text is required: the answer as the human gave it');
  if (!C.AnsweredBy.options.includes(by)) throw new UsageError(`--by must be one of ${C.AnsweredBy.options.join(', ')}`);
  if (e.data.status === 'resolved' || e.data.status === 'cancelled') throw new StateError(`${e.id} is already ${e.data.status}`);
  await project.write(e.rel, C.answerEscalation(e.text, { text, by, at: project.now() }));
  io.log(`${e.id} answered: ${text}`);
}

/** The orchestrator acted on the answer: link the ADR and unblock the tasks that waited for it. */
export async function escalationResolve(project, args, io) {
  const e = project.escalation(args.positional[0]);
  const rawDecision = args.str('decision');
  args.done();
  if (e.data.status !== 'answered') throw new StateError(`${e.id} is ${e.data.status}; record the answer first (crew escalation answer ${e.id} --text "…")`);
  const decision = rawDecision ? normalizeId('decision', rawDecision) : undefined;
  if (decision && !project.decisions().some((d) => d.id === decision)) throw new NotFoundError(`${decision} not found in ${C.CREW_PATHS.decisions}/`);
  if (!decision && e.data.source === 'plugin' && C.DECISION_BEARING_KINDS.includes(e.data.kind)) {
    throw new UsageError(`a ${e.data.kind} escalation is resolved with an ADR: crew decision new --title "…" --source ${e.id}, then crew escalation resolve ${e.id} --decision ADR-…`);
  }
  const updated = C.resolveEscalation(e.text, decision);
  renderOrThrow(() => C.EscalationSchema.parse(C.parseFrontmatter(updated).data));
  await project.write(e.rel, updated);
  const unblocked = await unblockTasks(project, e.id);
  io.log(`${e.id} resolved${decision ? ` by ${decision}` : ''}.${unblocked.length ? ` Unblocked: ${unblocked.join(', ')} (attempts and ladder reset).` : ''}`);
}

export async function escalationCancel(project, args, io) {
  const e = project.escalation(args.positional[0]);
  args.done();
  if (e.data.status === 'resolved') throw new StateError(`${e.id} is already resolved`);
  await project.write(e.rel, C.cancelEscalation(e.text));
  const unblocked = await unblockTasks(project, e.id);
  io.log(`${e.id} cancelled.${unblocked.length ? ` Unblocked: ${unblocked.join(', ')}.` : ''}`);
}

async function unblockTasks(project, escalationId) {
  const out = [];
  for (const t of project.tasks()) {
    if (t.data.status !== 'blocked' || t.data.escalation !== escalationId) continue;
    await project.saveTask(t, { status: 'todo', escalation: undefined, attempts: 0, ladder: undefined, last_error_hash: undefined });
    out.push(t.id);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Decisions (ADRs)

export async function decisionNew(project, args, io) {
  const title = args.str('title');
  const status = args.str('status') ?? 'accepted';
  const rawSource = args.str('source');
  const rawSupersedes = args.str('supersedes');
  const body = readBody(args, io.stdin);
  const json = args.bool('json');
  args.done();
  if (!title) throw new UsageError('--title is required');
  const source = rawSource ? normalizeId('escalation', rawSource) : undefined;
  if (source) project.escalation(source);
  const supersedes = rawSupersedes ? normalizeId('decision', rawSupersedes) : undefined;
  const old = supersedes ? project.decisions().find((d) => d.id === supersedes) : undefined;
  if (supersedes && !old) throw new NotFoundError(`${supersedes} not found`);

  const date = project.now().slice(0, 10);
  const data = (id) => ({ id, title, status, date, ...(source ? { source } : {}), ...(supersedes ? { supersedes } : {}) });
  const bodyFor = (id) => {
    const text = body?.trim() ? body.trim() : '## Context\n\n## Decision\n\n## Consequences';
    return /^#\s/.test(text) ? `${text}\n` : `# ${id}: ${title}\n\n${text}\n`;
  };
  renderOrThrow(() => C.renderDecision(data('ADR-999'), bodyFor('ADR-999')));
  const { id, file } = await C.createWithNextId(project.abs(C.CREW_PATHS.decisions), 'decision', (newId) => C.renderDecision(data(newId), bodyFor(newId)), {
    fileName: (newId) => C.decisionPath(newId, title).split('/').pop(),
  });
  if (old) await project.write(old.rel, C.updateFrontmatter(project.read(old.rel), { status: 'superseded' }));
  const rel = `${C.CREW_PATHS.decisions}/${file.split(/[\\/]/).pop()}`;
  if (json) io.json({ id, path: rel });
  else io.log(`Created ${id} — ${rel}${old ? `; ${old.id} is now superseded` : ''}.`);
}

export function decisionList(project, args, io) {
  const json = args.bool('json');
  args.done();
  const items = project.decisions();
  if (json) io.json(items.map((d) => ({ ...d.data, path: d.rel })));
  else io.log(items.length ? items.map((d) => `${d.id}  ${String(d.data.status).padEnd(10)} ${d.data.title ?? ''}${d.data.source ? `  (from ${d.data.source})` : ''}`).join('\n') : 'No decisions.');
}
