// `crew` — the agent-crew CLI. Agents change .crew/ through it instead of editing YAML by hand:
// every write is validated against the contract, ids are allocated exclusively, and the task
// cycle and escalation ladder (SPEC §7–8) are enforced in one place.

import { readFileSync } from 'node:fs';
import { parseArgs, UsageError } from './args.mjs';
import * as esc from './escalations.mjs';
import { findRoot, NotFoundError, Project, StateError } from './project.mjs';
import * as report from './report.mjs';
import * as tasks from './tasks.mjs';

export const HELP = `crew — manage the .crew/ folder of an Agent Crew project.

Tasks (cycle: todo → in_progress → review/qa → review/security → done)
  crew task new --title T --owner AGENT [--depends-on T-001,T-002] [--model M] [--budget USD]
                [--files a,b] [--body TEXT | --body-file PATH | --body -]
  crew task list [--status S] [--owner AGENT]      crew task show T-001
  crew task start T-001                            executor: begin (dependencies must be done)
  crew task submit T-001 [--files a,b] [--note T]  executor: hand over to QA
  crew task pass T-001 --stage qa|security [--note T]      reviewer: accept this stage
  crew task reject T-001 --stage qa|security --error TEXT  reviewer: send back (counts an attempt)
  crew task fail T-001 --error TEXT                executor: give up this attempt (counts an attempt)
  crew task block T-001 --escalation E-001         crew task set T-001 key=value …  (orchestrator)
  crew next                                        what can run now

Escalations and decisions
  crew escalate --kind stuck|access|question|permission|brief-review [--reason R] --question Q
                --option A --option B [--option C] --recommended A [--task T-001] [--agent NAME]
                [--problem TEXT] [--tried TEXT]
  crew escalation list [--status open|answered|resolved|cancelled]    crew escalation show E-001
  crew escalation answer E-001 --text TEXT [--by human|auto|eval]
  crew escalation resolve E-001 [--decision ADR-001]   crew escalation cancel E-001
  crew decision new --title T [--status accepted] [--source E-001] [--supersedes ADR-001] [--body …]
  crew decision list

Project
  crew init [--stack tanstack] [--language ru]     crew config
  crew scaffold [--stack tanstack]                 copy the stack's project template (never overwrites)
  crew status show                                 crew status set phase=P [active_tasks=T-1,T-2] [--summary S] [--body …]
  crew check                                       budget cap, task budgets, edit flip-flops, escalations
  crew budget        crew summary        crew validate [files…]
  crew interview pending                           crew interview answer N --text TEXT
  crew id next task|escalation|decision

Add --json to list/show/next/check/budget/summary/new for machine-readable output.
Exit codes: 0 ok, 1 usage or contract error, 2 not found, 3 not allowed in the current state.`;

const BOOLEANS = ['json', 'help', 'force'];
const OVERVIEW = new Set(['summary', 'next', 'budget', 'status show']);

const ROUTES = {
  'task new': tasks.taskNew,
  'task show': tasks.taskShow,
  'task list': tasks.taskList,
  'task set': tasks.taskSet,
  'task start': tasks.taskStart,
  'task submit': tasks.taskSubmit,
  'task pass': tasks.taskPass,
  'task reject': tasks.taskReject,
  'task fail': tasks.taskFail,
  'task block': tasks.taskBlock,
  next: report.next,
  escalate: esc.escalate,
  'escalation list': esc.escalationList,
  'escalation show': esc.escalationShow,
  'escalation answer': esc.escalationAnswer,
  'escalation resolve': esc.escalationResolve,
  'escalation cancel': esc.escalationCancel,
  'decision new': esc.decisionNew,
  'decision list': esc.decisionList,
  init: report.init,
  scaffold: report.scaffold,
  config: report.config,
  'status show': report.statusShow,
  'status set': report.statusSet,
  check: report.check,
  budget: report.budget,
  summary: report.summary,
  validate: report.validate,
  'interview pending': report.interviewPending,
  'interview answer': report.interviewAnswer,
  'id next': report.idNext,
};

/**
 * @param {string[]} argv
 * @param {{ cwd?: string, env?: Record<string, string | undefined>, now?: () => Date, stdout?: (s: string) => void, stderr?: (s: string) => void, stdin?: () => string }} [options]
 * @returns {Promise<number>} exit code
 */
export async function main(argv, options = {}) {
  const stdout = options.stdout ?? ((s) => process.stdout.write(s));
  const stderr = options.stderr ?? ((s) => process.stderr.write(s));
  const io = {
    log: (text) => stdout(`${text}\n`),
    json: (value) => stdout(`${JSON.stringify(value, null, 2)}\n`),
    stdin: options.stdin ?? (() => readFileSync(0, 'utf8')),
  };

  const words = argv.filter((a) => !a.startsWith('--'));
  if (!argv.length || argv[0] === 'help' || argv[0] === '--help' || argv[0] === '-h') {
    io.log(HELP);
    return 0;
  }
  const key2 = words.slice(0, 2).join(' ');
  const route = ROUTES[key2] ? key2 : ROUTES[words[0]] ? words[0] : undefined;
  if (!route) {
    stderr(`crew: unknown command "${words.slice(0, 2).join(' ')}". Run crew help.\n`);
    return 1;
  }

  try {
    // Drop the command words from the positionals; flags stay where they are.
    const rest = [...argv];
    for (const w of route.split(' ')) rest.splice(rest.indexOf(w), 1);
    const args = parseArgs(rest, { booleans: BOOLEANS });
    if (args.bool('help')) {
      io.log(HELP);
      return 0;
    }
    const env = options.env ?? process.env;
    const cwd = options.cwd ?? process.cwd();
    const root = route === 'init' ? (findRoot(cwd) ?? cwd) : findRoot(cwd);
    if (!root && OVERVIEW.has(route)) {
      // Overviews are also embedded in skills (/status), where a failing command would abort the skill.
      io.log('No crew project in this folder yet (no .crew/). Start one with /agent-crew:new-project.');
      return 0;
    }
    if (!root) throw new UsageError(`no .crew/ folder in ${cwd} or its parents — run crew init in the project root first`);
    const project = new Project(root, { env, now: options.now });
    const code = await ROUTES[route](project, args, io);
    return typeof code === 'number' ? code : 0;
  } catch (err) {
    if (err instanceof UsageError) {
      stderr(`crew ${route}: ${err.message}\n`);
      return 1;
    }
    if (err instanceof NotFoundError || err?.code === 'ENOENT') {
      stderr(`crew ${route}: ${err.message}\n`);
      return 2;
    }
    if (err instanceof StateError) {
      stderr(`crew ${route}: ${err.message}\n`);
      return 3;
    }
    stderr(`crew ${route}: ${err?.stack ?? String(err)}\n`);
    return 1;
  }
}
