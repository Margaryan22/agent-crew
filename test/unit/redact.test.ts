import { describe, expect, it, vi } from 'vitest';
import { redactingLogger, SecretRedactor } from '../../src/redact';
import { errorEvent, sessionEndEvent, Telemetry } from '../../src/telemetry';

describe('SecretRedactor', () => {
  it('removes registered secrets and anything shaped like an Anthropic key', () => {
    const r = new SecretRedactor();
    r.add('license-XYZ-123456');
    r.add('short');
    r.add(undefined);
    expect(r.redact('key license-XYZ-123456 and short')).toBe('key *** and short');
    expect(r.redact('export ANTHROPIC_API_KEY=sk-ant-api03-abcdefghijkl')).toBe('export ANTHROPIC_API_KEY=sk-ant-***');
    r.delete('license-XYZ-123456');
    r.delete(undefined);
    expect(r.redact('license-XYZ-123456')).toBe('license-XYZ-123456');
  });

  it('redacts nested values', () => {
    const r = new SecretRedactor();
    r.add('super-secret-value');
    expect(r.redactValue({ a: ['x super-secret-value'], b: { c: 'super-secret-value' }, n: 1, z: null })).toEqual({ a: ['x ***'], b: { c: '***' }, n: 1, z: null });
  });

  it('redactingLogger filters every level', () => {
    const r = new SecretRedactor();
    r.add('super-secret-value');
    const sink = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
    const log = redactingLogger(sink, r);
    log.info('i super-secret-value');
    log.warn('w super-secret-value');
    log.error('e super-secret-value');
    log.debug('d super-secret-value');
    expect(sink.info).toHaveBeenCalledWith('i ***');
    expect(sink.warn).toHaveBeenCalledWith('w ***');
    expect(sink.error).toHaveBeenCalledWith('e ***');
    expect(sink.debug).toHaveBeenCalledWith('d ***');
  });
});

describe('telemetry', () => {
  it('sends aggregates only and respects the setting', () => {
    const sink = { logUsage: vi.fn() };
    let enabled = true;
    const telemetry = new Telemetry(sink, () => enabled);
    telemetry.send(sessionEndEvent({ durationMs: 125_400, tasks: 7.9, escalations: -1, costUsd: 3.14159, outcome: 'completed', resumed: false }));
    expect(sink.logUsage).toHaveBeenCalledWith('session_end', { durationSec: 125, tasks: 7, escalations: 0, costUsd: 3.14, outcome: 'completed', resumed: false });
    telemetry.send(errorEvent('C:/Users/me/secret-project failed'));
    expect(sink.logUsage).toHaveBeenLastCalledWith('error', { kind: 'unknown' });
    telemetry.send(errorEvent('auth_failed'));
    expect(sink.logUsage).toHaveBeenLastCalledWith('error', { kind: 'auth_failed' });
    enabled = false;
    telemetry.send(errorEvent('auth_failed'));
    expect(sink.logUsage).toHaveBeenCalledTimes(3);
  });
});
