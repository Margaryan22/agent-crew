// Test doubles for the Agent SDK and the controller host.

import type { Options, Query, SDKMessage, SDKUserMessage } from '@anthropic-ai/claude-agent-sdk';
import type { RuntimePaths } from '../../src/agent/runtime';
import type { SdkModule } from '../../src/agent/session';
import type { ControllerHost, CrewConfig, Memento } from '../../src/controller';
import { UNRESTRICTED, type Entitlements, type StartCheck } from '../../src/license';
import type { Logger } from '../../src/redact';
import type { ExtensionToWebview } from '../../src/shared/protocol';
import type { TelemetryEvent } from '../../src/telemetry';

export const tick = (ms = 0) => new Promise((r) => setTimeout(r, ms));

/** Waits until `check` passes (polling), failing after `timeoutMs`. */
export async function until(check: () => boolean, timeoutMs = 2000): Promise<void> {
  const start = Date.now();
  while (!check()) {
    if (Date.now() - start > timeoutMs) throw new Error('Timed out waiting for condition');
    await tick(5);
  }
}

export class FakeQuery {
  readonly userMessages: string[] = [];
  interrupted = 0;
  closed = false;
  liveCost: number | undefined;
  private readonly buffer: SDKMessage[] = [];
  private waiter: ((r: undefined) => void) | undefined;
  private ended = false;
  private failure: Error | undefined;

  constructor(
    readonly prompt: string | AsyncIterable<SDKUserMessage>,
    readonly options: Options,
  ) {
    if (typeof prompt !== 'string') void this.readInput(prompt);
  }

  private async readInput(input: AsyncIterable<SDKUserMessage>): Promise<void> {
    for await (const m of input) {
      const content = m.message.content;
      this.userMessages.push(typeof content === 'string' ? content : JSON.stringify(content));
    }
  }

  emit(message: SDKMessage): void {
    if (this.ended) return;
    this.buffer.push(message);
    if (this.waiter) {
      const w = this.waiter;
      this.waiter = undefined;
      w(undefined);
    }
  }

  end(error?: Error): void {
    this.ended = true;
    this.failure = error;
    if (this.waiter && !this.buffer.length) {
      const w = this.waiter;
      this.waiter = undefined;
      w(undefined);
    }
  }

  async interrupt(): Promise<undefined> {
    this.interrupted++;
    return undefined;
  }

  close(): void {
    this.closed = true;
    this.end();
  }

  async usage_EXPERIMENTAL_MAY_CHANGE_DO_NOT_RELY_ON_THIS_API_YET() {
    if (this.liveCost === undefined) throw new Error('unsupported');
    return { session: { total_cost_usd: this.liveCost } };
  }

  [Symbol.asyncIterator](): AsyncIterator<SDKMessage> {
    const next = async (): Promise<IteratorResult<SDKMessage>> => {
      for (;;) {
        const message = this.buffer.shift();
        if (message) return { value: message, done: false };
        if (this.failure) {
          const err = this.failure;
          this.failure = undefined;
          throw err;
        }
        if (this.ended) return { value: undefined, done: true };
        await new Promise<void>((resolve) => {
          this.waiter = () => resolve();
        });
      }
    };
    return { next };
  }
}

export class FakeSdk implements SdkModule {
  readonly queries: FakeQuery[] = [];

  query(params: { prompt: string | AsyncIterable<SDKUserMessage>; options?: Options }): Query {
    const q = new FakeQuery(params.prompt, params.options ?? {});
    this.queries.push(q);
    return q as unknown as Query;
  }

  get last(): FakeQuery {
    const q = this.queries.at(-1);
    if (!q) throw new Error('No query started');
    return q;
  }
}

// --- SDK message builders ----------------------------------------------------

let uuid = 0;
const id = () => `00000000-0000-4000-8000-${String(++uuid).padStart(12, '0')}` as `${string}-${string}-${string}-${string}-${string}`;

export function initMessage(sessionId: string, plugins: { name: string; version?: string }[] = [{ name: 'agent-crew', version: '0.1.0' }], extra: Record<string, unknown> = {}): SDKMessage {
  return {
    type: 'system',
    subtype: 'init',
    apiKeySource: 'ANTHROPIC_API_KEY',
    claude_code_version: '2.1.283',
    cwd: '/work/project',
    tools: [],
    mcp_servers: [],
    model: 'claude-opus-5-5',
    permissionMode: 'default',
    slash_commands: ['agent-crew:new-project', 'agent-crew:feature', 'agent-crew:status'],
    output_style: 'default',
    skills: [],
    plugins: plugins.map((p) => ({ ...p, path: `/plugins/${p.name}` })),
    uuid: id(),
    session_id: sessionId,
    ...extra,
  } as SDKMessage;
}

export function assistantText(text: string, opts: { parent?: string | null; subagentType?: string; model?: string; error?: string } = {}): SDKMessage {
  return {
    type: 'assistant',
    message: { id: id(), type: 'message', role: 'assistant', model: opts.model ?? 'claude-opus-5-5', content: [{ type: 'text', text }], stop_reason: null, usage: {} },
    parent_tool_use_id: opts.parent ?? null,
    ...(opts.subagentType ? { subagent_type: opts.subagentType } : {}),
    ...(opts.error ? { error: opts.error } : {}),
    uuid: id(),
    session_id: 's-1',
  } as unknown as SDKMessage;
}

export function assistantToolUse(name: string, input: Record<string, unknown>, toolUseId: string, opts: { parent?: string | null } = {}): SDKMessage {
  return {
    type: 'assistant',
    message: { id: id(), type: 'message', role: 'assistant', model: 'claude-opus-5-5', content: [{ type: 'tool_use', id: toolUseId, name, input }], stop_reason: null, usage: {} },
    parent_tool_use_id: opts.parent ?? null,
    uuid: id(),
    session_id: 's-1',
  } as unknown as SDKMessage;
}

export function resultMessage(sessionId: string, totalCostUsd: number, subtype: 'success' | 'error_max_budget_usd' | 'error_during_execution' = 'success', text = 'Done'): SDKMessage {
  const base = {
    type: 'result',
    subtype,
    duration_ms: 1234,
    duration_api_ms: 1000,
    is_error: subtype !== 'success',
    num_turns: 3,
    stop_reason: 'end_turn',
    total_cost_usd: totalCostUsd,
    usage: {},
    modelUsage: {},
    permission_denials: [],
    uuid: id(),
    session_id: sessionId,
  };
  return (subtype === 'success' ? { ...base, result: text } : { ...base, errors: ['budget exceeded'] }) as unknown as SDKMessage;
}

export function systemMessage(subtype: string, fields: Record<string, unknown>): SDKMessage {
  return { type: 'system', subtype, uuid: id(), session_id: 's-1', ...fields } as unknown as SDKMessage;
}

// --- Controller host -----------------------------------------------------------

export class MemoryMemento implements Memento {
  readonly data = new Map<string, unknown>();
  get<T>(key: string): T | undefined {
    return this.data.get(key) as T | undefined;
  }
  update(key: string, value: unknown): Promise<void> {
    this.data.set(key, value);
    return Promise.resolve();
  }
}

export interface FakeHostOptions {
  apiKey?: string | undefined;
  trusted?: boolean;
  config?: Partial<CrewConfig>;
  files?: Record<string, string>;
  runtime?: Partial<RuntimePaths>;
  entitlements?: Entitlements;
  startCheck?: StartCheck;
}

export class FakeHost implements ControllerHost {
  readonly sdk = new FakeSdk();
  readonly files: Map<string, string>;
  readonly posted: ExtensionToWebview[] = [];
  readonly notifications: { level: string; message: string; actions: string[] }[] = [];
  readonly escalationNotifications: string[] = [];
  readonly contexts = new Map<string, unknown>();
  readonly commands: string[] = [];
  readonly telemetryEvents: TelemetryEvent[] = [];
  readonly logs: string[] = [];
  readonly workspaceState = new MemoryMemento();
  readonly projectStates = new Map<string, 'active' | 'stopped'>();
  notifyAnswer: string | undefined;
  escalationAnswer: string | undefined;
  apiKey: string | undefined;
  trusted: boolean;
  cfg: CrewConfig;
  clock = Date.parse('2026-09-26T10:00:00Z');
  focused = 0;
  readonly clientApp = 'agent-crew-vscode/test';
  readonly log: Logger;
  readonly license: ControllerHost['license'];
  readonly projects: ControllerHost['projects'];
  private readonly runtimeOverride: Partial<RuntimePaths>;

  constructor(options: FakeHostOptions = {}) {
    this.apiKey = 'apiKey' in options ? options.apiKey : 'sk-ant-api03-test-key-0123456789abcdefghij';
    this.trusted = options.trusted ?? true;
    this.cfg = { budgetCapUsd: 20, stackProfile: 'tanstack', autonomy: 'full', briefReviewMinutes: 10, ...options.config };
    this.files = new Map(Object.entries(options.files ?? {}));
    this.runtimeOverride = options.runtime ?? {};
    const push = (level: string) => (m: string) => this.logs.push(`[${level}] ${m}`);
    this.log = { info: push('info'), warn: push('warn'), error: push('error'), debug: push('debug') };
    const entitlements = options.entitlements ?? UNRESTRICTED;
    this.license = {
      entitlements: () => Promise.resolve(entitlements),
      checkStart: () => options.startCheck ?? { allowed: true },
    };
    this.projects = {
      active: () => [...this.projectStates].filter(([, s]) => s === 'active').map(([p]) => p),
      mark: (p, s) => {
        this.projectStates.set(p, s);
        return Promise.resolve();
      },
    };
  }

  workspaceRoot() {
    return '/work/project';
  }
  isTrusted() {
    return this.trusted;
  }
  config() {
    return this.cfg;
  }
  getApiKey() {
    return Promise.resolve(this.apiKey);
  }
  runtime(): RuntimePaths {
    return {
      sdkEntry: '/ext/dist/sdk/sdk.mjs',
      executable: '/ext/dist/bin/claude',
      executableSource: 'bundled',
      pluginPath: '/ext/resources/plugin',
      plugin: { name: 'agent-crew', version: '0.1.0' },
      problems: [],
      ...this.runtimeOverride,
    };
  }
  loadSdk() {
    return Promise.resolve(this.sdk);
  }
  readFile(path: string) {
    return Promise.resolve(this.files.get(path));
  }
  writeFile(path: string, content: string) {
    this.files.set(path, content);
    return Promise.resolve();
  }
  post(message: ExtensionToWebview) {
    this.posted.push(message);
  }
  notify(level: 'info' | 'warn' | 'error', message: string, ...actions: string[]) {
    this.notifications.push({ level, message, actions });
    return Promise.resolve(this.notifyAnswer);
  }
  notifyEscalation(escalation: { id: string }) {
    this.escalationNotifications.push(escalation.id);
    return Promise.resolve(this.escalationAnswer);
  }
  focusChat() {
    this.focused++;
  }
  setContext(key: string, value: unknown) {
    this.contexts.set(key, value);
  }
  telemetry(event: TelemetryEvent) {
    this.telemetryEvents.push(event);
  }
  runCommand(command: string) {
    this.commands.push(command);
  }
  now() {
    return this.clock;
  }
}
