// Strict validation of any file under .crew/, picked by its path. Used by the plugin's
// PostToolUse validator hook and `crew validate`.

import { CREW_DIR } from './constants';
import { parseFrontmatter } from './frontmatter';
import { idFromFileName } from './ids';
import {
  BriefReviewSchema,
  BriefSchema,
  CostEntrySchema,
  CrewManifestSchema,
  DecisionSchema,
  EditJournalEntrySchema,
  EscalationSchema,
  formatIssues,
  HookLogEntrySchema,
  SessionMarkerSchema,
  StatusSchema,
  TaskSchema,
} from './schemas';
import type { z } from 'zod';

export type ArtefactKind =
  | 'task'
  | 'escalation'
  | 'decision'
  | 'status'
  | 'brief'
  | 'brief-review'
  | 'manifest'
  | 'session-marker'
  | 'costs'
  | 'hooks-log'
  | 'edits-log'
  | 'free-text';

export interface ValidationResult {
  kind: ArtefactKind;
  ok: boolean;
  issues: string[];
}

/** Workspace-relative path with forward slashes → artefact kind, or undefined outside .crew/. */
export function artefactKind(relPath: string): ArtefactKind | undefined {
  const p = relPath.replace(/\\/g, '/').replace(/^\.\//, '');
  if (!p.startsWith(`${CREW_DIR}/`)) return undefined;
  const rest = p.slice(CREW_DIR.length + 1);
  if (/^tasks\/[^/]+\.md$/i.test(rest)) return 'task';
  if (/^escalations\/[^/]+\.md$/i.test(rest)) return 'escalation';
  if (/^decisions\/[^/]+\.md$/i.test(rest)) return 'decision';
  if (/^sessions\/[^/]+\.json$/i.test(rest)) return 'session-marker';
  switch (rest) {
    case 'status.md':
      return 'status';
    case 'brief.md':
      return 'brief';
    case 'brief.review.md':
      return 'brief-review';
    case 'crew.json':
      return 'manifest';
    case 'costs.log':
      return 'costs';
    case 'logs/hooks.jsonl':
      return 'hooks-log';
    case 'logs/edits.jsonl':
      return 'edits-log';
    default:
      return 'free-text';
  }
}

const MARKDOWN_SCHEMAS: Partial<Record<ArtefactKind, z.ZodType>> = {
  task: TaskSchema,
  escalation: EscalationSchema,
  decision: DecisionSchema,
  status: StatusSchema,
  brief: BriefSchema,
  'brief-review': BriefReviewSchema,
};

const JSONL_SCHEMAS: Partial<Record<ArtefactKind, z.ZodType>> = {
  costs: CostEntrySchema,
  'hooks-log': HookLogEntrySchema,
  'edits-log': EditJournalEntrySchema,
};

function fileName(relPath: string): string {
  return relPath.replace(/\\/g, '/').split('/').pop() ?? relPath;
}

function validateMarkdown(kind: ArtefactKind, relPath: string, text: string): string[] {
  const schema = MARKDOWN_SCHEMAS[kind];
  if (!schema) return [];
  const fm = parseFrontmatter(text);
  if (!fm.hasFrontmatter) return ['missing YAML frontmatter (--- … ---) at the top of the file'];
  const result = schema.safeParse(fm.data);
  const issues = result.success ? [] : formatIssues(result.error);
  const idKind = kind === 'task' || kind === 'escalation' || kind === 'decision' ? kind : undefined;
  if (idKind) {
    const expected = idFromFileName(idKind, fileName(relPath));
    if (!expected) issues.push(`file name must start with the ${idKind} id, e.g. ${idKind === 'task' ? 'T-001.md' : idKind === 'escalation' ? 'E-001.md' : 'ADR-001-short-title.md'}`);
    else if (fm.data.id !== undefined && fm.data.id !== expected) issues.push(`id "${String(fm.data.id)}" does not match the file name (${expected})`);
  }
  return issues;
}

function validateJsonl(kind: ArtefactKind, text: string): string[] {
  const schema = JSONL_SCHEMAS[kind];
  if (!schema) return [];
  const issues: string[] = [];
  text.split(/\r?\n/).forEach((raw, i) => {
    const line = raw.trim();
    if (!line || line.startsWith('#')) return;
    let value: unknown;
    try {
      value = JSON.parse(line);
    } catch {
      issues.push(`line ${i + 1}: not valid JSON`);
      return;
    }
    const result = schema.safeParse(value);
    if (!result.success) issues.push(...formatIssues(result.error).map((m) => `line ${i + 1}: ${m}`));
  });
  return issues;
}

function validateJson(schema: z.ZodType, text: string): string[] {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    return ['not valid JSON'];
  }
  const result = schema.safeParse(value);
  return result.success ? [] : formatIssues(result.error);
}

export function validateCrewFile(relPath: string, text: string): ValidationResult | undefined {
  const kind = artefactKind(relPath);
  if (!kind) return undefined;
  let issues: string[] = [];
  if (kind in MARKDOWN_SCHEMAS) issues = validateMarkdown(kind, relPath, text);
  else if (kind in JSONL_SCHEMAS) issues = validateJsonl(kind, text);
  else if (kind === 'manifest') issues = validateJson(CrewManifestSchema, text);
  else if (kind === 'session-marker') issues = validateJson(SessionMarkerSchema, text);
  return { kind, ok: issues.length === 0, issues };
}
