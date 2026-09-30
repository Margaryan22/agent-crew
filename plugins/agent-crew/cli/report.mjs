// Project-level commands: init, config, status, next, check (stuck detectors of SPEC §8 that
// need the whole project), budget, summary, validate, interview, id.

import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parsePairs, UsageError } from './args.mjs';
import { C, readBody, renderOrThrow } from './project.mjs';
import { taskLine } from './tasks.mjs';

const pluginRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function pluginVersion() {
  try {
    return JSON.parse(readFileSync(path.join(pluginRoot, '.claude-plugin', 'plugin.json'), 'utf8')).version ?? '0.0.0';
  } catch {
    return '0.0.0';
  }
}

// ---------------------------------------------------------------------------
// init / config

export async function init(project, args, io) {
  const stack = args.str('stack');
  const language = args.str('language');
  args.done();
  const existing = project.manifest();
  if (existing) {
    if (language && existing.language !== language) {
      const updated = renderOrThrow(() => C.renderManifest({ ...existing, language }));
      await project.write(C.CREW_PATHS.manifest, updated);
      io.log(`.crew/ already exists; language set to ${language}.`);
    } else {
      io.log(`.crew/ already exists (stack ${existing.stack_profile}${existing.language ? `, language ${existing.language}` : ''}).`);
    }
    await ensureGitignore(project);
    return;
  }
  const config = project.config();
  const manifest = {
    contract_version: C.CONTRACT_VERSION,
    plugin: { name: C.PLUGIN_NAME, version: pluginVersion() },
    stack_profile: stack ?? config.stackProfile,
    created_at: project.now(),
    ...(language ? { language } : {}),
  };
  await project.write(C.CREW_PATHS.manifest, renderOrThrow(() => C.renderManifest(manifest)));
  await ensureGitignore(project);
  if (!project.exists(C.CREW_PATHS.status)) {
    await project.write(C.CREW_PATHS.status, C.renderStatus({ phase: 'interview', updated_at: project.now(), summary: 'Project started.' }, '# Status\n\nProject started.\n'));
  }
  io.log(`Initialised .crew/ (stack ${manifest.stack_profile}${language ? `, language ${language}` : ''}).`);
}

const SCAFFOLD_SKIP = new Set(['node_modules', '.output', 'dist', 'test-results', 'playwright-report', '.tanstack', '.DS_Store']);

function templateFiles(dir, base = dir) {
  const out = [];
  for (const name of readdirSync(dir)) {
    if (SCAFFOLD_SKIP.has(name)) continue;
    const abs = path.join(dir, name);
    if (statSync(abs).isDirectory()) out.push(...templateFiles(abs, base));
    else out.push(path.relative(base, abs));
  }
  return out.sort();
}

/**
 * Copies the stack profile's project template into the project root. Existing files are never
 * overwritten (they are listed instead), so it is safe in a folder that already has work in it.
 */
export async function scaffold(project, args, io) {
  const stack = args.str('stack') ?? project.manifest()?.stack_profile ?? project.config().stackProfile;
  args.done();
  const templateDir = path.join(pluginRoot, 'templates', stack);
  if (!existsSync(templateDir)) throw new UsageError(`no template for stack profile "${stack}" (${templateDir})`);
  const copied = [];
  const skipped = [];
  for (const rel of templateFiles(templateDir)) {
    const dest = path.join(project.root, rel);
    if (existsSync(dest)) {
      skipped.push(rel.split(path.sep).join('/'));
      continue;
    }
    let content = readFileSync(path.join(templateDir, rel));
    if (rel === 'package.json') {
      const pkg = JSON.parse(content.toString('utf8'));
      pkg.name = C.slugify(path.basename(project.root)) || pkg.name;
      content = Buffer.from(`${JSON.stringify(pkg, null, 2)}\n`);
    }
    mkdirSync(path.dirname(dest), { recursive: true });
    writeFileSync(dest, content);
    copied.push(rel);
  }
  const envExample = path.join(project.root, '.env.example');
  let envCreated = false;
  if (!existsSync(path.join(project.root, '.env')) && existsSync(envExample)) {
    writeFileSync(path.join(project.root, '.env'), readFileSync(envExample));
    envCreated = true;
  }
  io.log(
    [
      `Copied ${copied.length} files from the ${stack} template${envCreated ? ' and created .env from .env.example' : ''}.`,
      skipped.length ? `Kept ${skipped.length} existing file${skipped.length > 1 ? 's' : ''}: ${skipped.slice(0, 10).join(', ')}${skipped.length > 10 ? ', …' : ''}` : '',
      'Next: follow the Setup section of the stack skill (install, database, browsers).',
    ]
      .filter(Boolean)
      .join('\n'),
  );
}

async function ensureGitignore(project) {
  const rel = C.CREW_PATHS.gitignore;
  const text = project.readIfExists(rel) ?? '';
  const missing = C.CREW_GITIGNORE.split('\n').filter((l) => l && !text.split(/\r?\n/).includes(l));
  if (missing.length) await project.write(rel, `${text.replace(/\n*$/, text ? '\n' : '')}${missing.join('\n')}\n`);
}

export function config(project, args, io) {
  args.bool('json'); // always JSON
  args.done();
  const manifest = project.manifest();
  io.json({ ...project.config(), ...(manifest?.language ? { language: manifest.language } : {}) });
}

// ---------------------------------------------------------------------------
// status

export function statusShow(project, args, io) {
  args.done();
  const text = project.readIfExists(C.CREW_PATHS.status);
  io.log(text ? text.replace(/\n+$/, '') : 'No status yet (crew init creates it).');
}

export async function statusSet(project, args, io) {
  const summary = args.str('summary');
  const body = readBody(args, io.stdin);
  const pairs = parsePairs(args.positional);
  args.done();
  const text = project.readIfExists(C.CREW_PATHS.status);
  const parsed = text ? C.parseFrontmatter(text) : { data: {}, body: '' };
  const data = { ...parsed.data };
  for (const [key, raw] of Object.entries(pairs)) {
    if (key === 'updated_at') continue;
    if (raw === undefined) delete data[key];
    else data[key] = key === 'active_tasks' ? raw.split(',').map((s) => s.trim()).filter(Boolean) : raw;
  }
  if (summary !== undefined) data.summary = summary.replace(/\s+/g, ' ').trim();
  if (data.phase !== 'stopped') delete data.stop_reason;
  data.updated_at = project.now();
  const newBody = body !== undefined ? body : parsed.body || `# Status\n\n${data.summary ?? ''}\n`;
  await project.write(C.CREW_PATHS.status, renderOrThrow(() => C.renderStatus(data, newBody)));
  io.log(`Status: ${data.phase}${data.summary ? ` — ${data.summary}` : ''}`);
}

// ---------------------------------------------------------------------------
// next

/** Tasks grouped by what can happen next (shared by `crew next` and the hooks' stop guard). */
export function nextData(project) {
  const tasks = project.tasks();
  const byId = new Map(tasks.map((t) => [t.id, t]));
  const depsDone = (t) => (t.data.depends_on ?? []).every((d) => byId.get(d)?.data.status === 'done');
  return {
    tasks,
    ready: tasks.filter((t) => t.data.status === 'todo' && depsDone(t)),
    review: tasks.filter((t) => t.data.status === 'review'),
    in_progress: tasks.filter((t) => t.data.status === 'in_progress'),
    waiting: tasks.filter((t) => t.data.status === 'todo' && !depsDone(t)),
    blocked: tasks.filter((t) => t.data.status === 'blocked'),
    done: tasks.filter((t) => t.data.status === 'done').length,
  };
}

export function next(project, args, io) {
  const json = args.bool('json');
  args.done();
  const { tasks, done, ...groups } = nextData(project);
  if (json) {
    io.json({ ...Object.fromEntries(Object.entries(groups).map(([k, v]) => [k, v.map((t) => ({ ...t.data, path: t.rel }))])), done, total: tasks.length });
    return;
  }
  if (!tasks.length) {
    io.log('No tasks yet.');
    return;
  }
  const out = [];
  const section = (title, list, hint) => {
    if (!list.length) return;
    out.push(`${title}${hint ? ` — ${hint}` : ''}:`, ...list.map((t) => `  ${taskLine(t)}`), '');
  };
  section('Ready to start', groups.ready, 'delegate each to its owner');
  section('Waiting for review', groups.review, 'delegate to the agent named by the stage (qa or security)');
  section('In progress', groups.in_progress);
  section('Waiting for dependencies', groups.waiting);
  section('Blocked', groups.blocked, 'resolve the escalation first');
  out.push(done === tasks.length ? `All ${done} tasks are done.` : `Done: ${done} of ${tasks.length}.`);
  io.log(out.join('\n'));
}

// ---------------------------------------------------------------------------
// budget and stuck detectors

export function budgetFigures(project) {
  const cfg = project.config();
  const entries = project.costs();
  const authoritative = entries.some((e) => C.AUTHORITATIVE_SOURCES.includes(e.source));
  const spent = C.projectSpentUsd(entries);
  const estimateUsd = entries.filter((e) => e.source === 'estimate').reduce((s, e) => s + (e.turn_cost_usd ?? 0), 0);
  const basis = authoritative ? spent : estimateUsd;
  return {
    cap_usd: cfg.budgetCapUsd,
    spent_usd: round(spent),
    estimated_usd: round(estimateUsd),
    estimated_tokens: C.estimatedTokens(entries),
    basis: authoritative ? 'reported' : 'estimate',
    used_usd: round(basis),
    share: cfg.budgetCapUsd > 0 ? round(basis / cfg.budgetCapUsd) : 0,
  };
}

function round(n) {
  return Math.round(n * 100) / 100;
}

export function budget(project, args, io) {
  const json = args.bool('json');
  args.done();
  const b = budgetFigures(project);
  if (json) {
    io.json(b);
    return;
  }
  io.log(
    [
      `Budget cap: $${b.cap_usd}${b.cap_usd === 0 ? ' (no cap)' : ''}`,
      `Used: $${b.used_usd} (${b.basis === 'reported' ? 'reported by the host' : 'plugin estimate at API list prices'})${b.cap_usd > 0 ? `, ${Math.round(b.share * 100)}% of the cap` : ''}`,
      `Estimated tokens: ${b.estimated_tokens}`,
    ].join('\n'),
  );
}

/** Edits that undo an earlier edit by another agent: same file, before/after digests swapped. */
export function findFlipFlops(journalText) {
  const edits = [];
  for (const line of journalText.split('\n')) {
    if (!line.trim()) continue;
    try {
      const e = JSON.parse(line);
      if (e.file && e.before && e.after) edits.push(e);
    } catch {
      // skip broken lines
    }
  }
  const found = new Map();
  edits.forEach((later, j) => {
    for (let i = 0; i < j; i++) {
      const earlier = edits[i];
      if (earlier.file !== later.file || earlier.before !== later.after || earlier.after !== later.before) continue;
      const a = earlier.agent_type ?? 'main thread';
      const b = later.agent_type ?? 'main thread';
      if (a === b) continue;
      const key = `${later.file}|${[a, b].sort().join('|')}`;
      const item = found.get(key) ?? { file: later.file, agents: [a, b].sort(), times: 0 };
      item.times += 1;
      found.set(key, item);
    }
  });
  return [...found.values()];
}

export function checkProject(project) {
  const findings = [];
  const b = budgetFigures(project);
  if (b.cap_usd > 0 && b.share >= 1) {
    findings.push({ kind: 'budget_cap', severity: 'stop', message: `Budget cap reached: $${b.used_usd} of $${b.cap_usd} (${b.basis}). Stop: crew status set phase=stopped stop_reason=budget_cap, write the report, end the session.` });
  } else if (b.cap_usd > 0 && b.share >= 0.8) {
    findings.push({ kind: 'budget_warning', severity: 'warn', message: `${Math.round(b.share * 100)}% of the budget cap is used ($${b.used_usd} of $${b.cap_usd}). Prefer finishing started tasks over starting new ones.` });
  }

  const estimates = C.taskEstimates(project.costs());
  for (const t of project.tasks()) {
    const est = estimates.get(t.id)?.usd ?? t.data.spent_usd_estimate ?? 0;
    if (t.data.status !== 'done' && t.data.status !== 'blocked' && t.data.budget_usd > 0 && est > t.data.budget_usd) {
      findings.push({ kind: 'task_budget', severity: 'stuck', task: t.id, message: `${t.id} used ~$${round(est)} of its $${t.data.budget_usd} share. Stuck (task_budget): replan it with the architect or escalate: crew escalate --kind stuck --reason task_budget --task ${t.id} …` });
    }
  }

  const journal = project.readIfExists(C.CREW_PATHS.editsLog);
  for (const f of journal ? findFlipFlops(journal) : []) {
    findings.push({ kind: 'edit_flipflop', severity: 'stuck', file: f.file, message: `${f.agents.join(' and ')} undid each other's edits in ${f.file} (${f.times}×). Stuck (edit_flipflop): decide who owns the change (ask the architect for an ADR if it is a design question) or escalate with --reason edit_flipflop.` });
  }

  for (const e of project.escalations()) {
    if (e.data.status === 'answered') {
      findings.push({ kind: 'answered', severity: 'act', escalation: e.id, message: `${e.id} was answered ("${e.data.answer}"). Act on it: record an ADR if it decides something, then crew escalation resolve ${e.id}${C.DECISION_BEARING_KINDS.includes(e.data.kind) ? ' --decision ADR-…' : ''}.` });
    } else if (e.data.status === 'open') {
      findings.push({ kind: 'open_escalation', severity: 'wait', escalation: e.id, message: `${e.id} waits for the human: ${e.data.question}` });
    }
  }
  return findings;
}

export function check(project, args, io) {
  const json = args.bool('json');
  args.done();
  const findings = checkProject(project);
  if (json) io.json(findings);
  else io.log(findings.length ? findings.map((f) => `[${f.severity}] ${f.message}`).join('\n') : 'No problems found.');
}

// ---------------------------------------------------------------------------
// summary

export function summaryData(project) {
  const status = C.readStatus(project.readIfExists(C.CREW_PATHS.status) ?? '').value;
  const tasks = project.tasks();
  const counts = {};
  for (const t of tasks) counts[t.data.status] = (counts[t.data.status] ?? 0) + 1;
  const escalations = project.escalations().filter((e) => e.data.status === 'open' || e.data.status === 'answered');
  const checklist = C.parseChecklist(project.readIfExists(C.CREW_PATHS.accessChecklist) ?? '').filter((i) => !i.done);
  const manifest = project.manifest();
  return {
    phase: status.phase ?? null,
    summary: status.summary ?? null,
    stop_reason: status.stop_reason ?? null,
    stack_profile: manifest?.stack_profile ?? null,
    tasks: { total: tasks.length, ...counts },
    open_escalations: escalations.map((e) => ({ id: e.id, status: e.data.status, kind: e.data.kind, question: e.data.question })),
    access_needed: checklist.map((i) => (i.note ? `${i.text} — ${i.note}` : i.text)),
    decisions: project.decisions().length,
    budget: budgetFigures(project),
  };
}

export function summary(project, args, io) {
  const json = args.bool('json');
  args.done();
  if (!project.manifest()) {
    // .crew/ can exist before crew init (the session hook writes its marker first).
    if (json) io.json({ initialised: false });
    else io.log('No crew project in this folder yet (crew init has not run).');
    return;
  }
  const s = summaryData(project);
  if (json) {
    io.json(s);
    return;
  }
  const counts = Object.entries(s.tasks)
    .filter(([k]) => k !== 'total')
    .map(([k, v]) => `${v} ${k}`)
    .join(', ');
  const lines = [
    `Phase: ${s.phase ?? 'unknown'}${s.stop_reason ? ` (stopped: ${s.stop_reason})` : ''}${s.summary ? ` — ${s.summary}` : ''}`,
    `Tasks: ${s.tasks.total}${counts ? ` (${counts})` : ''}`,
    `Decisions: ${s.decisions}`,
    `Escalations waiting: ${s.open_escalations.length ? s.open_escalations.map((e) => `${e.id} [${e.status}] ${e.question}`).join('; ') : 'none'}`,
    `Access still needed: ${s.access_needed.length ? s.access_needed.join('; ') : 'nothing'}`,
    `Spend: $${s.budget.used_usd} (${s.budget.basis === 'reported' ? 'reported' : 'estimate'})${s.budget.cap_usd > 0 ? ` of $${s.budget.cap_usd} cap` : ''}, ~${s.budget.estimated_tokens} tokens estimated`,
  ];
  io.log(lines.join('\n'));
}

// ---------------------------------------------------------------------------
// validate

function walk(dir, base = dir) {
  const out = [];
  if (!existsSync(dir)) return out;
  for (const name of readdirSync(dir)) {
    const abs = path.join(dir, name);
    if (statSync(abs).isDirectory()) out.push(...walk(abs, base));
    else out.push(abs);
  }
  return out;
}

export function validate(project, args, io) {
  const json = args.bool('json');
  args.done();
  const targets = args.positional.length ? args.positional.map((p) => path.resolve(p)) : walk(project.abs(C.CREW_DIR));
  const results = [];
  for (const abs of targets) {
    const rel = path.relative(project.root, abs).split(path.sep).join('/');
    if (!existsSync(abs)) {
      results.push({ path: rel, ok: false, issues: ['file not found'] });
      continue;
    }
    const r = C.validateCrewFile(rel, readFileSync(abs, 'utf8'));
    if (r && r.kind !== 'free-text') results.push({ path: rel, ok: r.ok, issues: r.issues });
  }
  const bad = results.filter((r) => !r.ok);
  if (json) io.json(results);
  else io.log(bad.length ? bad.map((r) => `${r.path}:\n  - ${r.issues.join('\n  - ')}`).join('\n') : `All ${results.length} checked files match the contract.`);
  return bad.length ? 1 : 0;
}

// ---------------------------------------------------------------------------
// interview

function questionLines(text) {
  const lines = text.split('\n');
  const out = [];
  lines.forEach((l, i) => {
    if (/^#{2,4}\s+(?:Q|В|Вопрос)\s*[:.]/i.test(l)) out.push(i);
  });
  return { lines, starts: out };
}

export function interviewPending(project, args, io) {
  const json = args.bool('json');
  args.done();
  const text = project.readIfExists(C.CREW_PATHS.interview);
  if (!text) {
    io.log('No interview yet.');
    return;
  }
  const pairs = C.parseInterview(text);
  const pending = pairs.map((p, i) => ({ n: i + 1, question: p.question, answered: Boolean(p.answer) })).filter((p) => !p.answered);
  if (json) io.json(pending.map(({ n, question }) => ({ n, question })));
  else io.log(pending.length ? pending.map((p) => `${p.n}. ${p.question}`).join('\n') : `All ${pairs.length} questions are answered.`);
}

/** Writes `A: …` under question n, keeping the rest of the file (block headings, notes) intact. */
export async function interviewAnswer(project, args, io) {
  const n = Number(args.positional[0]);
  const answer = args.str('text');
  args.done();
  if (!Number.isInteger(n) || n < 1) throw new UsageError('give the question number from crew interview pending');
  if (!answer) throw new UsageError('--text is required');
  const text = project.readIfExists(C.CREW_PATHS.interview);
  if (!text) throw new UsageError('no .crew/interview.md yet');
  const { lines, starts } = questionLines(C.normalizeNewlines(text));
  if (n > starts.length) throw new UsageError(`there are only ${starts.length} questions`);
  const start = starts[n - 1];
  let end = lines.findIndex((l, i) => i > start && /^#{1,4}\s/.test(l));
  if (end < 0) end = lines.length;
  const block = lines.slice(start + 1, end);
  const aIdx = block.findIndex((l) => /^(?:A|О|Ответ)\s*[:.]/i.test(l));
  const kept = aIdx >= 0 ? block.slice(0, aIdx) : block.filter((l) => l.trim() !== '');
  const answerLines = `A: ${answer.trim()}`.split('\n');
  const newBlock = [...kept.filter((l, i, arr) => !(l.trim() === '' && i === arr.length - 1)), ...answerLines, ''];
  lines.splice(start + 1, end - start - 1, ...newBlock);
  await project.write(C.CREW_PATHS.interview, `${lines.join('\n').replace(/\n+$/, '')}\n`);
  io.log(`Answered question ${n}.`);
}

// ---------------------------------------------------------------------------

export function idNext(project, args, io) {
  const kind = args.positional[0];
  args.done();
  const dirs = { task: C.CREW_PATHS.tasks, escalation: C.CREW_PATHS.escalations, decision: C.CREW_PATHS.decisions };
  if (!dirs[kind]) throw new UsageError('crew id next task|escalation|decision');
  io.log(C.nextId(kind, project.list(dirs[kind])));
}
