// Answering an escalation from the extension: the host writes the answer fields of the
// escalation file (contract: answer, answered_at, answered_by); the orchestrator acts on it when
// the session continues, records an ADR and resolves the escalation.

import { answerEscalation } from '../../../crew-contract/src/index';
import type { EscalationView } from './model';

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
 * What to send to Claude Code so the crew picks the run up, with the answer just given if any.
 * Always the crew's own command: it reads the state from .crew/, and it is what switches the
 * plugin's hooks on in a session — plain text would continue the run without them in a new chat.
 */
export function continuePrompt(e: EscalationView | undefined, answer: string | undefined): string {
  return e && answer ? `/agent-crew:continue ${e.id} is answered: "${answer.replace(/\s+/g, ' ').trim()}"` : '/agent-crew:continue';
}
