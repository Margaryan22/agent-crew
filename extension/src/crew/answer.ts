// Answering an escalation from the extension: the host writes the answer fields of the
// escalation file (contract: answer, answered_at, answered_by); the orchestrator acts on it when
// the session continues, records an ADR and resolves the escalation.

import { answerEscalation } from '../../../crew-contract/src/index';
import type { EscalationView, SessionView } from './model';

export interface AnswerChoice {
  label: string;
  answer: string;
  recommended: boolean;
}

/** The escalation's options, the recommended one first. */
export function answerChoices(e: EscalationView): AnswerChoice[] {
  const choices = e.options.map((o) => ({ label: o, answer: o, recommended: o === e.recommended }));
  return [...choices.filter((c) => c.recommended), ...choices.filter((c) => !c.recommended)];
}

export function answeredText(fileText: string, answer: string, at: Date): string {
  return answerEscalation(fileText, { text: answer.trim(), by: 'human', at: at.toISOString().replace(/\.\d{3}Z$/, 'Z') });
}

/**
 * What to send to Claude Code so the crew picks the answer up: in the run's own session a short
 * nudge is enough (the orchestration skill is loaded there); a new session resumes the run
 * through the crew command.
 */
export function continuePrompt(e: EscalationView | undefined, answer: string | undefined, session: SessionView | undefined): string {
  if (!session) return '/agent-crew:new-project';
  return e && answer ? `${e.id} is answered: "${answer.replace(/\s+/g, ' ').trim()}". Continue the crew run.` : 'Continue the crew run.';
}
