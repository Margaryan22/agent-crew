// Reads a whole .crew/ folder into a CrewSnapshot through an injectable reader, so the same code
// runs against vscode.workspace.fs in the extension and an in-memory map in unit tests.
// Reading is lenient (hand-edited and older files still show up); strict issues become a count.

import {
  AUTHORITATIVE_SOURCES,
  CONTRACT_VERSION,
  CREW_PATHS,
  estimatedTokens,
  parseChecklist,
  parseCostsLog,
  projectSpentUsd,
  readDecision,
  readEscalation,
  readStatus,
  readTask,
} from '../../../crew-contract/src/index';
import { type CrewSnapshot, EMPTY_SNAPSHOT, type ManifestView, type SessionView, type SpendView } from './model';

export interface CrewReader {
  /** File names (not paths) in a workspace-relative directory; [] when it does not exist. */
  list(dir: string): Promise<string[]>;
  /** File content, or undefined when it does not exist. */
  read(path: string): Promise<string | undefined>;
  exists(path: string): Promise<boolean>;
}

const idNumber = (id: string) => Number(/\d+/.exec(id)?.[0] ?? 0);
const byId = (a: { id: string }, b: { id: string }) => idNumber(a.id) - idNumber(b.id) || a.id.localeCompare(b.id);
const isMarkdown = (name: string) => name.toLowerCase().endsWith('.md') && !name.startsWith('.') && name.toLowerCase() !== 'readme.md';

async function readDir<T>(reader: CrewReader, dir: string, keep: (name: string) => boolean, parse: (text: string, path: string) => T): Promise<T[]> {
  const names = (await reader.list(dir)).filter(keep);
  const items = await Promise.all(
    names.map(async (name) => {
      const path = `${dir}/${name}`;
      const text = await reader.read(path);
      return text === undefined ? undefined : parse(text, path);
    }),
  );
  return items.filter((x): x is Awaited<T> => x !== undefined) as T[];
}

function parseJson(text: string | undefined): Record<string, unknown> | undefined {
  if (!text) return undefined;
  try {
    const value: unknown = JSON.parse(text);
    return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : undefined;
  } catch {
    return undefined;
  }
}

function manifestView(json: Record<string, unknown> | undefined): ManifestView | undefined {
  if (!json) return undefined;
  const plugin = json.plugin as { version?: unknown } | undefined;
  const view: ManifestView = {};
  if (typeof json.contract_version === 'number') view.contractVersion = json.contract_version;
  if (typeof json.stack_profile === 'string') view.stackProfile = json.stack_profile;
  if (typeof json.language === 'string') view.language = json.language;
  if (typeof plugin?.version === 'string') view.pluginVersion = plugin.version;
  return view;
}

async function latestSession(reader: CrewReader): Promise<SessionView | undefined> {
  const markers = await readDir(reader, CREW_PATHS.sessions, (n) => n.endsWith('.json'), (text) => parseJson(text));
  let best: SessionView | undefined;
  for (const m of markers) {
    if (!m || typeof m.session_id !== 'string' || typeof m.started_at !== 'string') continue;
    if (best && m.started_at <= best.startedAt) continue;
    const config = m.config as { budgetCapUsd?: unknown } | undefined;
    best = { id: m.session_id, command: String(m.command ?? ''), startedAt: m.started_at };
    if (typeof config?.budgetCapUsd === 'number') best.capUsd = config.budgetCapUsd;
  }
  return best;
}

function spendView(costsText: string | undefined): SpendView {
  const entries = costsText ? parseCostsLog(costsText).entries : [];
  const reported = entries.some((e) => AUTHORITATIVE_SOURCES.includes(e.source));
  const estimate = entries.filter((e) => e.source === 'estimate').reduce((sum, e) => sum + (e.turn_cost_usd ?? 0), 0);
  return {
    usedUsd: Math.round((reported ? projectSpentUsd(entries) : estimate) * 100) / 100,
    basis: reported ? 'reported' : 'estimate',
    estimatedTokens: estimatedTokens(entries),
  };
}

export async function loadSnapshot(reader: CrewReader): Promise<CrewSnapshot> {
  if (!(await reader.exists('.crew'))) return EMPTY_SNAPSHOT;
  const [manifestText, tasks, escalations, decisions, statusText, checklistText, costsText, session, brief, report] = await Promise.all([
    reader.read(CREW_PATHS.manifest),
    readDir(reader, CREW_PATHS.tasks, isMarkdown, readTask),
    readDir(reader, CREW_PATHS.escalations, isMarkdown, readEscalation),
    readDir(reader, CREW_PATHS.decisions, (n) => isMarkdown(n) && /^adr-\d/i.test(n), readDecision),
    reader.read(CREW_PATHS.status),
    reader.read(CREW_PATHS.accessChecklist),
    reader.read(CREW_PATHS.costs),
    latestSession(reader),
    reader.exists(CREW_PATHS.brief),
    reader.exists(CREW_PATHS.report),
  ]);

  const manifest = manifestView(parseJson(manifestText));
  const problems: string[] = [];
  if (manifest?.contractVersion !== undefined && manifest.contractVersion > CONTRACT_VERSION) {
    problems.push(`This project was created by a newer agent-crew plugin (contract ${manifest.contractVersion}); update the Agent Crew extension to see everything.`);
  }
  const invalid = [...tasks, ...escalations, ...decisions].filter((r) => r.issues.length > 0).length;
  if (invalid) problems.push(`${invalid} file${invalid > 1 ? 's' : ''} in .crew/ do${invalid > 1 ? '' : 'es'} not match the contract; run \`crew validate\` in the project.`);

  const snapshot: CrewSnapshot = {
    exists: true,
    initialised: manifest !== undefined,
    tasks: tasks.map((t) => t.value).sort(byId),
    escalations: escalations.map((e) => e.value).sort(byId),
    decisions: decisions.map((d) => d.value).sort(byId),
    checklist: checklistText ? parseChecklist(checklistText) : [],
    spend: spendView(costsText),
    files: { brief, report, accessChecklist: checklistText !== undefined },
    problems,
  };
  if (manifest) snapshot.manifest = manifest;
  if (statusText !== undefined) snapshot.status = readStatus(statusText).value;
  if (session) snapshot.latestSession = session;
  return snapshot;
}

// ---------------------------------------------------------------------------
// Derived figures for the views

export interface Progress {
  total: number;
  done: number;
  inProgress: number;
  review: number;
  blocked: number;
  /** Escalations waiting for the human plus access items still open. */
  needsYou: number;
}

export function progress(s: CrewSnapshot): Progress {
  const count = (status: string) => s.tasks.filter((t) => t.status === status).length;
  return {
    total: s.tasks.length,
    done: count('done'),
    inProgress: count('in_progress'),
    review: count('review'),
    blocked: count('blocked'),
    needsYou: s.escalations.filter((e) => e.status === 'open').length + s.checklist.filter((i) => !i.done).length,
  };
}
