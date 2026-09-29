// Runtime configuration of a crew session. Values come from, in order:
//   1. CREW_* environment variables (a host such as the eval runner sets them)
//   2. CLAUDE_PLUGIN_OPTION_* (the plugin's userConfig; Claude Code exports only values the user set)
//   3. EVAL_CREW_* (claude plugin eval passes only EVAL_* variables into runs)
//   4. defaults — userConfig defaults are NOT exported by Claude Code, so they live here too.

export type Autonomy = 'full' | 'review';
export type CrewHost = 'interactive' | 'eval' | 'sdk';

export interface CrewConfig {
  autonomy: Autonomy;
  briefReviewMinutes: number;
  budgetCapUsd: number;
  stackProfile: string;
  host: CrewHost;
}

export type ConfigSource = 'env' | 'userConfig' | 'eval' | 'default';

export const CONFIG_DEFAULTS: CrewConfig = {
  autonomy: 'full',
  briefReviewMinutes: 10,
  budgetCapUsd: 20,
  stackProfile: 'tanstack',
  host: 'interactive',
};

export const STACK_PROFILES = ['tanstack'] as const;

type Env = Record<string, string | undefined>;

interface Resolved<T> {
  value: T;
  source: ConfigSource;
}

function lookup(env: Env, key: string): { raw: string; source: ConfigSource } | undefined {
  const candidates: [string, ConfigSource][] = [
    [`CREW_${key}`, 'env'],
    [`CLAUDE_PLUGIN_OPTION_${key}`, 'userConfig'],
    [`EVAL_CREW_${key}`, 'eval'],
  ];
  for (const [name, source] of candidates) {
    const raw = env[name]?.trim();
    if (raw) return { raw, source };
  }
  return undefined;
}

export function resolveCrewConfig(env: Env): { config: CrewConfig; sources: Record<keyof CrewConfig, ConfigSource>; issues: string[] } {
  const issues: string[] = [];

  function pick<T>(key: string, parse: (raw: string) => T | undefined, fallback: T): Resolved<T> {
    const found = lookup(env, key);
    if (!found) return { value: fallback, source: 'default' };
    const value = parse(found.raw);
    if (value === undefined) {
      issues.push(`Ignoring invalid ${key.toLowerCase()} "${found.raw}" from ${found.source}; using ${String(fallback)}.`);
      return { value: fallback, source: 'default' };
    }
    return { value, source: found.source };
  }

  const number = (min: number, max: number) => (raw: string) => {
    const n = Number(raw);
    return Number.isFinite(n) && n >= min && n <= max ? n : undefined;
  };

  const autonomy = pick<Autonomy>('AUTONOMY', (r) => (r === 'full' || r === 'review' ? r : undefined), CONFIG_DEFAULTS.autonomy);
  const briefReviewMinutes = pick('BRIEF_REVIEW_MINUTES', number(1, 240), CONFIG_DEFAULTS.briefReviewMinutes);
  const budgetCapUsd = pick('BUDGET_CAP_USD', number(0, 100_000), CONFIG_DEFAULTS.budgetCapUsd);
  const stackProfile = pick('STACK_PROFILE', (r) => ((STACK_PROFILES as readonly string[]).includes(r) ? r : undefined), CONFIG_DEFAULTS.stackProfile);

  let host: Resolved<CrewHost> = { value: CONFIG_DEFAULTS.host, source: 'default' };
  const hostRaw = env.CREW_HOST?.trim();
  if (hostRaw === 'eval' || hostRaw === 'sdk' || hostRaw === 'interactive') host = { value: hostRaw, source: 'env' };
  else if (env.CREW_EVAL === '1' || env.EVAL_CREW === '1') host = { value: 'eval', source: env.CREW_EVAL === '1' ? 'env' : 'eval' };
  else if (hostRaw) issues.push(`Ignoring unknown CREW_HOST "${hostRaw}".`);

  return {
    config: {
      autonomy: autonomy.value,
      briefReviewMinutes: briefReviewMinutes.value,
      budgetCapUsd: budgetCapUsd.value,
      stackProfile: stackProfile.value,
      host: host.value,
    },
    sources: {
      autonomy: autonomy.source,
      briefReviewMinutes: briefReviewMinutes.source,
      budgetCapUsd: budgetCapUsd.source,
      stackProfile: stackProfile.source,
      host: host.source,
    },
    issues,
  };
}
