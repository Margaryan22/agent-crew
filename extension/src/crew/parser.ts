// Tolerant parsers for the .crew/ markdown files written by the agent-crew plugin.
// Files are expected to carry YAML frontmatter; when it is missing, `Key: value` lines
// at the top of the body are used instead. Pure functions only — no vscode imports.

import type { CostEntry, Decision, Escalation, EscalationKind, EscalationStatus, ProjectStatus, Task, TaskStatus } from './model';

export type FmScalar = string | number | boolean | null;
export type FmValue = FmScalar | FmScalar[];

export interface Frontmatter {
  data: Record<string, FmValue>;
  body: string;
  hasFrontmatter: boolean;
}

// ---------------------------------------------------------------------------
// Frontmatter (YAML subset: scalars, quoted strings, inline and block lists, block scalars)

function normalizeNewlines(text: string): string {
  return text.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n');
}

function unquote(raw: string): string {
  if (raw.length >= 2 && raw.startsWith('"') && raw.endsWith('"')) {
    try {
      return JSON.parse(raw) as string;
    } catch {
      return raw.slice(1, -1);
    }
  }
  if (raw.length >= 2 && raw.startsWith("'") && raw.endsWith("'")) {
    return raw.slice(1, -1).replace(/''/g, "'");
  }
  return raw;
}

function stripComment(raw: string): string {
  if (raw.startsWith('"') || raw.startsWith("'")) return raw;
  const idx = raw.search(/\s#/);
  return idx >= 0 ? raw.slice(0, idx).trimEnd() : raw;
}

export function parseScalar(raw: string): FmScalar {
  const value = stripComment(raw.trim());
  if (value === '' || value === '~' || value === 'null') return null;
  if (value === 'true') return true;
  if (value === 'false') return false;
  if (/^-?\d+(\.\d+)?$/.test(value)) return Number(value);
  return unquote(value);
}

function splitInlineList(inner: string): string[] {
  const items: string[] = [];
  let current = '';
  let quote: string | undefined;
  for (const ch of inner) {
    if (quote) {
      current += ch;
      if (ch === quote) quote = undefined;
    } else if (ch === '"' || ch === "'") {
      quote = ch;
      current += ch;
    } else if (ch === ',') {
      items.push(current);
      current = '';
    } else {
      current += ch;
    }
  }
  if (current.trim() !== '') items.push(current);
  return items.map((s) => s.trim()).filter((s) => s !== '');
}

export function parseFrontmatter(input: string): Frontmatter {
  const text = normalizeNewlines(input);
  if (!text.startsWith('---\n')) return { data: {}, body: text, hasFrontmatter: false };
  const lines = text.split('\n');
  const end = lines.findIndex((line, i) => i > 0 && /^(---|\.\.\.)\s*$/.test(line));
  if (end < 0) return { data: {}, body: text, hasFrontmatter: false };

  const data: Record<string, FmValue> = {};
  const fm = lines.slice(1, end);
  for (let i = 0; i < fm.length; i++) {
    const line = fm[i] ?? '';
    const match = /^([A-Za-z_Ѐ-ӿ][\wЀ-ӿ -]*?)\s*:(?:\s+(.*)|\s*)$/.exec(line);
    if (!match || /^\s/.test(line)) continue;
    const key = normalizeKey(match[1] ?? '');
    const rest = (match[2] ?? '').trim();

    if (rest === '|' || rest === '>' || rest === '|-' || rest === '>-') {
      const block: string[] = [];
      while (i + 1 < fm.length && (/^\s+/.test(fm[i + 1] ?? '') || (fm[i + 1] ?? '') === '')) {
        block.push((fm[++i] ?? '').replace(/^\s{1,4}/, ''));
      }
      const joined = rest.startsWith('|') ? block.join('\n') : block.join(' ').replace(/\s+/g, ' ');
      data[key] = joined.trim();
      continue;
    }
    if (rest.startsWith('[') && rest.endsWith(']')) {
      data[key] = splitInlineList(rest.slice(1, -1)).map(parseScalar);
      continue;
    }
    if (rest === '') {
      const items: FmScalar[] = [];
      while (i + 1 < fm.length && /^\s*-\s+/.test(fm[i + 1] ?? '')) {
        items.push(parseScalar((fm[++i] ?? '').replace(/^\s*-\s+/, '')));
      }
      data[key] = items.length ? items : null;
      continue;
    }
    data[key] = parseScalar(rest);
  }
  const body = lines.slice(end + 1).join('\n').replace(/^\n+/, '');
  return { data, body, hasFrontmatter: true };
}

// ---------------------------------------------------------------------------
// Key normalization and inline `Key: value` fields

const KEY_ALIASES: Record<string, string> = {
  state: 'status',
  статус: 'status',
  состояние: 'status',
  owner: 'assignee',
  agent: 'assignee',
  executor: 'assignee',
  assigned_to: 'assignee',
  исполнитель: 'assignee',
  attempt: 'attempts',
  tries: 'attempts',
  retries: 'attempts',
  попытки: 'attempts',
  попытка: 'attempts',
  name: 'title',
  название: 'title',
  заголовок: 'title',
  ветка: 'branch',
  base_branch: 'base',
  task_id: 'task',
  задача: 'task',
  choices: 'options',
  варианты: 'options',
  вопрос: 'question',
  ответ: 'answer',
  type: 'kind',
  тип: 'kind',
  stage: 'phase',
  фаза: 'phase',
  этап: 'phase',
  created: 'created_at',
  date: 'created_at',
  файлы: 'files',
};

export function normalizeKey(raw: string): string {
  const key = raw.trim().toLowerCase().replace(/[\s-]+/g, '_');
  return KEY_ALIASES[key] ?? key;
}

/** `Status: todo`, `**Status:** todo`, `- **Assignee**: backend` in the first lines of a body. */
export function parseInlineFields(body: string, maxLines = 40): Record<string, string> {
  const fields: Record<string, string> = {};
  const lines = body.split('\n').slice(0, maxLines);
  const re = /^\s*(?:[-*]\s+)?(?:\*\*|__)?([A-Za-zЀ-ӿ][\wЀ-ӿ -]{0,30}?)(?:\s*:\s*(?:\*\*|__)|(?:\*\*|__)?\s*:)\s*(.+?)\s*$/;
  for (const line of lines) {
    if (/^#{2,}\s/.test(line) && Object.keys(fields).length) break;
    const m = re.exec(line);
    if (!m) continue;
    const key = normalizeKey(m[1] ?? '');
    if (!(key in fields)) fields[key] = (m[2] ?? '').replace(/^[`*_]+|[`*_]+$/g, '').trim();
  }
  return fields;
}

type Fields = Record<string, FmValue>;

function mergedFields(text: string): { fields: Fields; body: string } {
  const fm = parseFrontmatter(text);
  const inline = fm.hasFrontmatter ? {} : parseInlineFields(fm.body);
  return { fields: { ...inline, ...fm.data }, body: fm.body };
}

function str(value: FmValue | undefined): string | undefined {
  if (value === undefined || value === null) return undefined;
  if (Array.isArray(value)) return value.filter((v) => v !== null).join(', ') || undefined;
  const s = String(value).trim();
  return s === '' ? undefined : s;
}

function list(value: FmValue | undefined): string[] {
  if (value === undefined || value === null) return [];
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

function baseName(path: string): string {
  const file = path.split(/[\\/]/).pop() ?? path;
  return file.replace(/\.md$/i, '');
}

function firstHeading(body: string): string | undefined {
  const m = /^#\s+(.+?)\s*#*\s*$/m.exec(body);
  return m?.[1]?.trim();
}

function stripIdPrefix(title: string, id: string): string {
  const escaped = id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return title.replace(new RegExp(`^${escaped}\\s*[:.\\-—–]\\s*`, 'i'), '').trim() || title;
}

/** Markdown section body under `## <one of names>` until the next heading of the same or higher level. */
export function section(body: string, names: string[]): string | undefined {
  const lines = body.split('\n');
  const wanted = names.map((n) => n.toLowerCase());
  for (let i = 0; i < lines.length; i++) {
    const m = /^(#{2,4})\s+(.+?)\s*:?\s*$/.exec(lines[i] ?? '');
    if (!m || !wanted.includes((m[2] ?? '').toLowerCase())) continue;
    const level = (m[1] ?? '').length;
    const out: string[] = [];
    for (let j = i + 1; j < lines.length; j++) {
      const h = /^(#{1,6})\s/.exec(lines[j] ?? '');
      if (h && (h[1] ?? '').length <= level) break;
      out.push(lines[j] ?? '');
    }
    const text = out.join('\n').trim();
    return text === '' ? undefined : text;
  }
  return undefined;
}

function listItems(markdown: string): string[] {
  return markdown
    .split('\n')
    .map((l) => /^\s*(?:[-*+]|\d+[.)])\s+(?:\[[ xX]\]\s+)?(.+?)\s*$/.exec(l)?.[1])
    .filter((s): s is string => Boolean(s))
    .map((s) => s.replace(/^\*\*(.+?)\*\*/, '$1').replace(/^`(.+?)`$/, '$1').trim());
}

function firstParagraph(body: string): string | undefined {
  const paragraphs = body
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .filter((p) => p !== '' && !p.startsWith('#') && !p.startsWith('---'));
  return paragraphs[0];
}

// ---------------------------------------------------------------------------
// Tasks

const STATUS_ALIASES: Record<string, TaskStatus> = {
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

export function normalizeTaskStatus(raw: string | undefined): TaskStatus {
  if (!raw) return 'todo';
  const key = raw.trim().toLowerCase().replace(/[\s-]+/g, '_');
  return STATUS_ALIASES[key] ?? 'todo';
}

export function parseTask(text: string, path: string): Task {
  const { fields, body } = mergedFields(text);
  const id = str(fields.id) ?? baseName(path);
  const heading = firstHeading(body);
  const title = str(fields.title) ?? (heading ? stripIdPrefix(heading, id) : id);
  const task: Task = {
    id,
    title,
    status: normalizeTaskStatus(str(fields.status)),
    attempts: int(fields.attempts),
    files: list(fields.files),
    path,
  };
  const assignee = str(fields.assignee);
  const branch = str(fields.branch);
  const base = str(fields.base);
  if (assignee) task.assignee = assignee;
  if (branch) task.branch = branch;
  if (base) task.base = base;
  return task;
}

// ---------------------------------------------------------------------------
// Escalations

const ESCALATION_STATUS_ALIASES: Record<string, EscalationStatus> = {
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

function normalizeEscalationKind(raw: string | undefined): EscalationKind {
  const key = (raw ?? '').trim().toLowerCase().replace(/[\s_]+/g, '-');
  if (key === 'permission' || key === 'approval') return 'permission';
  if (key === 'brief-review' || key === 'brief' || key === 'review') return 'brief-review';
  return 'question';
}

export function parseEscalation(text: string, path: string): Escalation {
  const { fields, body } = mergedFields(text);
  const id = str(fields.id) ?? baseName(path);
  const heading = firstHeading(body);
  const question =
    str(fields.question) ??
    section(body, ['Question', 'Вопрос', 'Problem', 'Проблема', 'Context', 'Контекст']) ??
    firstParagraph(body) ??
    heading ??
    id;
  const optionsFromFields = list(fields.options);
  const optionsSection = section(body, ['Options', 'Варианты', 'Choices', 'Варианты ответа']);
  const options = optionsFromFields.length ? optionsFromFields : optionsSection ? listItems(optionsSection) : [];
  const answer = str(fields.answer) ?? section(body, ['Answer', 'Ответ', 'Decision', 'Решение']);
  const rawStatus = str(fields.status)?.toLowerCase().replace(/[\s-]+/g, '_');
  const status: EscalationStatus =
    (rawStatus ? ESCALATION_STATUS_ALIASES[rawStatus] : undefined) ?? (answer ? 'answered' : 'open');

  const escalation: Escalation = {
    id,
    title: str(fields.title) ?? (heading ? stripIdPrefix(heading, id) : truncate(question, 80)),
    question,
    options,
    status,
    kind: normalizeEscalationKind(str(fields.kind)),
    path,
  };
  const task = str(fields.task);
  const agent = str(fields.assignee) ?? str(fields.from);
  const createdAt = str(fields.created_at);
  if (task) escalation.task = task;
  if (agent) escalation.agent = agent;
  if (answer) escalation.answer = answer;
  if (createdAt) escalation.createdAt = createdAt;
  return escalation;
}

export function nextEscalationId(existing: Iterable<string>): string {
  let max = 0;
  for (const id of existing) {
    const m = /^E-(\d+)/i.exec(id);
    if (m) max = Math.max(max, Number(m[1]));
  }
  return `E-${String(max + 1).padStart(3, '0')}`;
}

// ---------------------------------------------------------------------------
// Decisions (ADR)

export function parseDecision(text: string, path: string): Decision {
  const { fields, body } = mergedFields(text);
  const file = baseName(path);
  const idMatch = /^(ADR-\d+)/i.exec(file);
  const id = str(fields.id) ?? (idMatch?.[1] ? idMatch[1].toUpperCase() : file);
  const heading = firstHeading(body);
  const slugTitle = file
    .slice(idMatch?.[1]?.length ?? 0)
    .replace(/^[-_]+/, '')
    .replace(/[-_]+/g, ' ')
    .trim();
  const decision: Decision = {
    id,
    title: str(fields.title) ?? (heading ? stripIdPrefix(heading, id) : slugTitle || id),
    path,
  };
  const status = str(fields.status) ?? parseInlineFields(body).status;
  if (status) decision.status = status;
  return decision;
}

// ---------------------------------------------------------------------------
// Status

export function parseStatus(text: string): ProjectStatus {
  const { fields, body } = mergedFields(text);
  const status: ProjectStatus = {};
  const phase = str(fields.phase) ?? str(fields.status);
  const summary = firstParagraph(body.replace(/^\s*(?:[-*]\s+)?(?:\*\*|__)?[\wЀ-ӿ -]{1,30}(?:\*\*|__)?\s*:.*$/gm, ''));
  if (phase) status.phase = phase;
  if (summary) status.summary = truncate(summary, 280);
  return status;
}

// ---------------------------------------------------------------------------
// costs.log

const COST_KEYS: Record<string, keyof CostEntry> = {
  ts: 'timestamp',
  time: 'timestamp',
  timestamp: 'timestamp',
  session: 'sessionId',
  session_id: 'sessionId',
  sid: 'sessionId',
  cost: 'costUsd',
  cost_usd: 'costUsd',
  usd: 'costUsd',
  delta_usd: 'costUsd',
  turn_cost_usd: 'costUsd',
  total: 'sessionTotalUsd',
  total_usd: 'sessionTotalUsd',
  total_cost_usd: 'sessionTotalUsd',
  session_total_usd: 'sessionTotalUsd',
  source: 'source',
};

function toNumber(raw: unknown): number | undefined {
  const n = typeof raw === 'number' ? raw : Number.parseFloat(String(raw).replace(/^\$/, ''));
  return Number.isFinite(n) && n >= 0 ? n : undefined;
}

function assignCost(entry: CostEntry, rawKey: string, value: unknown): void {
  const key = COST_KEYS[rawKey.toLowerCase()];
  if (!key) return;
  if (key === 'costUsd' || key === 'sessionTotalUsd') {
    const n = toNumber(value);
    if (n !== undefined) entry[key] = n;
  } else if (value !== undefined && value !== null && String(value) !== '') {
    entry[key] = String(value);
  }
}

export function parseCostLine(line: string): CostEntry | undefined {
  const trimmed = line.trim();
  if (trimmed === '' || trimmed.startsWith('#')) return undefined;
  const entry: CostEntry = { timestamp: '' };

  if (trimmed.startsWith('{')) {
    try {
      const obj = JSON.parse(trimmed) as Record<string, unknown>;
      for (const [k, v] of Object.entries(obj)) assignCost(entry, k, v);
    } catch {
      return undefined;
    }
  } else {
    const tokens = trimmed.split(/\s+/);
    const loose: string[] = [];
    for (const token of tokens) {
      const eq = token.indexOf('=');
      if (eq > 0) assignCost(entry, token.slice(0, eq), token.slice(eq + 1));
      else loose.push(token);
    }
    if (!entry.timestamp && loose[0] && /^\d{4}-\d{2}-\d{2}/.test(loose[0])) entry.timestamp = loose[0];
    if (entry.costUsd === undefined && entry.sessionTotalUsd === undefined) {
      const amount = loose.slice(1).map(toNumber).find((n) => n !== undefined);
      if (amount !== undefined) entry.costUsd = amount;
    }
  }
  if (entry.costUsd === undefined && entry.sessionTotalUsd === undefined) return undefined;
  return entry;
}

export function parseCostsLog(text: string): CostEntry[] {
  return normalizeNewlines(text)
    .split('\n')
    .map(parseCostLine)
    .filter((e): e is CostEntry => e !== undefined);
}

export function formatCostEntry(entry: CostEntry): string {
  const parts = [entry.timestamp];
  if (entry.sessionId) parts.push(`session=${entry.sessionId}`);
  if (entry.costUsd !== undefined) parts.push(`turn_cost_usd=${entry.costUsd.toFixed(6)}`);
  if (entry.sessionTotalUsd !== undefined) parts.push(`session_total_usd=${entry.sessionTotalUsd.toFixed(6)}`);
  if (entry.source) parts.push(`source=${entry.source}`);
  return parts.join(' ');
}

/**
 * Total project spend. Per session, the highest running total wins (the SDK reports cumulative
 * totals, and a resumed session continues from its saved total); entries without a running
 * total are summed.
 */
export function projectSpentUsd(entries: CostEntry[], excludeSessionId?: string): number {
  const totals = new Map<string, number>();
  const deltas = new Map<string, number>();
  let loose = 0;
  for (const e of entries) {
    if (excludeSessionId && e.sessionId === excludeSessionId) continue;
    if (e.sessionId && e.sessionTotalUsd !== undefined) {
      totals.set(e.sessionId, Math.max(totals.get(e.sessionId) ?? 0, e.sessionTotalUsd));
    } else if (e.sessionId && e.costUsd !== undefined) {
      deltas.set(e.sessionId, (deltas.get(e.sessionId) ?? 0) + e.costUsd);
    } else if (e.costUsd !== undefined) {
      loose += e.costUsd;
    } else if (e.sessionTotalUsd !== undefined) {
      loose += e.sessionTotalUsd;
    }
  }
  let sum = loose;
  for (const v of totals.values()) sum += v;
  for (const [session, v] of deltas) if (!totals.has(session)) sum += v;
  return sum;
}

/** Highest running total recorded for one session (0 when none). */
export function sessionTotalUsd(entries: CostEntry[], sessionId: string): number {
  let max = 0;
  for (const e of entries) {
    if (e.sessionId === sessionId && e.sessionTotalUsd !== undefined) max = Math.max(max, e.sessionTotalUsd);
  }
  return max;
}

// ---------------------------------------------------------------------------
// Writers (used for escalation answers and status notes)

type FieldValue = string | number | boolean | string[];

function yamlValue(value: FieldValue): string {
  if (Array.isArray(value)) return `[${value.map((v) => JSON.stringify(v)).join(', ')}]`;
  if (typeof value !== 'string') return String(value);
  const plain = /^[\wЀ-ӿ][\wЀ-ӿ .,/@+()-]*$/.test(value) && !/^(true|false|null|~|-?\d+(\.\d+)?)$/.test(value);
  return plain ? value : JSON.stringify(value);
}

/** Sets top-level frontmatter keys, preserving everything else. Adds frontmatter when missing. */
export function setFrontmatterFields(input: string, fields: Record<string, FieldValue>): string {
  const text = normalizeNewlines(input);
  const lines = text.split('\n');
  const hasFm = lines[0] === '---' && lines.findIndex((l, i) => i > 0 && /^(---|\.\.\.)\s*$/.test(l)) > 0;
  if (!hasFm) {
    const fm = Object.entries(fields).map(([k, v]) => `${k}: ${yamlValue(v)}`);
    return ['---', ...fm, '---', '', text.replace(/^\n+/, '')].join('\n');
  }
  let end = lines.findIndex((l, i) => i > 0 && /^(---|\.\.\.)\s*$/.test(l));
  for (const [key, value] of Object.entries(fields)) {
    const rendered = `${key}: ${yamlValue(value)}`;
    const idx = lines.findIndex((l, i) => i > 0 && i < end && new RegExp(`^${key}\\s*:`).test(l));
    if (idx >= 0) {
      let stop = idx + 1;
      while (stop < end && /^(\s+|\s*-\s)/.test(lines[stop] ?? '')) stop++;
      lines.splice(idx, stop - idx, rendered);
      end -= stop - idx - 1;
    } else {
      lines.splice(end, 0, rendered);
      end++;
    }
  }
  return lines.join('\n');
}

export function applyEscalationAnswer(text: string, answer: string, answeredAt: string): string {
  const withFields = setFrontmatterFields(text, { status: 'answered', answer, answered_at: answeredAt });
  const fm = parseFrontmatter(withFields);
  const hasSection = section(fm.body, ['Answer', 'Ответ']) !== undefined || /^##\s+(Answer|Ответ)\s*$/im.test(fm.body);
  if (hasSection) return withFields;
  return `${withFields.replace(/\n+$/, '')}\n\n## Answer\n\n${answer}\n`;
}

export function renderEscalationFile(esc: Escalation): string {
  const fields: Record<string, FieldValue> = { id: esc.id, kind: esc.kind, status: esc.status };
  if (esc.task) fields.task = esc.task;
  if (esc.agent) fields.agent = esc.agent;
  if (esc.createdAt) fields.created_at = esc.createdAt;
  fields.options = esc.options;
  const front = Object.entries(fields).map(([k, v]) => `${k}: ${yamlValue(v)}`);
  const parts = ['---', ...front, '---', '', `# ${esc.title}`, '', '## Question', '', esc.question, ''];
  if (esc.options.length) parts.push('## Options', '', ...esc.options.map((o, i) => `${i + 1}. ${o}`), '');
  if (esc.answer) parts.push('## Answer', '', esc.answer, '');
  return parts.join('\n');
}

export function appendStatusNote(text: string, note: string): string {
  const base = normalizeNewlines(text).replace(/\n+$/, '');
  return `${base}${base ? '\n\n' : ''}> ${note}\n`;
}

export function truncate(text: string, max: number): string {
  const oneLine = text.replace(/\s+/g, ' ').trim();
  return oneLine.length > max ? `${oneLine.slice(0, max - 1)}…` : oneLine;
}
