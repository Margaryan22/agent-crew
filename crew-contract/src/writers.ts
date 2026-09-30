// Canonical writers. Everything that creates or changes a .crew/ file goes through here (the
// plugin's bin/crew CLI, its hooks, the host UI), so files come out in one shape and key order.

import { type FmValue, parseFrontmatter, section, stringifyDocument, updateFrontmatter } from './frontmatter';
import {
  type CrewManifest,
  CrewManifestSchema,
  type Decision,
  DecisionSchema,
  type Escalation,
  EscalationSchema,
  type SessionMarker,
  SessionMarkerSchema,
  type Status,
  StatusSchema,
  type Task,
  TaskSchema,
} from './schemas';

const TASK_KEYS = [
  'id',
  'title',
  'status',
  'owner',
  'attempts',
  'model',
  'ladder',
  'last_error_hash',
  'review_stage',
  'escalation',
  'depends_on',
  'branch',
  'base',
  'files',
  'budget_usd',
  'spent_usd_estimate',
  'created_at',
  'updated_at',
] as const;

const ESCALATION_KEYS = [
  'id',
  'kind',
  'reason',
  'source',
  'status',
  'question',
  'options',
  'recommended',
  'task',
  'agent',
  'session_id',
  'created_at',
  'answer',
  'answered_at',
  'answered_by',
  'decision',
] as const;

const DECISION_KEYS = ['id', 'title', 'status', 'date', 'source', 'supersedes'] as const;
const STATUS_KEYS = ['phase', 'updated_at', 'active_tasks', 'stop_reason', 'summary'] as const;

/** Known keys first in canonical order, then any extra keys the caller passed. */
function ordered(value: Record<string, unknown>, keys: readonly string[]): Record<string, FmValue | undefined> {
  const out: Record<string, FmValue | undefined> = {};
  for (const k of keys) if (value[k] !== undefined) out[k] = value[k] as FmValue;
  for (const [k, v] of Object.entries(value)) if (!(k in out) && v !== undefined) out[k] = v as FmValue;
  return out;
}

export function renderTask(task: Task, body = ''): string {
  const valid = TaskSchema.parse(task);
  return stringifyDocument(ordered(valid, TASK_KEYS), body || `# ${valid.id}: ${valid.title}\n`);
}

export interface EscalationBody {
  /** What is stuck (SPEC §8). */
  problem?: string;
  /** What was already tried. */
  tried?: string;
  /** Longer explanation per option, keyed by the option label. */
  optionNotes?: Record<string, string>;
}

export function renderEscalation(escalation: Escalation, body: EscalationBody = {}): string {
  const valid = EscalationSchema.parse(escalation);
  const parts = [`# ${valid.id}: ${valid.question}`, ''];
  if (body.problem) parts.push('## Problem', '', body.problem.trim(), '');
  if (body.tried) parts.push('## Tried', '', body.tried.trim(), '');
  parts.push(
    '## Options',
    '',
    ...valid.options.map((o, i) => {
      const note = body.optionNotes?.[o];
      return `${i + 1}. ${o}${o === valid.recommended ? ' (recommended)' : ''}${note ? ` — ${note}` : ''}`;
    }),
    '',
  );
  if (valid.answer) parts.push('## Answer', '', valid.answer, '');
  return stringifyDocument(ordered(valid, ESCALATION_KEYS), parts.join('\n'));
}

export function renderDecision(decision: Decision, body: string): string {
  const valid = DecisionSchema.parse(decision);
  return stringifyDocument(ordered(valid, DECISION_KEYS), body || `# ${valid.id}: ${valid.title}\n`);
}

export function renderStatus(status: Status, body: string): string {
  const valid = StatusSchema.parse(status);
  return stringifyDocument(ordered(valid, STATUS_KEYS), body);
}

export function renderManifest(manifest: CrewManifest): string {
  return `${JSON.stringify(CrewManifestSchema.parse(manifest), null, 2)}\n`;
}

export function renderSessionMarker(marker: SessionMarker): string {
  return `${JSON.stringify(SessionMarkerSchema.parse(marker), null, 2)}\n`;
}

// ---------------------------------------------------------------------------
// Changes to existing files

function appendSection(text: string, heading: string, content: string, aliases: readonly string[]): string {
  if (section(parseFrontmatter(text).body, aliases) !== undefined) return text;
  return `${text.replace(/\n+$/, '')}\n\n## ${heading}\n\n${content}\n`;
}

/** Host side: the human (or an automatic policy) answered. */
export function answerEscalation(text: string, answer: { text: string; by: 'human' | 'auto' | 'eval'; at: string }): string {
  const updated = updateFrontmatter(text, { status: 'answered', answer: answer.text, answered_at: answer.at, answered_by: answer.by });
  return appendSection(updated, 'Answer', answer.text, ['Answer', 'Ответ']);
}

/** Plugin side: the orchestrator acted on the answer (and recorded an ADR for decision-bearing kinds). */
export function resolveEscalation(text: string, decision?: string): string {
  return updateFrontmatter(text, decision ? { status: 'resolved', decision } : { status: 'resolved' });
}

export function cancelEscalation(text: string): string {
  return updateFrontmatter(text, { status: 'cancelled' });
}

/** Host side: the session was stopped (budget cap, user, error). Only these fields are the host's. */
export function markStopped(text: string, stop: { reason: 'budget_cap' | 'user' | 'error'; at: string; note?: string }): string {
  const updated = updateFrontmatter(text, { phase: 'stopped', stop_reason: stop.reason, updated_at: stop.at });
  return stop.note ? `${updated.replace(/\n+$/, '')}\n\n> ${stop.note.replace(/\n/g, ' ')}\n` : updated;
}
