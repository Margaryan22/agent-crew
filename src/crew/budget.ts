// Budget tracking: project spend = everything already in .crew/costs.log from other sessions
// plus the running total of the current session (Agent SDK `total_cost_usd`).

export const WARN_RATIO = 0.8;

export type BudgetLevel = 'ok' | 'warn' | 'exceeded';

export interface BudgetStatus {
  spentUsd: number;
  capUsd: number;
  level: BudgetLevel;
}

/** A cap of 0 means "no cap". */
export function budgetLevel(spentUsd: number, capUsd: number): BudgetLevel {
  if (capUsd <= 0) return 'ok';
  if (spentUsd >= capUsd) return 'exceeded';
  if (spentUsd >= capUsd * WARN_RATIO) return 'warn';
  return 'ok';
}

export interface BudgetUpdate extends BudgetStatus {
  crossedWarn: boolean;
  crossedCap: boolean;
}

export class BudgetTracker {
  private sessionTotal = 0;
  private warned = false;
  private capped = false;

  /**
   * @param spentBeforeUsd project spend excluding the current session
   * @param sessionStartUsd the session's own recorded total when resuming it
   */
  constructor(
    private capUsd: number,
    private readonly spentBeforeUsd: number,
    sessionStartUsd = 0,
  ) {
    this.sessionTotal = sessionStartUsd;
    const level = budgetLevel(this.spentUsd, capUsd);
    this.warned = level !== 'ok';
    this.capped = level === 'exceeded';
  }

  get spentUsd(): number {
    return this.spentBeforeUsd + this.sessionTotal;
  }

  /** Budget the SDK may still spend in this query() call (undefined when uncapped). */
  remainingUsd(): number | undefined {
    return this.capUsd > 0 ? Math.max(this.capUsd - this.spentUsd, 0) : undefined;
  }

  setCap(capUsd: number): BudgetUpdate {
    this.capUsd = capUsd;
    const level = budgetLevel(this.spentUsd, capUsd);
    if (level === 'ok') this.warned = this.capped = false;
    if (level === 'warn') this.capped = false;
    return this.update(this.sessionTotal);
  }

  /** Feed the latest running session total. Totals never go down. */
  update(sessionTotalUsd: number): BudgetUpdate {
    this.sessionTotal = Math.max(this.sessionTotal, sessionTotalUsd);
    const level = budgetLevel(this.spentUsd, this.capUsd);
    const crossedWarn = level !== 'ok' && !this.warned;
    const crossedCap = level === 'exceeded' && !this.capped;
    if (crossedWarn) this.warned = true;
    if (crossedCap) this.capped = true;
    return { spentUsd: this.spentUsd, capUsd: this.capUsd, level, crossedWarn, crossedCap };
  }

  status(): BudgetStatus {
    return { spentUsd: this.spentUsd, capUsd: this.capUsd, level: budgetLevel(this.spentUsd, this.capUsd) };
  }
}

export function formatUsd(value: number): string {
  return `$${value < 10 ? value.toFixed(2) : value.toFixed(value < 1000 ? 1 : 0)}`;
}
