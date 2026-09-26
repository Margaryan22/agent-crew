// Reads the whole .crew/ directory into a CrewSnapshot through an injectable file reader,
// so it can run against vscode.workspace.fs in the extension and an in-memory map in tests.

import { CREW_DIR, CREW_PATHS, type CrewSnapshot, EMPTY_SNAPSHOT, type Escalation, type Task } from './model';
import { parseCostsLog, parseDecision, parseEscalation, parseStatus, parseTask } from './parser';

export interface CrewReader {
  /** File names (not paths) in a workspace-relative directory; [] when it does not exist. */
  list(dir: string): Promise<string[]>;
  /** File content, or undefined when it does not exist. */
  read(path: string): Promise<string | undefined>;
  exists(path: string): Promise<boolean>;
}

const byId = (a: { id: string }, b: { id: string }) => a.id.localeCompare(b.id, undefined, { numeric: true });

async function readAll<T>(reader: CrewReader, dir: string, filter: (name: string) => boolean, parse: (text: string, path: string) => T): Promise<T[]> {
  const names = (await reader.list(dir)).filter(filter);
  const items = await Promise.all(
    names.map(async (name) => {
      const path = `${dir}/${name}`;
      const text = await reader.read(path);
      return text === undefined ? undefined : parse(text, path);
    }),
  );
  return items.filter((x): x is Awaited<T> => x !== undefined) as T[];
}

const isMarkdown = (name: string) => name.toLowerCase().endsWith('.md') && !name.startsWith('.') && name.toLowerCase() !== 'readme.md';

export async function loadSnapshot(reader: CrewReader): Promise<CrewSnapshot> {
  if (!(await reader.exists(CREW_DIR))) return EMPTY_SNAPSHOT;
  const [tasks, escalations, decisions, costsText, statusText, hasBrief] = await Promise.all([
    readAll<Task>(reader, CREW_PATHS.tasks, isMarkdown, parseTask),
    readAll<Escalation>(reader, CREW_PATHS.escalations, isMarkdown, parseEscalation),
    readAll(reader, CREW_PATHS.decisions, (n) => isMarkdown(n) && /^adr-/i.test(n), parseDecision),
    reader.read(CREW_PATHS.costs),
    reader.read(CREW_PATHS.status),
    reader.exists(CREW_PATHS.brief),
  ]);
  const snapshot: CrewSnapshot = {
    exists: true,
    tasks: tasks.sort(byId),
    escalations: escalations.sort(byId),
    decisions: decisions.sort(byId),
    costs: costsText ? parseCostsLog(costsText) : [],
    hasBrief,
  };
  if (statusText !== undefined) snapshot.status = parseStatus(statusText);
  return snapshot;
}
