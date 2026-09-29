// Domain types for the .crew/ directory — the single source of truth for project state.
// The extension only reads these files (and appends escalation answers / cost lines);
// the agent-crew plugin owns their content.

export const TASK_STATUSES = ['todo', 'in_progress', 'review', 'done', 'blocked'] as const;
export type TaskStatus = (typeof TASK_STATUSES)[number];

export interface Task {
  id: string;
  title: string;
  status: TaskStatus;
  assignee?: string;
  attempts: number;
  /** Git branch the task was implemented on (for "Show Diff"). */
  branch?: string;
  /** Branch/commit the task branch started from. */
  base?: string;
  files: string[];
  /** Workspace-relative path, e.g. `.crew/tasks/T-001.md`. */
  path: string;
}

export const ESCALATION_STATUSES = ['open', 'answered', 'resolved', 'cancelled'] as const;
export type EscalationStatus = (typeof ESCALATION_STATUSES)[number];

/**
 * - `question`   — an agent asked the human (AskUserQuestion or a plugin-written file)
 * - `permission` — a tool call not covered by the plugin's hook policy
 * - `brief-review` — the brief is ready for approval (autonomy = review)
 */
export type EscalationKind = 'question' | 'permission' | 'brief-review';

export interface Escalation {
  id: string;
  title: string;
  question: string;
  options: string[];
  status: EscalationStatus;
  kind: EscalationKind;
  task?: string;
  agent?: string;
  answer?: string;
  createdAt?: string;
  path?: string;
}

export interface Decision {
  id: string;
  title: string;
  status?: string;
  path: string;
}

export interface CostEntry {
  timestamp: string;
  sessionId?: string;
  /** Cost of this entry alone (e.g. one turn). */
  costUsd?: number;
  /** Running total of the session at this point (Agent SDK `total_cost_usd`). */
  sessionTotalUsd?: number;
  source?: string;
}

export interface ProjectStatus {
  phase?: string;
  summary?: string;
}

export interface CrewSnapshot {
  exists: boolean;
  tasks: Task[];
  escalations: Escalation[];
  decisions: Decision[];
  costs: CostEntry[];
  status?: ProjectStatus;
  hasBrief: boolean;
}

export const EMPTY_SNAPSHOT: CrewSnapshot = {
  exists: false,
  tasks: [],
  escalations: [],
  decisions: [],
  costs: [],
  hasBrief: false,
};

export const CREW_DIR = '.crew';
export const CREW_PATHS = {
  tasks: `${CREW_DIR}/tasks`,
  escalations: `${CREW_DIR}/escalations`,
  decisions: `${CREW_DIR}/decisions`,
  costs: `${CREW_DIR}/costs.log`,
  status: `${CREW_DIR}/status.md`,
  brief: `${CREW_DIR}/brief.md`,
} as const;
