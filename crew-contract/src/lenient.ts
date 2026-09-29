// Tolerant readers for hand-edited or older .crew/ files. They never throw: they return the
// best normalized view they can build plus the strict-schema issues of the raw data, so a UI
// can show the file and still report what is wrong with it.

import { idFromFileName } from './ids';
import { type FmData, type FmScalar, type FmValue, firstHeading, parseFrontmatter, section } from './frontmatter';
import {
  AnsweredBy,
  type Decision,
  DecisionSchema,
  DecisionStatus,
  type Escalation,
  EscalationSchema,
  EscalationSource,
  formatIssues,
  Phase,
  ReviewStage,
  type Status,
  StatusSchema,
  StuckReason,
  type Task,
  TaskSchema,
} from './schemas';
import type { z } from 'zod';

export interface Lenient<T> {
  value: T;
  /** Problems a strict writer would have avoided; empty when the file is fully valid. */
  issues: string[];
}

export type TaskView = Task & { path: string };
export type EscalationView = Escalation & { path: string; title: string };
export type DecisionView = Decision & { path: string };
export type StatusView = Partial<Status> & { summary?: string };

// ---------------------------------------------------------------------------
// Keys and values

const COMMON_ALIASES: Record<string, string> = {
  state: 'status',
  статус: 'status',
  состояние: 'status',
  name: 'title',
  название: 'title',
  заголовок: 'title',
  type: 'kind',
  тип: 'kind',
  created: 'created_at',
  updated: 'updated_at',
};

const TASK_ALIASES: Record<string, string> = {
  ...COMMON_ALIASES,
  assignee: 'owner',
  agent: 'owner',
  executor: 'owner',
  assigned_to: 'owner',
  исполнитель: 'owner',
  ответственный: 'owner',
  attempt: 'attempts',
  tries: 'attempts',
  retries: 'attempts',
  попытки: 'attempts',
  попытка: 'attempts',
  ветка: 'branch',
  base_branch: 'base',
  файлы: 'files',
  depends: 'depends_on',
  dependencies: 'depends_on',
  зависит_от: 'depends_on',
};

const ESCALATION_ALIASES: Record<string, string> = {
  ...COMMON_ALIASES,
  assignee: 'agent',
  from: 'agent',
  task_id: 'task',
  задача: 'task',
  choices: 'options',
  варианты: 'options',
  вопрос: 'question',
  ответ: 'answer',
  рекомендация: 'recommended',
  recommendation: 'recommended',
  причина: 'reason',
};

const STATUS_FILE_ALIASES: Record<string, string> = { ...COMMON_ALIASES, stage: 'phase', фаза: 'phase', этап: 'phase' };

export function normalizeKey(raw: string, aliases: Record<string, string> = COMMON_ALIASES): string {
  const key = raw.trim().toLowerCase().replace(/[\s-]+/g, '_');
  return aliases[key] ?? key;
}

function normalizeData(data: FmData, aliases: Record<string, string>): FmData {
  const out: FmData = {};
  for (const [k, v] of Object.entries(data)) {
    const key = normalizeKey(k, aliases);
    if (!(key in out)) out[key] = v;
  }
  return out;
}

/** `Status: todo`, `**Status:** todo`, `- **Owner**: backend` in the first lines of a body. */
export function parseInlineFields(body: string, maxLines = 40): Record<string, string> {
  const fields: Record<string, string> = {};
  const re = /^\s*(?:[-*]\s+)?(?:\*\*|__)?([A-Za-zЀ-ӿ][\wЀ-ӿ -]{0,30}?)(?:\s*:\s*(?:\*\*|__)|(?:\*\*|__)?\s*:)\s*(.+?)\s*$/;
  for (const line of body.split('\n').slice(0, maxLines)) {
    if (/^#{2,}\s/.test(line) && Object.keys(fields).length) break;
    const m = re.exec(line);
    if (!m) continue;
    const key = (m[1] ?? '').trim();
    if (!(key in fields)) fields[key] = (m[2] ?? '').replace(/^[`*_]+|[`*_]+$/g, '').trim();
  }
  return fields;
}

function readFields(text: string, aliases: Record<string, string>): { raw: FmData; fields: FmData; body: string; hasFrontmatter: boolean } {
  const fm = parseFrontmatter(text);
  const inline: FmData = fm.hasFrontmatter ? {} : parseInlineFields(fm.body);
  return { raw: fm.data, fields: normalizeData({ ...inline, ...fm.data }, aliases), body: fm.body, hasFrontmatter: fm.hasFrontmatter };
}

function str(value: FmValue | undefined): string | undefined {
  if (value === undefined || value === null) return undefined;
  if (Array.isArray(value)) return value.filter((v) => v !== null).join(', ') || undefined;
  if (typeof value === 'object') return undefined;
  const s = String(value).trim();
  return s === '' ? undefined : s;
}

function list(value: FmValue | undefined): string[] {
  if (value === undefined || value === null || (typeof value === 'object' && !Array.isArray(value))) return [];
  if (Array.isArray(value)) return value.filter((v): v is Exclude<FmScalar, null> => v !== null).map(String);
  return String(value)
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

function int(value: FmValue | undefined): number {
  const n = typeof value === 'number' ? value : Number.parseInt(str(value) ?? '', 10);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
}

function num(value: FmValue | undefined): number | undefined {
  const n = typeof value === 'number' ? value : Number.parseFloat(str(value) ?? '');
  return Number.isFinite(n) && n >= 0 ? n : undefined;
}

function oneOf<T extends string>(options: readonly T[], value: string | undefined): T | undefined {
  return value !== undefined && (options as readonly string[]).includes(value) ? (value as T) : undefined;
}

function baseName(path: string): string {
  return (path.split(/[\\/]/).pop() ?? path).replace(/\.md$/i, '');
}

function stripIdPrefix(title: string, id: string): string {
  const escaped = id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return title.replace(new RegExp(`^${escaped}\\s*[:.\\-—–]\\s*`, 'i'), '').trim() || title;
}

function firstParagraph(body: string): string | undefined {
  return body
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .find((p) => p !== '' && !p.startsWith('#') && !p.startsWith('---') && !p.startsWith('>'));
}

function listItems(markdown: string): string[] {
  return markdown
    .split('\n')
    .map((l) => /^\s*(?:[-*+]|\d+[.)])\s+(?:\[[ xX]\]\s+)?(.+?)\s*$/.exec(l)?.[1])
    .filter((s): s is string => Boolean(s))
    .map((s) =>
      s
        .replace(/^\*\*(.+?)\*\*/, '$1')
        .replace(/^`(.+?)`$/, '$1')
        .replace(/\s*\((recommended|рекомендую|рекомендуется)\)\s*$/i, '')
        .trim(),
    );
}

export function truncate(text: string, max: number): string {
  const oneLine = text.replace(/\s+/g, ' ').trim();
  return oneLine.length > max ? `${oneLine.slice(0, max - 1)}…` : oneLine;
}

function strictIssues(schema: z.ZodType, raw: FmData, hasFrontmatter: boolean): string[] {
  if (!hasFrontmatter) return ['missing YAML frontmatter'];
  const result = schema.safeParse(raw);
  return result.success ? [] : formatIssues(result.error);
}

// ---------------------------------------------------------------------------
// Tasks

const TASK_STATUS_ALIASES: Record<string, Task['status']> = {
  todo: 'todo',
  to_do: 'todo',
  backlog: 'todo',
  pending: 'todo',
  open: 'todo',
  new: 'todo',
  planned: 'todo',
  queued: 'todo',
  к_выполнению: 'todo',
  новая: 'todo',
  in_progress: 'in_progress',
  inprogress: 'in_progress',
  progress: 'in_progress',
  doing: 'in_progress',
  wip: 'in_progress',
  active: 'in_progress',
  running: 'in_progress',
  started: 'in_progress',
  working: 'in_progress',
  в_работе: 'in_progress',
  review: 'review',
  in_review: 'review',
  reviewing: 'review',
  needs_review: 'review',
  qa: 'review',
  testing: 'review',
  на_ревью: 'review',
  ревью: 'review',
  done: 'done',
  complete: 'done',
  completed: 'done',
  finished: 'done',
  closed: 'done',
  merged: 'done',
  resolved: 'done',
  готово: 'done',
  сделано: 'done',
  выполнено: 'done',
  blocked: 'blocked',
  stuck: 'blocked',
  failed: 'blocked',
  on_hold: 'blocked',
  escalated: 'blocked',
  waiting: 'blocked',
  заблокировано: 'blocked',
  заблокирована: 'blocked',
};

export function normalizeTaskStatus(raw: string | undefined): Task['status'] {
  if (!raw) return 'todo';
  return TASK_STATUS_ALIASES[raw.trim().toLowerCase().replace(/[\s-]+/g, '_')] ?? 'todo';
}

export function readTask(text: string, path: string): Lenient<TaskView> {
  const { raw, fields, body, hasFrontmatter } = readFields(text, TASK_ALIASES);
  const id = str(fields.id) ?? idFromFileName('task', baseName(path)) ?? baseName(path);
  const heading = firstHeading(body);
  const status = normalizeTaskStatus(str(fields.status));
  const value: TaskView = {
    id,
    title: str(fields.title) ?? (heading ? stripIdPrefix(heading, id) : id),
    status,
    owner: str(fields.owner) ?? 'unassigned',
    attempts: int(fields.attempts),
    files: list(fields.files),
    depends_on: list(fields.depends_on),
    created_at: str(fields.created_at) ?? '',
    updated_at: str(fields.updated_at) ?? '',
    path,
  };
  const optional: Partial<Task> = {
    model: str(fields.model),
    last_error_hash: str(fields.last_error_hash),
    review_stage: oneOf(ReviewStage.options, str(fields.review_stage)),
    escalation: str(fields.escalation),
    branch: str(fields.branch),
    base: str(fields.base),
    budget_usd: num(fields.budget_usd),
    spent_usd_estimate: num(fields.spent_usd_estimate),
  };
  for (const [k, v] of Object.entries(optional)) if (v !== undefined) (value as Record<string, unknown>)[k] = v;
  return { value, issues: strictIssues(TaskSchema, raw, hasFrontmatter) };
}

// ---------------------------------------------------------------------------
// Escalations

const ESCALATION_STATUS_ALIASES: Record<string, Escalation['status']> = {
  open: 'open',
  pending: 'open',
  waiting: 'open',
  new: 'open',
  открыта: 'open',
  answered: 'answered',
  replied: 'answered',
  отвечена: 'answered',
  resolved: 'resolved',
  closed: 'resolved',
  done: 'resolved',
  решена: 'resolved',
  закрыта: 'resolved',
  cancelled: 'cancelled',
  canceled: 'cancelled',
  отменена: 'cancelled',
};

export function normalizeEscalationKind(raw: string | undefined): Escalation['kind'] {
  const key = (raw ?? '').trim().toLowerCase().replace(/[\s_]+/g, '-');
  if (key === 'permission' || key === 'approval') return 'permission';
  if (key === 'brief-review' || key === 'brief' || key === 'review') return 'brief-review';
  if (key === 'stuck' || key === 'blocked') return 'stuck';
  if (key === 'access' || key === 'credentials' || key === 'доступ') return 'access';
  return 'question';
}

const QUESTION_SECTIONS = ['Question', 'Вопрос', 'Problem', 'Проблема', 'What is stuck', 'Что застряло', 'Context', 'Контекст'];
const OPTION_SECTIONS = ['Options', 'Варианты', 'Choices', 'Варианты ответа'];
const ANSWER_SECTIONS = ['Answer', 'Ответ'];

export function readEscalation(text: string, path: string): Lenient<EscalationView> {
  const { raw, fields, body, hasFrontmatter } = readFields(text, ESCALATION_ALIASES);
  const id = str(fields.id) ?? idFromFileName('escalation', baseName(path)) ?? baseName(path);
  const heading = firstHeading(body);
  const question = str(fields.question) ?? section(body, QUESTION_SECTIONS) ?? firstParagraph(body) ?? heading ?? id;
  const optionsFromFields = list(fields.options);
  const optionsSection = section(body, OPTION_SECTIONS);
  const answer = str(fields.answer) ?? section(body, ANSWER_SECTIONS);
  const rawStatus = str(fields.status)?.toLowerCase().replace(/[\s-]+/g, '_');
  const value: EscalationView = {
    id,
    kind: normalizeEscalationKind(str(fields.kind)),
    source: oneOf(EscalationSource.options, str(fields.source)) ?? 'plugin',
    status: (rawStatus ? ESCALATION_STATUS_ALIASES[rawStatus] : undefined) ?? (answer ? 'answered' : 'open'),
    question: truncate(question, 300),
    options: optionsFromFields.length ? optionsFromFields : optionsSection ? listItems(optionsSection) : [],
    created_at: str(fields.created_at) ?? '',
    title: str(fields.title) ?? (heading ? stripIdPrefix(heading, id) : truncate(question, 80)),
    path,
  };
  const optional: Partial<Escalation> = {
    reason: oneOf(StuckReason.options, str(fields.reason)),
    recommended: str(fields.recommended),
    task: str(fields.task),
    agent: str(fields.agent),
    session_id: str(fields.session_id),
    answer,
    answered_at: str(fields.answered_at),
    answered_by: oneOf(AnsweredBy.options, str(fields.answered_by)),
    decision: str(fields.decision),
  };
  for (const [k, v] of Object.entries(optional)) if (v !== undefined) (value as Record<string, unknown>)[k] = v;
  return { value, issues: strictIssues(EscalationSchema, raw, hasFrontmatter) };
}

// ---------------------------------------------------------------------------
// Decisions and status

export function readDecision(text: string, path: string): Lenient<DecisionView> {
  const { raw, fields, body, hasFrontmatter } = readFields(text, COMMON_ALIASES);
  const file = baseName(path);
  const id = str(fields.id) ?? idFromFileName('decision', file) ?? file;
  const heading = firstHeading(body);
  const slugTitle = file
    .replace(/^ADR-\d+/i, '')
    .replace(/^[-_]+/, '')
    .replace(/[-_]+/g, ' ')
    .trim();
  const value: DecisionView = {
    id,
    title: str(fields.title) ?? (heading ? stripIdPrefix(heading, id) : slugTitle || id),
    status: oneOf(DecisionStatus.options, str(fields.status)?.toLowerCase()) ?? 'proposed',
    date: str(fields.date) ?? '',
    path,
  };
  const source = str(fields.source);
  const supersedes = str(fields.supersedes);
  if (source) value.source = source;
  if (supersedes) value.supersedes = supersedes;
  return { value, issues: strictIssues(DecisionSchema, raw, hasFrontmatter) };
}

export function readStatus(text: string): Lenient<StatusView> {
  const { raw, fields, body, hasFrontmatter } = readFields(text, STATUS_FILE_ALIASES);
  const value: StatusView = {};
  const phase = oneOf(Phase.options, str(fields.phase)?.toLowerCase().replace(/[\s-]+/g, '_'));
  const updatedAt = str(fields.updated_at);
  const stopReason = str(fields.stop_reason);
  const summary =
    str(fields.summary) ?? firstParagraph(body.replace(/^\s*(?:[-*]\s+)?(?:\*\*|__)?[\wЀ-ӿ -]{1,30}(?:\*\*|__)?\s*:.*$/gm, ''));
  if (phase) value.phase = phase;
  if (updatedAt) value.updated_at = updatedAt;
  if (stopReason === 'budget_cap' || stopReason === 'user' || stopReason === 'error') value.stop_reason = stopReason;
  if (summary) value.summary = truncate(summary, 280);
  const activeTasks = list(fields.active_tasks);
  if (activeTasks.length) value.active_tasks = activeTasks;
  return { value, issues: strictIssues(StatusSchema, raw, hasFrontmatter) };
}
