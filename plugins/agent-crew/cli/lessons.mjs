// `crew lesson`: what a run learned, kept for the next one. Lessons go into the project
// (.crew/lessons.md) and, when the session told us where the plugin keeps its data, into the
// user's own collection there, which every later project reads.

import path from 'node:path';
import * as C from '../lib/crew-contract.mjs';
import { addLesson, cleanLesson, LESSONS_FILE, lessonsFor } from '../lib/lessons.mjs';
import { consentFor, resetConsent } from '../lib/consent.mjs';
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

/** `crew approvals show|reset`: the user's standing approval. It is granted only by answering the crew's question (or the plugin setting), never from here. */
export function approvalsShow(project, args, io) {
  args.done();
  const setting = project.config().approvals;
  const dataDir = project.latestMarker()?.data_dir;
  const answered = typeof dataDir === 'string' && dataDir ? consentFor(dataDir, project.root) : undefined;
  const mode = setting === 'auto' || setting === 'manual' ? setting : (answered ?? 'not asked yet');
  io.log(`Permission prompts: ${mode === 'auto' ? 'off — the crew works without asking, within its safeguards' : mode === 'manual' ? 'on — Claude Code asks before each action' : 'not decided — the crew asks once at the start of its next run'}${setting !== 'ask-first-time' ? ' (plugin setting)' : ''}.`);
}

export function approvalsReset(project, args, io) {
  args.done();
  const dataDir = project.latestMarker()?.data_dir;
  if (typeof dataDir !== 'string' || !dataDir) throw new UsageError('no crew session has run here yet, so there is nothing to reset');
  resetConsent(dataDir);
  io.log('Standing approval removed for every project. The crew asks again at the start of its next run.');
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
