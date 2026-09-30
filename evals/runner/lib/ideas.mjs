// Eval ideas (evals/ideas/<id>.md): frontmatter (id, title, language), an "# Idea" section and an
// "# Interview" section of `### Q:` / `A:` blocks grouped under `## <block>` headings.
// Both modes get exactly the same information: the plugin through .crew/interview.md (the PM
// asks only what is missing), the baseline inside its prompt.

import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';

function frontmatter(text) {
  const m = /^---\n([\s\S]*?)\n---\n?/.exec(text);
  if (!m) return { data: {}, body: text };
  const data = {};
  for (const line of m[1].split('\n')) {
    const kv = /^([A-Za-z_][\w-]*):\s*(.*)$/.exec(line);
    if (kv) data[kv[1]] = kv[2].replace(/^["']|["']$/g, '').trim();
  }
  return { data, body: text.slice(m[0].length) };
}

/** Text of `# <title>` up to the next `# ` heading. */
function topSection(body, title) {
  const lines = body.split('\n');
  const start = lines.findIndex((l) => l.trim().toLowerCase() === `# ${title}`.toLowerCase());
  if (start < 0) return undefined;
  const end = lines.findIndex((l, i) => i > start && /^#\s/.test(l));
  return lines.slice(start + 1, end < 0 ? undefined : end).join('\n').trim();
}

export function parseIdea(text, file = 'idea.md') {
  const { data, body } = frontmatter(text.replace(/\r\n?/g, '\n'));
  const idea = topSection(body, 'Idea');
  const interview = topSection(body, 'Interview');
  if (!data.id) throw new Error(`${file}: frontmatter needs an id`);
  if (!idea) throw new Error(`${file}: missing "# Idea" section`);
  if (!interview) throw new Error(`${file}: missing "# Interview" section`);
  const pairs = [];
  let block;
  let current;
  for (const line of interview.split('\n')) {
    const h = /^##\s+(.+)$/.exec(line);
    const q = /^###\s+Q:\s*(.+)$/.exec(line);
    const a = /^A:\s*(.*)$/.exec(line);
    if (h) block = h[1].trim();
    else if (q) pairs.push((current = { block, question: q[1].trim(), answer: '' }));
    else if (a && current) current.answer = a[1].trim();
    else if (current && current.answer && line.trim()) current.answer += `\n${line.trim()}`;
  }
  if (!pairs.length || pairs.some((p) => !p.answer)) throw new Error(`${file}: every interview question needs an answer`);
  return { id: data.id, title: data.title ?? data.id, language: data.language ?? 'en', idea, interview: pairs };
}

export function loadIdeas(dir, ids) {
  const all = readdirSync(dir)
    .filter((n) => n.endsWith('.md'))
    .map((n) => parseIdea(readFileSync(path.join(dir, n), 'utf8'), n));
  if (!ids?.length) return all;
  const missing = ids.filter((id) => !all.some((i) => i.id === id));
  if (missing.length) throw new Error(`unknown idea${missing.length > 1 ? 's' : ''}: ${missing.join(', ')}`);
  return ids.map((id) => all.find((i) => i.id === id));
}

/** .crew/interview.md with every answer filled in (the plugin's orchestrator skips asking). */
export function interviewFile(idea) {
  const out = ['---', 'answered_by: eval', '---', '', '# Interview', ''];
  let block;
  for (const p of idea.interview) {
    if (p.block && p.block !== block) {
      block = p.block;
      out.push(`## ${block}`, '');
    }
    out.push(`### Q: ${p.question}`, `A: ${p.answer}`, '');
  }
  return `${out.join('\n').trimEnd()}\n`;
}

export function pluginPrompt(idea) {
  return `/agent-crew:new-project ${idea.idea.replace(/\s+/g, ' ').trim()}`;
}

/** The baseline gets the idea, the same answers, and the same definition of done — no crew. */
export function baselinePrompt(idea) {
  const answers = idea.interview.map((p) => `- ${p.question}\n  ${p.answer.replace(/\n/g, '\n  ')}`).join('\n');
  return [
    `Build this app in the current folder: ${idea.idea.replace(/\s+/g, ' ').trim()}`,
    '',
    'The folder already holds a working TanStack Start + Drizzle + PostgreSQL project template with sign-in, roles, Vitest and Playwright; its CLAUDE.md describes the commands and conventions. The database is running and migrated.',
    '',
    "The owner's answers to your questions:",
    answers,
    '',
    'Work autonomously — nobody will answer questions. Follow the answers exactly (page addresses, labels, buttons and messages). Seed the accounts and data they name. Write end-to-end tests for the main scenarios, make them and the type check pass, commit your work with git, and finish with a short summary of what was built.',
  ].join('\n');
}
