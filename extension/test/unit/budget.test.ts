import { describe, expect, it } from 'vitest';
import { BudgetTracker, budgetLevel, formatUsd } from '../../src/crew/budget';

describe('budget', () => {
  it('computes levels with 80% warning and a 0 = no cap rule', () => {
    expect(budgetLevel(1, 20)).toBe('ok');
    expect(budgetLevel(16, 20)).toBe('warn');
    expect(budgetLevel(20, 20)).toBe('exceeded');
    expect(budgetLevel(1000, 0)).toBe('ok');
  });

  it('fires the warning and the cap once each', () => {
    const tracker = new BudgetTracker(10, 2);
    expect(tracker.remainingUsd()).toBe(8);
    expect(tracker.update(5)).toMatchObject({ spentUsd: 7, level: 'ok', crossedWarn: false, crossedCap: false });
    expect(tracker.update(6.5)).toMatchObject({ level: 'warn', crossedWarn: true, crossedCap: false });
    expect(tracker.update(7)).toMatchObject({ crossedWarn: false });
    expect(tracker.update(8)).toMatchObject({ level: 'exceeded', crossedCap: true });
    expect(tracker.update(9)).toMatchObject({ crossedCap: false });
    // Totals never go backwards
    expect(tracker.update(1).spentUsd).toBe(11);
    expect(tracker.remainingUsd()).toBe(0);
  });

  it('starts from a resumed session total and re-arms after the cap is raised', () => {
    const tracker = new BudgetTracker(10, 0, 9);
    expect(tracker.status()).toEqual({ spentUsd: 9, capUsd: 10, level: 'warn' });
    expect(tracker.update(9.5).crossedWarn).toBe(false);
    expect(tracker.setCap(100)).toMatchObject({ level: 'ok', crossedWarn: false });
    expect(tracker.update(85)).toMatchObject({ crossedWarn: true });
    expect(tracker.setCap(90)).toMatchObject({ level: 'warn' });
    expect(tracker.update(95)).toMatchObject({ crossedCap: true });
    expect(new BudgetTracker(0, 50).remainingUsd()).toBeUndefined();
  });

  it('formats dollars', () => {
    expect(formatUsd(1.234)).toBe('$1.23');
    expect(formatUsd(12.34)).toBe('$12.3');
    expect(formatUsd(1234.5)).toBe('$1235');
  });
});
