// Lessons the crew keeps from one project to the next: one line each, for one role or for all.
// Hand-written (unlike crew-contract.mjs next to it) and shared by the crew CLI and the hooks.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

export const LESSONS_FILE = 'lessons.md';
export const MAX_LESSON_LENGTH = 240;
const MAX_KEPT = 200;
const HEADER = '# Lessons\n\nWhat earlier runs learned the hard way, newest last. One line each: `- [role] lesson (date)`.\n\n';

/** @returns {{ role: string, text: string, date?: string }[]} */
export function parseLessons(text) {
  const out = [];
  for (const line of String(text ?? '').split('\n')) {
    const m = /^- \[([a-z-]+)\] (.+?)(?: \((\d{4}-\d{2}-\d{2})\))?$/.exec(line.trim());
    if (m) out.push({ role: m[1], text: m[2].trim(), ...(m[3] ? { date: m[3] } : {}) });
  }
  return out;
}

const key = (l) => `${l.role}|${l.text.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim()}`;

/** One line, no markup that could break the list; undefined when nothing usable is left. */
export function cleanLesson(text) {
  const one = String(text ?? '').replace(/\s+/g, ' ').replace(/^[-*\s]+/, '').trim();
  return one ? one.slice(0, MAX_LESSON_LENGTH) : undefined;
}

export function readLessons(file) {
  try {
    return parseLessons(readFileSync(file, 'utf8'));
  } catch {
    return [];
  }
}

/** Appends a lesson unless the file already has it; returns whether it was added. */
export function addLesson(file, lesson) {
  const existing = existsSync(file) ? readLessons(file) : [];
  if (existing.some((l) => key(l) === key(lesson))) return false;
  const kept = [...existing, lesson].slice(-MAX_KEPT);
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, `${HEADER}${kept.map((l) => `- [${l.role}] ${l.text}${l.date ? ` (${l.date})` : ''}`).join('\n')}\n`);
  return true;
}

/** The newest lessons that concern a role, from several files (later files win ties), without repeats. */
export function lessonsFor(role, files, max) {
  const seen = new Set();
  const all = [];
  for (const l of files.flatMap(readLessons)) {
    if (role !== 'orchestrator' && l.role !== role && l.role !== 'all') continue;
    if (seen.has(key(l))) continue;
    seen.add(key(l));
    all.push(l);
  }
  return all.slice(-max);
}
