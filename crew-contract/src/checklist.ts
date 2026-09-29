// access-checklist.md and interview.md: free-form markdown with a small parsable structure.

import { normalizeNewlines, parseFrontmatter } from './frontmatter';

export interface ChecklistItem {
  done: boolean;
  text: string;
  /** Text after an em dash or " - ": why the item is needed. */
  note?: string;
}

/** `- [ ] Stripe API key — to take payments` / `- [x] Domain name`. */
export function parseChecklist(markdown: string): ChecklistItem[] {
  const items: ChecklistItem[] = [];
  for (const line of parseFrontmatter(markdown).body.split('\n')) {
    const m = /^\s*[-*+]\s+\[([ xX])\]\s+(.+?)\s*$/.exec(line);
    if (!m) continue;
    const [text, ...rest] = (m[2] ?? '').split(/\s+[—–]\s+|\s+-\s+/);
    const item: ChecklistItem = { done: m[1] !== ' ', text: (text ?? '').trim() };
    const note = rest.join(' — ').trim();
    if (note) item.note = note;
    items.push(item);
  }
  return items;
}

export interface InterviewPair {
  question: string;
  answer?: string;
}

/**
 * Blocks of `### Q: …` followed by `A: …` (the answer may span lines until the next question).
 * The eval runner pre-fills answers; the orchestrator asks only questions without one.
 */
export function parseInterview(markdown: string): InterviewPair[] {
  const pairs: InterviewPair[] = [];
  let current: InterviewPair | undefined;
  let answerLines: string[] | undefined;
  const flush = () => {
    if (!current) return;
    const answer = answerLines?.join('\n').trim();
    if (answer) current.answer = answer;
    pairs.push(current);
  };
  for (const line of parseFrontmatter(markdown).body.split('\n')) {
    const q = /^#{2,4}\s+(?:Q|В|Вопрос)\s*[:.]\s*(.+?)\s*$/i.exec(line);
    if (q) {
      flush();
      current = { question: q[1] ?? '' };
      answerLines = undefined;
      continue;
    }
    if (!current) continue;
    const a = /^(?:A|О|Ответ)\s*[:.]\s*(.*)$/i.exec(line);
    if (a && answerLines === undefined) {
      answerLines = [a[1] ?? ''];
    } else if (answerLines !== undefined) {
      answerLines.push(line);
    }
  }
  flush();
  return pairs;
}

export function renderInterview(pairs: readonly InterviewPair[], title = 'Interview'): string {
  const blocks = pairs.map((p) => `### Q: ${p.question.replace(/\n/g, ' ')}\n${p.answer ? `A: ${normalizeNewlines(p.answer).trim()}\n` : ''}`);
  return `# ${title}\n\n${blocks.join('\n')}`;
}
