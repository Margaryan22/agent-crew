// Zod schemas of every .crew/ artefact (PLAN.md §2.3). These are the strict shapes writers
// must produce; readers that need to survive hand-edited files use lenient.ts.

import { z } from 'zod';

// ---------------------------------------------------------------------------
// Shared pieces

export const TaskId = z.string().regex(/^T-\d{3,}$/, 'expected an id like T-001');
export const EscalationId = z.string().regex(/^E-\d{3,}$/, 'expected an id like E-001');
export const DecisionId = z.string().regex(/^ADR-\d{3,}$/, 'expected an id like ADR-001');
export const AgentName = z.string().regex(/^[a-z][a-z0-9-]*$/, 'expected a kebab-case agent name');
/** A model alias (haiku, sonnet, opus, fable) or a full model id. */
export const ModelRef = z.string().regex(/^[\w.:[\]-]+$/, 'expected a model alias or id');
export const DateTime = z.iso.datetime({ offset: true });
export const DateOnly = z.iso.date();
const NonNegative = z.number().min(0);
const OneLine = (max: number) =>
  z
    .string()
    .min(1)
    .max(max)
    .refine((s) => !s.includes('\n'), 'must be a single line');

// ---------------------------------------------------------------------------
// Enums

export const TaskStatus = z.enum(['todo', 'in_progress', 'review', 'done', 'blocked']);
export const ReviewStage = z.enum(['qa', 'security']);
export const EscalationKind = z.enum(['stuck', 'access', 'question', 'permission', 'brief-review']);
export const StuckReason = z.enum(['attempts_exceeded', 'repeated_error', 'pm_critic_deadlock', 'edit_flipflop', 'task_budget']);
export const EscalationStatus = z.enum(['open', 'answered', 'resolved', 'cancelled']);
export const EscalationSource = z.enum(['plugin', 'host']);
export const AnsweredBy = z.enum(['human', 'auto', 'eval']);
export const DecisionStatus = z.enum(['proposed', 'accepted', 'superseded', 'rejected']);
export const Phase = z.enum(['interview', 'brief', 'architecture', 'acceptance_tests', 'decomposition', 'tasks', 'final', 'done', 'stopped', 'failed']);
export const StopReason = z.enum(['budget_cap', 'user', 'error']);
export const BriefStatus = z.enum(['draft', 'in_review', 'approved']);
export const Verdict = z.enum(['approve', 'revise', 'deadlock']);
export const CheckResult = z.enum(['pass', 'fail']);
export const CostSource = z.enum(['sdk', 'headless', 'estimate', 'manual']);
export const HookDecision = z.enum(['allow', 'deny', 'ask', 'defer', 'none']);

/** Escalation kinds the orchestrator turns into an ADR when resolving. */
export const DECISION_BEARING_KINDS: readonly z.infer<typeof EscalationKind>[] = ['stuck', 'access', 'question'];

// ---------------------------------------------------------------------------
// tasks/T-xxx.md

export const TaskSchema = z
  .looseObject({
    id: TaskId,
    title: z.string().min(1).max(120),
    status: TaskStatus,
    owner: AgentName,
    attempts: z.number().int().min(0),
    model: ModelRef.optional(),
    last_error_hash: z
      .string()
      .regex(/^[0-9a-f]{12}$/)
      .optional(),
    depends_on: z.array(TaskId).optional(),
    review_stage: ReviewStage.optional(),
    escalation: EscalationId.optional(),
    branch: z.string().min(1).optional(),
    base: z.string().min(1).optional(),
    files: z.array(z.string().min(1)).optional(),
    budget_usd: NonNegative.optional(),
    spent_usd_estimate: NonNegative.optional(),
    created_at: DateTime,
    updated_at: DateTime,
  })
  .superRefine((t, ctx) => {
    if (t.review_stage && t.status !== 'review') ctx.addIssue({ code: 'custom', path: ['review_stage'], message: 'review_stage is only allowed with status: review' });
    if (t.escalation && t.status !== 'blocked') ctx.addIssue({ code: 'custom', path: ['escalation'], message: 'escalation is only allowed with status: blocked' });
    if (t.depends_on?.includes(t.id)) ctx.addIssue({ code: 'custom', path: ['depends_on'], message: 'a task cannot depend on itself' });
  });
export type Task = z.infer<typeof TaskSchema>;

// ---------------------------------------------------------------------------
// escalations/E-xxx.md

export const EscalationSchema = z
  .looseObject({
    id: EscalationId,
    kind: EscalationKind,
    reason: StuckReason.optional(),
    source: EscalationSource,
    status: EscalationStatus,
    question: OneLine(300),
    options: z.array(z.string().min(1).max(120)).min(1).max(4),
    recommended: z.string().min(1).optional(),
    task: TaskId.optional(),
    agent: z.string().min(1).optional(),
    session_id: z.string().min(1).optional(),
    created_at: DateTime,
    answer: z.string().min(1).optional(),
    answered_at: DateTime.optional(),
    answered_by: AnsweredBy.optional(),
    decision: DecisionId.optional(),
  })
  .superRefine((e, ctx) => {
    if (e.kind === 'stuck' && !e.reason) ctx.addIssue({ code: 'custom', path: ['reason'], message: 'reason is required when kind is stuck' });
    if (e.kind !== 'stuck' && e.reason) ctx.addIssue({ code: 'custom', path: ['reason'], message: 'reason is only allowed when kind is stuck' });
    if (e.recommended !== undefined && !e.options.includes(e.recommended)) {
      ctx.addIssue({ code: 'custom', path: ['recommended'], message: 'recommended must be one of options' });
    }
    if (e.status === 'answered' || e.status === 'resolved') {
      for (const key of ['answer', 'answered_at', 'answered_by'] as const) {
        if (e[key] === undefined) ctx.addIssue({ code: 'custom', path: [key], message: `${key} is required once the escalation is ${e.status}` });
      }
    }
    if (e.status === 'resolved' && e.source === 'plugin' && DECISION_BEARING_KINDS.includes(e.kind) && !e.decision) {
      ctx.addIssue({ code: 'custom', path: ['decision'], message: `a resolved ${e.kind} escalation must reference the ADR it produced` });
    }
    if (e.decision && e.status !== 'resolved') ctx.addIssue({ code: 'custom', path: ['decision'], message: 'decision is only set when the escalation is resolved' });
  });
export type Escalation = z.infer<typeof EscalationSchema>;

// ---------------------------------------------------------------------------
// decisions/ADR-xxx-slug.md

export const DecisionSchema = z.looseObject({
  id: DecisionId,
  title: z.string().min(1).max(120),
  status: DecisionStatus,
  date: DateOnly,
  source: EscalationId.optional(),
  supersedes: DecisionId.optional(),
});
export type Decision = z.infer<typeof DecisionSchema>;

// ---------------------------------------------------------------------------
// status.md

export const StatusSchema = z
  .looseObject({
    phase: Phase,
    updated_at: DateTime,
    active_tasks: z.array(TaskId).optional(),
    stop_reason: StopReason.optional(),
    summary: z.string().max(280).optional(),
  })
  .superRefine((s, ctx) => {
    if (s.phase === 'stopped' && !s.stop_reason) ctx.addIssue({ code: 'custom', path: ['stop_reason'], message: 'stop_reason is required when phase is stopped' });
  });
export type Status = z.infer<typeof StatusSchema>;

// ---------------------------------------------------------------------------
// brief.md and brief.review.md

export const BriefSchema = z
  .looseObject({
    version: z.number().int().min(1),
    status: BriefStatus,
    review_rounds: z.number().int().min(0).max(3),
    approved_at: DateTime.optional(),
  })
  .superRefine((b, ctx) => {
    if (b.status === 'approved' && !b.approved_at) ctx.addIssue({ code: 'custom', path: ['approved_at'], message: 'approved_at is required when the brief is approved' });
  });
export type Brief = z.infer<typeof BriefSchema>;

export const BriefReviewSchema = z.looseObject({
  round: z.number().int().min(1).max(3),
  verdict: Verdict,
  checklist: z.object({ value: CheckResult, scope: CheckResult, measurability: CheckResult, risks: CheckResult }),
});
export type BriefReview = z.infer<typeof BriefReviewSchema>;

// ---------------------------------------------------------------------------
// crew.json and sessions/<id>.json

export const CrewManifestSchema = z.looseObject({
  contract_version: z.number().int().min(1),
  plugin: z.object({ name: z.string().min(1), version: z.string().min(1) }),
  stack_profile: z.string().min(1),
  created_at: DateTime,
});
export type CrewManifest = z.infer<typeof CrewManifestSchema>;

/** Written by the plugin when a crew command starts, so a host UI can reopen the session. */
export const SessionMarkerSchema = z.looseObject({
  session_id: z.string().min(1),
  command: z.string().min(1),
  started_at: DateTime,
  assistant: z.enum(['claude-code', 'codex']),
  transcript_path: z.string().min(1).optional(),
});
export type SessionMarker = z.infer<typeof SessionMarkerSchema>;

// ---------------------------------------------------------------------------
// JSONL logs

const Tokens = z.object({
  input: z.number().int().min(0),
  output: z.number().int().min(0),
  cache_read: z.number().int().min(0).optional(),
  cache_write: z.number().int().min(0).optional(),
});

/** One line of costs.log. Only `sdk` and `headless` entries are authoritative dollar figures. */
export const CostEntrySchema = z
  .looseObject({
    ts: DateTime,
    source: CostSource,
    session_id: z.string().min(1).optional(),
    turn_cost_usd: NonNegative.optional(),
    session_total_usd: NonNegative.optional(),
    task: TaskId.optional(),
    agent: z.string().min(1).optional(),
    model: ModelRef.optional(),
    tokens: Tokens.optional(),
  })
  .refine((c) => c.turn_cost_usd !== undefined || c.session_total_usd !== undefined || c.tokens !== undefined, {
    message: 'a cost entry needs turn_cost_usd, session_total_usd or tokens',
  });
export type CostEntry = z.infer<typeof CostEntrySchema>;

/** One line of logs/hooks.jsonl. `input_digest` is a hash — never the raw tool input. */
export const HookLogEntrySchema = z.looseObject({
  ts: DateTime,
  session_id: z.string().min(1),
  hook: z.string().min(1),
  event: z.string().min(1),
  tool: z.string().min(1).optional(),
  agent_type: z.string().min(1).optional(),
  decision: HookDecision,
  reason: z.string().optional(),
  input_digest: z.string().regex(/^[0-9a-f]{12,64}$/),
});
export type HookLogEntry = z.infer<typeof HookLogEntrySchema>;

/** One line of logs/edits.jsonl — digests of the text before and after an edit, for flip-flop detection. */
export const EditJournalEntrySchema = z.looseObject({
  ts: DateTime,
  session_id: z.string().min(1),
  agent_type: z.string().min(1).optional(),
  file: z.string().min(1),
  before: z.string().regex(/^[0-9a-f]{12,64}$/),
  after: z.string().regex(/^[0-9a-f]{12,64}$/),
});
export type EditJournalEntry = z.infer<typeof EditJournalEntrySchema>;

/** Every schema by artefact name — used by validators and the JSON Schema export. */
export const SCHEMAS = {
  task: TaskSchema,
  escalation: EscalationSchema,
  decision: DecisionSchema,
  status: StatusSchema,
  brief: BriefSchema,
  'brief-review': BriefReviewSchema,
  manifest: CrewManifestSchema,
  'session-marker': SessionMarkerSchema,
  'cost-entry': CostEntrySchema,
  'hook-log-entry': HookLogEntrySchema,
  'edit-journal-entry': EditJournalEntrySchema,
} as const;
export type SchemaName = keyof typeof SCHEMAS;

export function formatIssues(error: z.ZodError): string[] {
  return error.issues.map((i) => `${i.path.length ? `${i.path.join('.')}: ` : ''}${i.message}`);
}
