// Version, names and paths of the .crew/ contract.

/** Bump the major on renames/removals; additive optional fields keep it. */
export const CONTRACT_VERSION = 1;

export const PLUGIN_NAME = 'agent-crew';

export const KNOWN_AGENTS = ['orchestrator', 'pm', 'critic', 'architect', 'qa', 'frontend', 'backend', 'db', 'security', 'keeper'] as const;
export type KnownAgent = (typeof KNOWN_AGENTS)[number];

export const CREW_DIR = '.crew';

export const CREW_PATHS = {
  manifest: '.crew/crew.json',
  interview: '.crew/interview.md',
  brief: '.crew/brief.md',
  briefReview: '.crew/brief.review.md',
  accessChecklist: '.crew/access-checklist.md',
  glossary: '.crew/glossary.md',
  status: '.crew/status.md',
  report: '.crew/report.md',
  costs: '.crew/costs.log',
  tasks: '.crew/tasks',
  escalations: '.crew/escalations',
  decisions: '.crew/decisions',
  /** Free-form review notes from QA and security (T-003-qa.md, architecture-security.md). */
  reviews: '.crew/reviews',
  sessions: '.crew/sessions',
  logs: '.crew/logs',
  hooksLog: '.crew/logs/hooks.jsonl',
  editsLog: '.crew/logs/edits.jsonl',
  gitignore: '.crew/.gitignore',
} as const;

/** Machine-local state that should not be committed with the project. */
export const CREW_GITIGNORE = 'logs/\nsessions/\n';

export function slugify(title: string, max = 40): string {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, max)
    .replace(/-+$/g, '');
}

export function taskPath(id: string): string {
  return `${CREW_PATHS.tasks}/${id}.md`;
}

export function escalationPath(id: string): string {
  return `${CREW_PATHS.escalations}/${id}.md`;
}

export function decisionPath(id: string, title?: string): string {
  const slug = title ? slugify(title) : '';
  return `${CREW_PATHS.decisions}/${id}${slug ? `-${slug}` : ''}.md`;
}

export function sessionMarkerPath(sessionId: string): string {
  return `${CREW_PATHS.sessions}/${sessionId.replace(/[^\w.-]/g, '_')}.json`;
}
