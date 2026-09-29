// Thin wrapper over the Claude Agent SDK: one streaming-input query per session, with
// start / send / interrupt / close and resume by session id. The SDK module is injected so
// the wrapper runs against a fake in tests.

import type { CanUseTool, Options, Query, SDKMessage, SDKUserMessage } from '@anthropic-ai/claude-agent-sdk';
import type { Logger } from '../redact';

export interface SdkModule {
  query(params: { prompt: string | AsyncIterable<SDKUserMessage>; options?: Options }): Query;
}

export interface SessionConfig {
  cwd: string;
  pluginPath: string;
  /** Explicit Claude Code executable; the SDK cannot locate its binary from inside the bundle. */
  executablePath: string;
  apiKey: string;
  /** Remaining budget for this query() call (SDK `maxBudgetUsd`). */
  maxBudgetUsd?: number;
  resumeSessionId?: string;
  /** CREW_* variables the plugin can read (autonomy, stack profile, budget…). */
  crewEnv: Record<string, string>;
  canUseTool: CanUseTool;
  clientApp: string;
}

export type SessionState = 'starting' | 'running' | 'idle' | 'closed';

/**
 * Environment for the Claude Code process. Inherited Claude Code variables (CLAUDECODE,
 * CLAUDE_CODE_*) are dropped: when VS Code is started from a Claude Code terminal they make the
 * child ignore ANTHROPIC_API_KEY. Competing credentials are dropped so the key from
 * SecretStorage is the only one in play.
 */
export function buildSessionEnv(base: Record<string, string | undefined>, apiKey: string, extra: Record<string, string>): Record<string, string | undefined> {
  const env: Record<string, string | undefined> = {};
  const drop = /^(CLAUDECODE$|CLAUDE_CODE_|CLAUDE_AGENT_SDK_|CLAUDE_EFFORT$|CLAUDE_PID$|ANTHROPIC_API_KEY$|ANTHROPIC_AUTH_TOKEN$|CREW_)/;
  for (const [key, value] of Object.entries(base)) {
    if (!drop.test(key)) env[key] = value;
  }
  return { ...env, ...extra, ANTHROPIC_API_KEY: apiKey };
}

/** Async queue feeding user messages into the SDK's streaming input. */
export class MessageQueue implements AsyncIterable<SDKUserMessage> {
  private readonly buffer: SDKUserMessage[] = [];
  private waiter: ((result: IteratorResult<SDKUserMessage>) => void) | undefined;
  private closed = false;

  push(text: string): void {
    if (this.closed) throw new Error('Session input is closed');
    const message: SDKUserMessage = {
      type: 'user',
      message: { role: 'user', content: text },
      parent_tool_use_id: null,
      origin: { kind: 'human' },
    };
    if (this.waiter) {
      const resolve = this.waiter;
      this.waiter = undefined;
      resolve({ value: message, done: false });
    } else {
      this.buffer.push(message);
    }
  }

  close(): void {
    this.closed = true;
    if (this.waiter) {
      const resolve = this.waiter;
      this.waiter = undefined;
      resolve({ value: undefined, done: true });
    }
  }

  get isClosed(): boolean {
    return this.closed;
  }

  [Symbol.asyncIterator](): AsyncIterator<SDKUserMessage> {
    return {
      next: () => {
        const next = this.buffer.shift();
        if (next) return Promise.resolve({ value: next, done: false });
        if (this.closed) return Promise.resolve({ value: undefined, done: true });
        return new Promise((resolve) => {
          this.waiter = resolve;
        });
      },
      return: () => {
        this.close();
        return Promise.resolve({ value: undefined, done: true });
      },
    };
  }
}

export interface SessionExit {
  error?: Error;
  aborted: boolean;
}

export class CrewSession {
  private readonly input = new MessageQueue();
  private readonly abort = new AbortController();
  private query: Query | undefined;
  private readonly messageListeners = new Set<(message: SDKMessage) => void>();
  private readonly exitListeners = new Set<(exit: SessionExit) => void>();
  private usageSupported = true;
  private _state: SessionState = 'starting';
  private _sessionId: string | undefined;

  constructor(
    private readonly sdk: SdkModule,
    private readonly config: SessionConfig,
    private readonly log: Logger,
  ) {
    this._sessionId = config.resumeSessionId;
  }

  get state(): SessionState {
    return this._state;
  }

  get sessionId(): string | undefined {
    return this._sessionId;
  }

  onMessage(listener: (message: SDKMessage) => void): () => void {
    this.messageListeners.add(listener);
    return () => this.messageListeners.delete(listener);
  }

  onExit(listener: (exit: SessionExit) => void): () => void {
    this.exitListeners.add(listener);
    return () => this.exitListeners.delete(listener);
  }

  buildOptions(): Options {
    const c = this.config;
    const options: Options = {
      cwd: c.cwd,
      abortController: this.abort,
      pathToClaudeCodeExecutable: c.executablePath,
      plugins: [{ type: 'local', path: c.pluginPath }],
      // Project settings (CLAUDE.md, .claude/settings.json) apply; the user's global Claude Code
      // settings do not, so the plugin's hooks are the permission policy.
      settingSources: ['project', 'local'],
      systemPrompt: { type: 'preset', preset: 'claude_code' },
      permissionMode: 'default',
      canUseTool: c.canUseTool,
      forwardSubagentText: true,
      persistSession: true,
      env: buildSessionEnv(process.env, c.apiKey, { ...c.crewEnv, CLAUDE_AGENT_SDK_CLIENT_APP: c.clientApp }),
      stderr: (data: string) => this.log.debug(`[claude] ${data.trimEnd()}`),
    };
    if (c.maxBudgetUsd !== undefined) options.maxBudgetUsd = Math.max(c.maxBudgetUsd, 0.01);
    if (c.resumeSessionId) options.resume = c.resumeSessionId;
    return options;
  }

  /** Starts the query and sends the first prompt. */
  start(prompt: string): void {
    if (this.query) throw new Error('Session already started');
    this.log.info(`Starting session${this.config.resumeSessionId ? ` (resume ${this.config.resumeSessionId})` : ''} in ${this.config.cwd}`);
    this.query = this.sdk.query({ prompt: this.input, options: this.buildOptions() });
    this.send(prompt);
    void this.consume(this.query);
  }

  send(text: string): void {
    if (this._state === 'closed') throw new Error('Session is closed');
    this.input.push(text);
    this._state = 'running';
  }

  async interrupt(): Promise<void> {
    if (!this.query || this._state === 'closed') return;
    try {
      await this.query.interrupt();
    } catch (err) {
      this.log.warn(`Interrupt failed: ${String(err)}`);
    }
  }

  /** Running cost of the session while a turn is in flight (experimental SDK API; undefined when unavailable). */
  async liveCostUsd(): Promise<number | undefined> {
    if (!this.query || !this.usageSupported || this._state === 'closed') return undefined;
    try {
      const usage = await this.query.usage_EXPERIMENTAL_MAY_CHANGE_DO_NOT_RELY_ON_THIS_API_YET({ skipBehaviors: true });
      return usage.session.total_cost_usd;
    } catch (err) {
      this.usageSupported = false;
      this.log.debug(`Live usage unavailable: ${String(err)}`);
      return undefined;
    }
  }

  close(reason: string): void {
    if (this._state === 'closed') return;
    this.log.info(`Closing session: ${reason}`);
    this._state = 'closed';
    this.input.close();
    try {
      this.query?.close();
    } catch (err) {
      this.log.debug(`query.close failed: ${String(err)}`);
    }
    this.abort.abort();
  }

  private async consume(query: Query): Promise<void> {
    let exit: SessionExit = { aborted: false };
    try {
      for await (const message of query) {
        if (message.type === 'system' && message.subtype === 'init') this._sessionId = message.session_id;
        if (message.type === 'result') {
          this._sessionId = message.session_id;
          if (this._state !== 'closed') this._state = 'idle';
        }
        for (const listener of this.messageListeners) {
          try {
            listener(message);
          } catch (err) {
            this.log.error(`Message listener failed: ${String(err)}`);
          }
        }
      }
    } catch (err) {
      const aborted = this.abort.signal.aborted;
      exit = aborted ? { aborted: true } : { aborted: false, error: err instanceof Error ? err : new Error(String(err)) };
      if (!aborted) this.log.error(`Session failed: ${String(err)}`);
    } finally {
      if (this.abort.signal.aborted) exit.aborted = true;
      this._state = 'closed';
      this.input.close();
      for (const listener of this.exitListeners) listener(exit);
    }
  }
}
