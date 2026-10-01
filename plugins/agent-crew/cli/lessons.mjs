// `crew lesson`: what a run learned, kept for the next one. Lessons go into the project
// (.crew/lessons.md) and, when the session told us where the plugin keeps its data, into the
// user's own collection there, which every later project reads.

import path from 'node:path';
import * as C from '../lib/crew-contract.mjs';
import { addLesson, cleanLesson, LESSONS_FILE, lessonsFor } from '../lib/lessons.mjs';
import { UsageError } from './args.mjs';

const ROLES = ['all', ...C.KNOWN_AGENTS];

function files(project) {
  const dataDir = project.latestMarker()?.data_dir;
  return { project: project.abs(`${C.CREW_DIR}/${LESSONS_FILE}`), shared: typeof dataDir === 'string' && dataDir ? path.join(dataDir, LESSONS_FILE) : undefined };
}

export async function lessonAdd(project, args, io) {
  const text = cleanLesson(args.str('text'));
  const role = args.str('for') ?? 'all';
  args.done();
  if (!text) throw new UsageError('crew lesson add needs --text "<one sentence: what to do differently next time>"');
  if (!ROLES.includes(role)) throw new UsageError(`--for must be one of: ${ROLES.join(', ')}`);
  const lesson = { role, text, date: project.now().slice(0, 10) };
  const f = files(project);
  const added = addLesson(f.project, lesson);
  if (f.shared) addLesson(f.shared, lesson);
  io.log(added ? `Lesson kept for ${role === 'all' ? 'every agent' : role}${f.shared ? ', also for later projects' : ''}.` : 'That lesson is already recorded.');
}

export function lessonList(project, args, io) {
  const role = args.str('for') ?? 'orchestrator';
  const json = args.bool('json');
  args.done();
  const f = files(project);
  const lessons = lessonsFor(role, [f.shared, f.project].filter(Boolean), 200);
  if (json) io.json(lessons);
  else io.log(lessons.length ? lessons.map((l) => `[${l.role}] ${l.text}`).join('\n') : 'No lessons yet.');
}
