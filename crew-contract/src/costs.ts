// costs.log: JSON Lines, append-only, several writers. Only `sdk` and `headless` entries are
// authoritative dollar figures (they come from the host's total_cost_usd); `estimate` entries are
// the plugin's per-task token estimates and never count toward a budget cap.

import { type CostEntry, CostEntrySchema, formatIssues } from './schemas';

export const AUTHORITATIVE_SOURCES: readonly CostEntry['source'][] = ['sdk', 'headless'];

export interface ParsedCosts {
  entries: CostEntry[];
  issues: { line: number; message: string }[];
}

/** Lines written by extension v0.1 before the contract: `<ts> session=… turn_cost_usd=… session_total_usd=… source=sdk`. */
function parseLegacyLine(line: string): Record<string, unknown> | undefined {
  const tokens = line.split(/\s+/);
  const ts = tokens[0];
  if (!ts || !/^\d{4}-\d{2}-\d{2}T/.test(ts)) return undefined;
  const out: Record<string, unknown> = { ts };
  for (const token of tokens.slice(1)) {
    const eq = token.indexOf('=');
    if (eq <= 0) continue;
    const key = token.slice(0, eq);
    const raw = token.slice(eq + 1);
    if (key === 'session') out.session_id = raw;
    else if (key === 'turn_cost_usd' || key === 'session_total_usd') out[key] = Number(raw);
    else if (key === 'source') out.source = raw;
  }
  out.source ??= 'sdk';
  return out;
}

export function parseCostsLog(text: string): ParsedCosts {
  const entries: CostEntry[] = [];
  const issues: ParsedCosts['issues'] = [];
  text.split(/\r?\n/).forEach((rawLine, index) => {
    const line = rawLine.trim();
    if (line === '' || line.startsWith('#')) return;
    let candidate: unknown;
    if (line.startsWith('{')) {
      try {
        candidate = JSON.parse(line);
      } catch {
        issues.push({ line: index + 1, message: 'not valid JSON' });
        return;
      }
    } else {
      candidate = parseLegacyLine(line);
      if (!candidate) {
        issues.push({ line: index + 1, message: 'neither a JSON line nor a legacy cost line' });
        return;
      }
    }
    const result = CostEntrySchema.safeParse(candidate);
    if (result.success) entries.push(result.data);
    else issues.push({ line: index + 1, message: formatIssues(result.error).join('; ') });
  });
  return { entries, issues };
}

export function formatCostEntry(entry: CostEntry): string {
  return JSON.stringify(CostEntrySchema.parse(entry));
}

/**
 * Dollars spent by the project. Per session the highest running total wins (hosts report
 * cumulative totals, and a resumed session continues from its saved total); a session that only
 * has per-turn costs is summed. Estimates are ignored unless asked for.
 */
export function projectSpentUsd(
  entries: readonly CostEntry[],
  options: { excludeSession?: string; sources?: readonly CostEntry['source'][] } = {},
): number {
  const sources = options.sources ?? AUTHORITATIVE_SOURCES;
  const totals = new Map<string, number>();
  const turns = new Map<string, number>();
  let loose = 0;
  for (const e of entries) {
    if (!sources.includes(e.source)) continue;
    if (options.excludeSession && e.session_id === options.excludeSession) continue;
    if (e.session_id && e.session_total_usd !== undefined) {
      totals.set(e.session_id, Math.max(totals.get(e.session_id) ?? 0, e.session_total_usd));
    } else if (e.session_id && e.turn_cost_usd !== undefined) {
      turns.set(e.session_id, (turns.get(e.session_id) ?? 0) + e.turn_cost_usd);
    } else {
      loose += e.turn_cost_usd ?? e.session_total_usd ?? 0;
    }
  }
  let sum = loose;
  for (const v of totals.values()) sum += v;
  for (const [session, v] of turns) if (!totals.has(session)) sum += v;
  return sum;
}

/** Highest running total recorded for one session (0 when none). */
export function sessionTotalUsd(entries: readonly CostEntry[], sessionId: string): number {
  let max = 0;
  for (const e of entries) if (e.session_id === sessionId && e.session_total_usd !== undefined) max = Math.max(max, e.session_total_usd);
  return max;
}

/** Plugin estimates per task: tokens and dollars (dollars only where the estimator priced them). */
export function taskEstimates(entries: readonly CostEntry[]): Map<string, { tokens: number; usd: number }> {
  const out = new Map<string, { tokens: number; usd: number }>();
  for (const e of entries) {
    if (e.source !== 'estimate' || !e.task) continue;
    const current = out.get(e.task) ?? { tokens: 0, usd: 0 };
    const t = e.tokens;
    current.tokens += t ? t.input + t.output + (t.cache_read ?? 0) + (t.cache_write ?? 0) : 0;
    current.usd += e.turn_cost_usd ?? 0;
    out.set(e.task, current);
  }
  return out;
}

/** Total tokens the plugin estimated for the whole project (what a subscription user sees). */
export function estimatedTokens(entries: readonly CostEntry[]): number {
  let sum = 0;
  for (const v of taskEstimates(entries).values()) sum += v.tokens;
  return sum;
}
