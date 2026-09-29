// canUseTool handler. The plugin's hooks are the permission policy; whatever reaches this
// callback was not settled by that policy, so it becomes an escalation — never a modal
// "allow?" dialog. AskUserQuestion calls become question escalations the same way.

import type { CanUseTool, PermissionResult, PermissionUpdate } from '@anthropic-ai/claude-agent-sdk';
import type { EscalationRequest } from '../crew/escalations';
import { EscalationCancelled } from '../crew/escalations';
import type { Logger } from '../redact';
import { describeToolUse } from './events';

export const ALLOW = 'Allow';
export const ALLOW_SESSION = 'Allow for this session';
export const DENY = 'Deny';

export interface PermissionDeps {
  raise(request: EscalationRequest, signal?: AbortSignal): Promise<string>;
  /** Display name of the agent behind a request (lead when agentId is undefined). */
  agentName(agentId: string | undefined): string;
  log: Logger;
}

interface AskOption {
  label: string;
  description?: string;
}

interface AskQuestion {
  question: string;
  header?: string;
  options: AskOption[];
  multiSelect?: boolean;
}

function parseQuestions(input: Record<string, unknown>): AskQuestion[] {
  const raw = Array.isArray(input.questions) ? input.questions : [];
  return raw
    .filter((q): q is Record<string, unknown> => typeof q === 'object' && q !== null)
    .map((q) => ({
      question: typeof q.question === 'string' ? q.question : '',
      header: typeof q.header === 'string' ? q.header : undefined,
      multiSelect: q.multiSelect === true,
      options: (Array.isArray(q.options) ? q.options : [])
        .filter((o): o is Record<string, unknown> => typeof o === 'object' && o !== null && typeof o.label === 'string')
        .map((o) => ({ label: o.label as string, description: typeof o.description === 'string' ? o.description : undefined })),
    }))
    .filter((q) => q.question !== '');
}

function questionText(q: AskQuestion): string {
  const described = q.options.filter((o) => o.description);
  if (!described.length) return q.question;
  const lines = described.map((o) => `• ${o.label} — ${o.description}`);
  return `${q.question}\n\n${lines.join('\n')}${q.multiSelect ? '\n\n(Several options allowed — separate them with commas.)' : ''}`;
}

function sessionRules(suggestions: PermissionUpdate[] | undefined): PermissionUpdate[] {
  return (suggestions ?? []).map((s) => ({ ...s, destination: 'session' }) as PermissionUpdate);
}

export function createCanUseTool(deps: PermissionDeps): CanUseTool {
  return async (toolName, input, options): Promise<PermissionResult> => {
    const agent = deps.agentName(options.agentID);
    try {
      if (toolName === 'AskUserQuestion') {
        const questions = parseQuestions(input);
        const answers: Record<string, string> = {};
        for (const q of questions) {
          answers[q.question] = await deps.raise(
            {
              kind: 'question',
              title: q.header ? `${agent}: ${q.header}` : `${agent} has a question`,
              question: questionText(q),
              options: q.options.map((o) => o.label),
              agent,
            },
            options.signal,
          );
        }
        return { behavior: 'allow', updatedInput: { ...input, answers } };
      }

      const detail = describeToolUse(toolName, input);
      const action = options.displayName ?? toolName;
      const question =
        options.title ??
        `${agent} wants to use ${action}${detail ? `: ${detail}` : ''}.${options.decisionReason ? `\nReason: ${options.decisionReason}` : ''}`;
      const choices = options.suggestions?.length && !options.suppressAlwaysAllowRule ? [ALLOW, ALLOW_SESSION, DENY] : [ALLOW, DENY];
      const answer = await deps.raise(
        { kind: 'permission', title: `${agent}: permission for ${action}`, question, options: choices, agent },
        options.signal,
      );
      if (answer === ALLOW) return { behavior: 'allow', updatedInput: input };
      if (answer === ALLOW_SESSION) return { behavior: 'allow', updatedInput: input, updatedPermissions: sessionRules(options.suggestions) };
      if (answer === DENY) return { behavior: 'deny', message: `The user denied ${action}. Choose another approach or escalate with an explanation.` };
      return { behavior: 'deny', message: `The user did not allow ${action} and replied: "${answer}". Follow this guidance.` };
    } catch (err) {
      if (err instanceof EscalationCancelled) {
        return { behavior: 'deny', message: `Not answered: ${err.message}.`, interrupt: true };
      }
      deps.log.error(`Permission handler failed for ${toolName}: ${String(err)}`);
      return { behavior: 'deny', message: 'The permission request could not be shown to the user.' };
    }
  };
}
