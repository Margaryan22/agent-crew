// Runtime configuration of a crew session. Values come from, in order:
//   1. CREW_* environment variables (a host such as the eval runner sets them)
//   2. CLAUDE_PLUGIN_OPTION_* (the plugin's userConfig; Claude Code exports only values the user set)
//   3. EVAL_CREW_* (claude plugin eval passes only EVAL_* variables into runs)
//   4. defaults — userConfig defaults are NOT exported by Claude Code, so they live here too.

export type Autonomy = 'full' | 'review';
export type CrewHost = 'interactive' | 'eval' | 'sdk';
/** Which models the agents run on: economy keeps the plan's limits, quality spends them on stronger models. */
export type ModelTier = 'economy' | 'balanced' | 'quality';
/** How much review each task gets: QA and security, QA only, or only the final review of the whole project. */
export type ReviewDepth = 'every-task' | 'qa-only' | 'final-only';
export const MODEL_TIERS = ['economy', 'balanced', 'quality'] as const;
export const REVIEW_DEPTHS = ['every-task', 'qa-only', 'final-only'] as const;

export interface CrewConfig {
  autonomy: Autonomy;
  briefReviewMinutes: number;
  budgetCapUsd: number;
  stackProfile: string;
  modelTier: ModelTier;
  reviewDepth: ReviewDepth;
  host: CrewHost;
}

export type ConfigSource = 'env' | 'userConfig' | 'eval' | 'default';

export const CONFIG_DEFAULTS: CrewConfig = {
  autonomy: 'full',
  briefReviewMinutes: 10,
  // 0 = no cap. A cap only makes sense where spend is real money (API key, usage credits); on a
  // subscription the plan's own limits apply, so nothing is capped unless the user asks for it.
  budgetCapUsd: 0,
  stackProfile: 'auto',
  modelTier: 'balanced',
  reviewDepth: 'every-task',
  host: 'interactive',
};

/**
 * `auto`: the architect picks (or detects) the project's stack and writes its rules into
 * .crew/stack/. The other names are presets the plugin ships with a template and ready rules.
 */
export const AUTO_STACK = 'auto';
export const STACK_PROFILES = [AUTO_STACK, 'tanstack'] as const;

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

  const oneOf = <T extends string>(values: readonly T[]) => (r: string) => ((values as readonly string[]).includes(r) ? (r as T) : undefined);
  const modelTier = pick<ModelTier>('MODEL_TIER', oneOf(MODEL_TIERS), CONFIG_DEFAULTS.modelTier);
  const reviewDepth = pick<ReviewDepth>('REVIEW_DEPTH', oneOf(REVIEW_DEPTHS), CONFIG_DEFAULTS.reviewDepth);

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
      modelTier: modelTier.value,
      reviewDepth: reviewDepth.value,
      host: host.value,
    },
    sources: {
      autonomy: autonomy.source,
      briefReviewMinutes: briefReviewMinutes.source,
      budgetCapUsd: budgetCapUsd.source,
      stackProfile: stackProfile.source,
      modelTier: modelTier.source,
      reviewDepth: reviewDepth.source,
      host: host.source,
    },
    issues,
  };
}
