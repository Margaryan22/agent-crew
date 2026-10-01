import { describe, expect, it } from 'vitest';
import { parseFrontmatter, validateCrewFile } from '../../../crew-contract/src/index';
import { answerChoices, answeredText, continuePrompt } from '../../src/crew/answer';
import type { EscalationView } from '../../src/crew/model';

const escalation = {
  id: 'E-002',
  kind: 'stuck',
  reason: 'repeated_error',
  source: 'plugin',
  status: 'open',
  question: 'Which payment provider?',
  options: ['Stripe', 'Skip payments'],
  recommended: 'Skip payments',
  created_at: '2026-09-30T10:00:00Z',
  path: '.crew/escalations/E-002.md',
  title: 'E-002',
} as EscalationView;

const fileText = `---
id: E-002
kind: stuck
reason: repeated_error
source: plugin
status: open
question: Which payment provider?
options: ["Stripe", "Skip payments"]
recommended: Skip payments
created_at: "2026-09-30T10:00:00Z"
---

# E-002: Which payment provider?
`;

describe('answering escalations', () => {
  it('puts the recommended option first', () => {
    expect(answerChoices(escalation).map((c) => [c.label, c.recommended])).toEqual([
      ['Skip payments', true],
      ['Stripe', false],
    ]);
  });

  it('writes the host fields and keeps the file valid', () => {
    const text = answeredText(fileText, '  Stripe  ', new Date('2026-09-30T12:00:00.123Z'));
    const data = parseFrontmatter(text).data;
    expect(data).toMatchObject({ status: 'answered', answer: 'Stripe', answered_by: 'human', answered_at: '2026-09-30T12:00:00Z' });
    expect(text).toMatch(/## Answer\n\nStripe\n/);
    expect(validateCrewFile('.crew/escalations/E-002.md', text)?.ok).toBe(true);
  });

  it('builds the prompt that makes the crew continue', () => {
    expect(continuePrompt(escalation, 'Stripe\nplease')).toBe('/agent-crew:continue E-002 is answered: "Stripe please"');
    expect(continuePrompt(undefined, undefined)).toBe('/agent-crew:continue');
  });
});
