// The extension's view of a crew project's .crew/ folder. File formats, readers and writers come
// from the shared contract (../crew-contract), the same code the agent-crew plugin uses.

import type { ChecklistItem, DecisionView, EscalationView, StatusView, TaskView } from '../../../crew-contract/src/index';

export type { ChecklistItem, DecisionView, EscalationView, StatusView, TaskView };

export interface ManifestView {
  contractVersion?: number;
  stackProfile?: string;
  language?: string;
  pluginVersion?: string;
}

/** A Claude Code session started by a crew command (.crew/sessions/<id>.json). */
export interface SessionView {
  id: string;
  command: string;
  startedAt: string;
  /** Budget cap the plugin resolved for that session, when it recorded one. */
  capUsd?: number;
}

export interface SpendView {
  /** Dollars: reported by a host (eval runner) when available, otherwise the plugin's estimate. */
  usedUsd: number;
  basis: 'reported' | 'estimate';
  estimatedTokens: number;
}

export interface CrewSnapshot {
  /** .crew/ exists (a crew command may have created it before `crew init`). */
  exists: boolean;
  /** .crew/crew.json exists. */
  initialised: boolean;
  manifest?: ManifestView;
  status?: StatusView;
  tasks: TaskView[];
  escalations: EscalationView[];
  decisions: DecisionView[];
  checklist: ChecklistItem[];
  spend: SpendView;
  latestSession?: SessionView;
  files: { brief: boolean; report: boolean; accessChecklist: boolean };
  /** Things worth telling the user: newer contract, files that break the contract. */
  problems: string[];
}

export const EMPTY_SNAPSHOT: CrewSnapshot = {
  exists: false,
  initialised: false,
  tasks: [],
  escalations: [],
  decisions: [],
  checklist: [],
  spend: { usedUsd: 0, basis: 'estimate', estimatedTokens: 0 },
  files: { brief: false, report: false, accessChecklist: false },
  problems: [],
};

export const PHASE_LABELS: Record<string, string> = {
  interview: 'Interview',
  brief: 'Brief',
  architecture: 'Architecture',
  acceptance_tests: 'Acceptance tests',
  decomposition: 'Planning',
  tasks: 'Building',
  final: 'Final checks',
  done: 'Done',
  stopped: 'Stopped',
  failed: 'Failed',
};
