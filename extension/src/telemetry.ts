// Aggregate-only telemetry. Events carry numbers and enum-like strings — never code, prompts,
// file paths or agent output. VS Code's global telemetry switch is honoured by the
// TelemetryLogger the extension creates; `crew.telemetry.enabled` can switch it off on top.
// There is no Crew backend in v0: the default sender only writes events to the Crew log, and a
// real endpoint can be plugged in through TelemetrySink later.

export interface SessionStats {
  durationMs: number;
  tasks: number;
  escalations: number;
  costUsd: number;
  outcome: 'completed' | 'stopped' | 'budget' | 'error';
  resumed: boolean;
}

export type TelemetryEvent =
  | { name: 'session_end'; data: Record<string, number | string | boolean> }
  | { name: 'error'; data: { kind: string } };

const ERROR_KINDS = new Set(['session_failed', 'auth_failed', 'binary_missing', 'plugin_missing', 'plugin_error', 'escalation_write_failed', 'unknown']);

export function sessionEndEvent(stats: SessionStats): TelemetryEvent {
  return {
    name: 'session_end',
    data: {
      durationSec: Math.round(stats.durationMs / 1000),
      tasks: Math.max(0, Math.floor(stats.tasks)),
      escalations: Math.max(0, Math.floor(stats.escalations)),
      costUsd: Math.round(stats.costUsd * 100) / 100,
      outcome: stats.outcome,
      resumed: stats.resumed,
    },
  };
}

export function errorEvent(kind: string): TelemetryEvent {
  return { name: 'error', data: { kind: ERROR_KINDS.has(kind) ? kind : 'unknown' } };
}

export interface TelemetrySink {
  logUsage(eventName: string, data: Record<string, unknown>): void;
}

export class Telemetry {
  constructor(
    private readonly sink: TelemetrySink,
    private readonly settingEnabled: () => boolean,
  ) {}

  send(event: TelemetryEvent): void {
    if (!this.settingEnabled()) return;
    this.sink.logUsage(event.name, event.data);
  }
}
