// PostToolUse and SubagentStop work: validate .crew/ writes, journal edits for flip-flop
// detection, and estimate what a subagent run cost.

import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { digest, isInside, toPosix } from './util.mjs';

const EDIT_TOOLS = new Set(['Write', 'Edit', 'MultiEdit', 'NotebookEdit']);

function relIfInside(root, cwd, file) {
  if (typeof file !== 'string' || !file) return undefined;
  const abs = path.resolve(cwd, file);
  return isInside(abs, root) ? toPosix(path.relative(root, abs)) : undefined;
}

/**
 * Validates a file the agent just wrote under .crew/. Returns a message for the agent when
 * the file breaks the contract, so it fixes it right away.
 */
export function validateCrewWrite(input, root, contract) {
  if (!EDIT_TOOLS.has(input.tool_name)) return undefined;
  const rel = relIfInside(root, input.cwd ?? root, input.tool_input?.file_path ?? input.tool_input?.notebook_path);
  if (!rel || !rel.startsWith('.crew/')) return undefined;
  const abs = path.join(root, rel);
  if (!existsSync(abs)) return undefined;
  const result = contract.validateCrewFile(rel, readFileSync(abs, 'utf8'));
  if (!result || result.ok) return undefined;
  return `${rel} does not match the .crew/ contract:\n- ${result.issues.join('\n- ')}\nFix the file now, or rewrite it with the \`crew\` CLI, which always produces valid files (see the crew-files skill).`;
}

/** Journal entries (before/after digests) for edits outside .crew/. */
export function editJournalEntries(input, root, now) {
  if (input.tool_name !== 'Edit' && input.tool_name !== 'MultiEdit') return [];
  const rel = relIfInside(root, input.cwd ?? root, input.tool_input?.file_path);
  if (!rel || rel.startsWith('.crew/')) return [];
  const edits = input.tool_name === 'Edit' ? [input.tool_input] : (input.tool_input?.edits ?? []);
  return edits
    .filter((e) => typeof e?.old_string === 'string' && typeof e?.new_string === 'string')
    .map((e) => {
      const entry = { ts: now, session_id: String(input.session_id ?? 'unknown'), file: rel, before: digest(e.old_string), after: digest(e.new_string) };
      if (input.agent_type) entry.agent_type = input.agent_type;
      return entry;
    });
}

// ---------------------------------------------------------------------------
// Cost estimate from a subagent transcript

export function priceFor(model, prices) {
  if (!model) return undefined;
  const id = prices.aliases?.[model] ?? model;
  const exact = prices.models[id];
  if (exact) return { id, ...exact };
  // Dated or suffixed ids (claude-opus-5-5[1m], claude-x-20260101) fall back to the longest known prefix.
  const key = Object.keys(prices.models)
    .filter((k) => id.startsWith(k))
    .sort((a, b) => b.length - a.length)[0];
  return key ? { id: key, ...prices.models[key] } : undefined;
}

/**
 * Sums token usage of every assistant message in a transcript (JSONL). Streamed messages repeat
 * the same id with the same usage, so the last line per message id wins.
 */
export function transcriptUsage(text) {
  const byId = new Map();
  let firstUserText = '';
  let model;
  for (const line of text.split('\n')) {
    if (!line.trim()) continue;
    let entry;
    try {
      entry = JSON.parse(line);
    } catch {
      continue;
    }
    const msg = entry?.message;
    if (!firstUserText && entry?.type === 'user' && msg) {
      const content = msg.content;
      firstUserText = typeof content === 'string' ? content : Array.isArray(content) ? content.map((c) => (typeof c?.text === 'string' ? c.text : '')).join('\n') : '';
    }
    if (entry?.type !== 'assistant' || !msg?.usage) continue;
    model = msg.model ?? model;
    byId.set(msg.id ?? `${byId.size}`, msg.usage);
  }
  const tokens = { input: 0, output: 0, cache_read: 0, cache_write: 0 };
  for (const u of byId.values()) {
    tokens.input += u.input_tokens ?? 0;
    tokens.output += u.output_tokens ?? 0;
    tokens.cache_read += u.cache_read_input_tokens ?? 0;
    tokens.cache_write += u.cache_creation_input_tokens ?? 0;
  }
  const task = /\bT-\d{3,}\b/.exec(firstUserText)?.[0];
  return { tokens, model, task, messages: byId.size };
}

export function estimateUsd(tokens, price) {
  if (!price) return undefined;
  const cacheRead = price.cacheRead ?? price.input * 0.1;
  const cacheWrite = price.cacheWrite ?? price.input * 1.25;
  const usd = (tokens.input * price.input + tokens.output * price.output + tokens.cache_read * cacheRead + tokens.cache_write * cacheWrite) / 1_000_000;
  return Math.round(usd * 1e6) / 1e6;
}

/** Builds the costs.log estimate entry for a finished subagent, or undefined when there is nothing to record. */
export function subagentCostEntry(input, prices, now) {
  const file = input.agent_transcript_path;
  if (typeof file !== 'string' || !existsSync(file)) return undefined;
  const usage = transcriptUsage(readFileSync(file, 'utf8'));
  if (!usage.messages) return undefined;
  const price = priceFor(usage.model, prices);
  const entry = { ts: now, source: 'estimate', session_id: String(input.session_id ?? 'unknown'), tokens: usage.tokens };
  if (usage.task) entry.task = usage.task;
  if (input.agent_type) entry.agent = String(input.agent_type).split(':').pop();
  if (usage.model) entry.model = usage.model;
  const usd = estimateUsd(usage.tokens, price);
  if (usd !== undefined) entry.turn_cost_usd = usd;
  return entry;
}
