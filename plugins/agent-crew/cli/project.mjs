// A crew project on disk: finds the root, reads and writes .crew/ files through the contract,
// and resolves the crew config.

import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import * as C from '../lib/crew-contract.mjs';
import { mainCheckout } from '../lib/worktree.mjs';
import { UsageError } from './args.mjs';

export { C };

export class NotFoundError extends Error {}
export class StateError extends Error {}

/** Walks up from `cwd` to the directory that holds `.crew/`. */
export function findRoot(cwd) {
  // In an executor's own git worktree the checked-out .crew/ is a stale copy: the run's state is
  // the main checkout's, and that is the one every crew command reads and writes.
  let dir = path.resolve(mainCheckout(cwd));
  for (;;) {
    if (existsSync(path.join(dir, C.CREW_DIR)) && statSync(path.join(dir, C.CREW_DIR)).isDirectory()) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) return undefined;
    dir = parent;
  }
}

export function isoNow(date = new Date()) {
  return date.toISOString().replace(/\.\d{3}Z$/, 'Z');
}

export class Project {
  /** @param {string} root @param {{ now?: () => Date, env?: Record<string, string | undefined> }} [options] */
  constructor(root, options = {}) {
    this.root = root;
    this.clock = options.now ?? (() => new Date());
    this.env = options.env ?? process.env;
  }

  now() {
    return isoNow(this.clock());
  }

  abs(rel) {
    return path.join(this.root, rel);
  }

  exists(rel) {
    return existsSync(this.abs(rel));
  }

  read(rel) {
    return readFileSync(this.abs(rel), 'utf8');
  }

  readIfExists(rel) {
    return this.exists(rel) ? this.read(rel) : undefined;
  }

  async write(rel, text) {
    await C.writeFileAtomic(this.abs(rel), text);
  }

  /** File names (not paths) in a .crew/ subdirectory, sorted. */
  list(relDir) {
    const dir = this.abs(relDir);
    return existsSync(dir) ? readdirSync(dir).filter((n) => !n.startsWith('.')).sort() : [];
  }

  // -------------------------------------------------------------------------
  // Tasks

  taskIds() {
    return this.list(C.CREW_PATHS.tasks)
      .map((n) => C.idFromFileName('task', n))
      .filter(Boolean)
      .sort((a, b) => C.idNumber('task', a) - C.idNumber('task', b));
  }

  /** @returns {{ id: string, rel: string, data: Record<string, any>, body: string }} */
  task(rawId) {
    const id = normalizeId('task', rawId);
    const rel = this.fileFor(C.CREW_PATHS.tasks, 'task', id);
    const parsed = C.parseFrontmatter(this.read(rel));
    return { id, rel, data: parsed.data, body: parsed.body };
  }

  tasks() {
    return this.taskIds().map((id) => this.task(id));
  }

  /** Validates and writes a task; `updated_at` is set here so every change is dated. */
  async saveTask(task, patch = {}) {
    const data = { ...task.data };
    for (const [k, v] of Object.entries(patch)) {
      if (v === undefined) delete data[k];
      else data[k] = v;
    }
    data.updated_at = this.now();
    await this.write(task.rel, renderOrThrow(() => C.renderTask(data, task.body)));
    return { ...task, data };
  }

  // -------------------------------------------------------------------------
  // Escalations and decisions

  escalationIds() {
    return this.list(C.CREW_PATHS.escalations)
      .map((n) => C.idFromFileName('escalation', n))
      .filter(Boolean);
  }

  escalation(rawId) {
    const id = normalizeId('escalation', rawId);
    const rel = this.fileFor(C.CREW_PATHS.escalations, 'escalation', id);
    const text = this.read(rel);
    return { id, rel, text, data: C.parseFrontmatter(text).data };
  }

  escalations() {
    return this.escalationIds().map((id) => this.escalation(id));
  }

  decisions() {
    return this.list(C.CREW_PATHS.decisions)
      .filter((n) => C.idFromFileName('decision', n))
      .map((n) => {
        const rel = `${C.CREW_PATHS.decisions}/${n}`;
        return { id: C.idFromFileName('decision', n), rel, data: C.parseFrontmatter(this.read(rel)).data };
      });
  }

  /** `.crew/tasks/T-004.md`, or a hand-named `T-004-login.md` when that is what exists. */
  fileFor(relDir, kind, id) {
    const exact = `${relDir}/${id}.md`;
    if (this.exists(exact)) return exact;
    const match = this.list(relDir).find((n) => C.idFromFileName(kind, n) === id);
    if (!match) throw new NotFoundError(`${id} not found in ${relDir}/`);
    return `${relDir}/${match}`;
  }

  // -------------------------------------------------------------------------
  // Costs and config

  costs() {
    const text = this.readIfExists(C.CREW_PATHS.costs);
    return text ? C.parseCostsLog(text).entries : [];
  }

  manifest() {
    const text = this.readIfExists(C.CREW_PATHS.manifest);
    if (!text) return undefined;
    try {
      return JSON.parse(text);
    } catch {
      return undefined;
    }
  }

  /**
   * Crew config: environment first (a host sets CREW_*; hooks see CLAUDE_PLUGIN_OPTION_*), then
   * the snapshot the plugin's hook stored in the newest session marker — the Bash tool may not
   * see the user's plugin options — then defaults.
   */
  config() {
    const { config, sources } = C.resolveCrewConfig(this.env);
    const snapshot = this.latestMarker()?.config;
    if (snapshot && typeof snapshot === 'object') {
      for (const key of Object.keys(config)) {
        if (sources[key] === 'default' && snapshot[key] !== undefined) config[key] = snapshot[key];
      }
    }
    return config;
  }

  /**
   * How much process this project gets. A setting other than `auto` decides; otherwise what the
   * orchestrator recorded with `crew size set`, and `standard` until it has.
   */
  size() {
    const setting = this.config().runSize;
    if (setting === 'prototype' || setting === 'standard') return setting;
    return this.manifest()?.size === 'prototype' ? 'prototype' : 'standard';
  }

  latestMarker() {
    let best;
    for (const name of this.list(C.CREW_PATHS.sessions)) {
      if (!name.endsWith('.json')) continue;
      try {
        const marker = JSON.parse(this.read(`${C.CREW_PATHS.sessions}/${name}`));
        if (!best || String(marker.started_at) > String(best.started_at)) best = marker;
      } catch {
        // a broken marker only loses its snapshot
      }
    }
    return best;
  }
}

/** `3`, `t-3`, `T-003` → `T-003`. */
export function normalizeId(kind, raw) {
  if (raw === undefined || raw === '') throw new UsageError(`missing ${kind} id`);
  const prefix = { task: 'T', escalation: 'E', decision: 'ADR' }[kind];
  const s = String(raw).trim();
  const n = /^\d+$/.test(s) ? Number(s) : C.idNumber(kind, s.toUpperCase());
  if (n === undefined || !Number.isFinite(n)) throw new UsageError(`"${raw}" is not a ${kind} id (expected ${prefix}-001)`);
  return C.formatId(kind, n);
}

/** Runs a contract renderer and turns schema errors into a readable message. */
export function renderOrThrow(render) {
  try {
    return render();
  } catch (err) {
    if (err && Array.isArray(err.issues)) {
      throw new UsageError(`the result would not match the .crew/ contract:\n- ${err.issues.map((i) => `${i.path?.length ? `${i.path.join('.')}: ` : ''}${i.message}`).join('\n- ')}`);
    }
    throw err;
  }
}

/** Short hash of an error message with volatile parts (numbers, hex ids, paths to tmp) removed. */
export function errorHash(message) {
  const normalized = String(message)
    .toLowerCase()
    .replace(/\/(?:tmp|var|private)\/\S+/g, '<tmp>')
    .replace(/\b[0-9a-f]{7,}\b/g, '<hex>')
    .replace(/\d+(\.\d+)?/g, '#')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 600);
  return createHash('sha256').update(normalized).digest('hex').slice(0, 12);
}

/** Adds a line at the end of the `## <heading>` section, creating the section at the end if needed. */
export function appendToSection(body, heading, line) {
  const lines = body.replace(/\n+$/, '').split('\n');
  const start = lines.findIndex((l) => l.trim().toLowerCase() === `## ${heading}`.toLowerCase());
  if (start < 0) return `${lines.join('\n')}\n\n## ${heading}\n\n${line}\n`;
  let end = lines.findIndex((l, i) => i > start && /^#{1,2}\s/.test(l));
  if (end < 0) end = lines.length;
  let last = end - 1;
  while (last > start && lines[last].trim() === '') last--;
  lines.splice(last + 1, 0, ...(last === start ? ['', line] : [line]));
  return `${lines.join('\n')}\n`;
}

/** Reads a body from --body, --body-file or stdin (`--body -`). */
export function readBody(args, stdin) {
  const file = args.str('body-file');
  const inline = args.str('body');
  if (file && inline !== undefined) throw new UsageError('use either --body or --body-file');
  if (file) return readFileSync(file, 'utf8');
  if (inline === '-') return stdin();
  return inline;
}
