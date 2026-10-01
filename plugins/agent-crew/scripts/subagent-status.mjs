#!/usr/bin/env node
// Row text for the crew's agents in Claude Code's agent panel (settings.json → subagentStatusLine):
// "backend · T-004 Booking server functions · working · 23k tokens · 2m" instead of the generic
// name and description. Rows of other agents are left to Claude Code. Never fails: a broken
// status line must not disturb the session.

import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { mainCheckout } from '../lib/worktree.mjs';

const WORDS = { running: 'working', in_progress: 'working', pending: 'waiting', queued: 'waiting', completed: 'done', done: 'done', failed: 'failed', error: 'failed', cancelled: 'stopped', killed: 'stopped' };

function taskTitle(root, id) {
  try {
    const dir = path.join(root, '.crew', 'tasks');
    const file = readdirSync(dir).find((n) => n.toUpperCase().startsWith(id));
    const m = file && /^title:\s*"?(.+?)"?\s*$/m.exec(readFileSync(path.join(dir, file), 'utf8'));
    return m ? m[1] : undefined;
  } catch {
    return undefined;
  }
}

function elapsed(start, now) {
  const t = typeof start === 'number' ? start : Date.parse(String(start ?? ''));
  if (!Number.isFinite(t)) return undefined;
  const s = Math.max(0, Math.round((now - t) / 1000));
  return s < 60 ? `${s}s` : s < 3600 ? `${Math.floor(s / 60)}m` : `${Math.floor(s / 3600)}h${String(Math.floor((s % 3600) / 60)).padStart(2, '0')}m`;
}

/** @returns {{ id: string, content: string }[]} rows to override */
export function rows(input, now = Date.now()) {
  const root = mainCheckout(path.resolve(String(input?.cwd ?? process.cwd())));
  const width = Number(input?.columns) > 20 ? Number(input.columns) : 100;
  const out = [];
  for (const task of Array.isArray(input?.tasks) ? input.tasks : []) {
    const text = [task.type, task.name, task.label, task.description].map((v) => String(v ?? '')).join('\n');
    const role = /agent-crew:([a-z]+)/.exec(text)?.[1];
    if (!role || !task.id) continue;
    const id = /\bT-\d{3,}\b/i.exec(text)?.[0].toUpperCase();
    const title = id ? taskTitle(root, id) : undefined;
    const what = id ? `${id}${title ? ` ${title}` : ''}` : String(task.description ?? task.label ?? '').replace(/\s+/g, ' ').trim();
    const tokens = Number(task.tokenCount) > 0 ? `${Number(task.tokenCount) >= 1000 ? `${Math.round(Number(task.tokenCount) / 1000)}k` : task.tokenCount} tokens` : undefined;
    const parts = [role, what, WORDS[String(task.status ?? '').toLowerCase()] ?? task.status, tokens, elapsed(task.startTime, now)].filter(Boolean);
    let content = parts.join(' · ');
    if (content.length > width) content = `${content.slice(0, Math.max(0, width - 1))}…`;
    out.push({ id: String(task.id), content });
  }
  return out;
}

if (process.argv[1] && process.argv[1].endsWith('subagent-status.mjs')) {
  try {
    const input = JSON.parse(readFileSync(0, 'utf8') || '{}');
    for (const row of rows(input)) process.stdout.write(`${JSON.stringify(row)}\n`);
  } catch {
    // keep Claude Code's own rows
  }
}
