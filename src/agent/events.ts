// Maps raw Agent SDK messages to the small set of typed events the UI understands.
// Stateful: remembers which subagent owns which tool_use id so nested output is attributed
// to the right agent.

import type { SDKMessage } from '@anthropic-ai/claude-agent-sdk';
import type { AgentRunStatus } from '../shared/protocol';

export const LEAD_AGENT = 'lead';

export type UiEvent =
  | {
      kind: 'init';
      sessionId: string;
      model: string;
      apiKeySource: string;
      plugins: { name: string; version?: string }[];
      pluginErrors: string[];
      commands: string[];
    }
  | { kind: 'text'; agent: string; model?: string; text: string; subagent: boolean }
  | { kind: 'tool'; agent: string; tool: string; detail: string; toolUseId: string }
  | { kind: 'agent'; taskId: string; agent: string; status: AgentRunStatus; description?: string; summary?: string }
  | {
      kind: 'result';
      ok: boolean;
      subtype: string;
      text?: string;
      totalCostUsd: number;
      durationMs: number;
      numTurns: number;
      errors: string[];
      sessionId: string;
      budgetExceeded: boolean;
    }
  | { kind: 'retry'; attempt: number; maxRetries: number; delayMs: number; error: string }
  | { kind: 'error'; code: string; message: string }
  | { kind: 'compacting'; active: boolean }
  | { kind: 'notice'; text: string }
  | { kind: 'denied'; tool: string; message: string };

type ContentBlock = { type: string; [key: string]: unknown };

const DETAIL_MAX = 160;

function oneLine(text: string, max = DETAIL_MAX): string {
  const s = text.replace(/\s+/g, ' ').trim();
  return s.length > max ? `${s.slice(0, max - 1)}…` : s;
}

function asString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() !== '' ? value : undefined;
}

/** Short human-readable description of a tool call, without dumping file contents. */
export function describeToolUse(tool: string, input: unknown, cwd?: string): string {
  const i = (typeof input === 'object' && input !== null ? input : {}) as Record<string, unknown>;
  const rel = (p: string | undefined) => {
    if (!p) return '';
    if (cwd && p.startsWith(cwd)) return p.slice(cwd.length).replace(/^[\\/]+/, '') || p;
    return p;
  };
  switch (tool) {
    case 'Bash':
      return oneLine(asString(i.description) ?? asString(i.command) ?? '');
    case 'Read':
    case 'Write':
    case 'Edit':
    case 'MultiEdit':
    case 'NotebookEdit':
      return rel(asString(i.file_path) ?? asString(i.notebook_path));
    case 'Glob':
    case 'Grep':
      return oneLine(`${asString(i.pattern) ?? ''}${asString(i.path) ? ` in ${rel(asString(i.path))}` : ''}`);
    case 'Agent':
    case 'Task':
      return oneLine(`${asString(i.subagent_type) ?? 'agent'}: ${asString(i.description) ?? ''}`);
    case 'WebFetch':
      return oneLine(asString(i.url) ?? '');
    case 'WebSearch':
      return oneLine(asString(i.query) ?? '');
    case 'Skill':
      return oneLine(asString(i.skill) ?? asString(i.command) ?? '');
    case 'TodoWrite':
      return Array.isArray(i.todos) ? `${i.todos.length} todos` : '';
    default:
      return '';
  }
}

export class EventMapper {
  /** tool_use id of an Agent/Task call → subagent type */
  private readonly subagentByToolUse = new Map<string, string>();
  /** task id → agent name */
  private readonly agentByTask = new Map<string, string>();
  private cwd: string | undefined;

  constructor(private readonly leadName: string = LEAD_AGENT) {}

  map(message: SDKMessage): UiEvent[] {
    switch (message.type) {
      case 'system':
        return this.mapSystem(message);
      case 'assistant':
        return this.mapAssistant(message);
      case 'result':
        return this.mapResult(message);
      default:
        return [];
    }
  }

  agentForTask(taskId: string): string | undefined {
    return this.agentByTask.get(taskId);
  }

  private agentFor(parentToolUseId: string | null | undefined, subagentType?: string): string {
    if (subagentType) return subagentType;
    if (!parentToolUseId) return this.leadName;
    return this.subagentByToolUse.get(parentToolUseId) ?? 'subagent';
  }

  private mapSystem(message: Extract<SDKMessage, { type: 'system' }>): UiEvent[] {
    switch (message.subtype) {
      case 'init': {
        this.cwd = message.cwd;
        return [
          {
            kind: 'init',
            sessionId: message.session_id,
            model: message.model,
            apiKeySource: message.apiKeySource,
            plugins: (message.plugins ?? []).map((p) => (p.version ? { name: p.name, version: p.version } : { name: p.name })),
            pluginErrors: (message.plugin_errors ?? []).map((e) => `${e.plugin}: ${e.message}`),
            commands: message.slash_commands ?? [],
          },
        ];
      }
      case 'task_started': {
        const agent = message.subagent_type ?? (message.tool_use_id ? this.subagentByToolUse.get(message.tool_use_id) : undefined) ?? 'subagent';
        if (message.skip_transcript || message.ambient) return [];
        this.agentByTask.set(message.task_id, agent);
        if (message.tool_use_id) this.subagentByToolUse.set(message.tool_use_id, agent);
        return [{ kind: 'agent', taskId: message.task_id, agent, status: 'running', description: message.description }];
      }
      case 'task_progress': {
        const agent = this.agentByTask.get(message.task_id);
        if (!agent) return [];
        const event: UiEvent = { kind: 'agent', taskId: message.task_id, agent, status: 'running', description: message.description };
        if (message.summary) event.summary = message.summary;
        return [event];
      }
      case 'task_notification': {
        const agent = this.agentByTask.get(message.task_id);
        if (!agent) return [];
        return [{ kind: 'agent', taskId: message.task_id, agent, status: message.status, summary: message.summary }];
      }
      case 'task_updated': {
        const agent = this.agentByTask.get(message.task_id);
        const status = message.patch.status;
        if (!agent || !status) return [];
        const mapped: AgentRunStatus | undefined =
          status === 'completed' ? 'completed' : status === 'failed' ? 'failed' : status === 'killed' ? 'stopped' : status === 'running' ? 'running' : undefined;
        return mapped ? [{ kind: 'agent', taskId: message.task_id, agent, status: mapped }] : [];
      }
      case 'api_retry':
        return [{ kind: 'retry', attempt: message.attempt, maxRetries: message.max_retries, delayMs: message.retry_delay_ms, error: message.error }];
      case 'status':
        return [{ kind: 'compacting', active: message.status === 'compacting' }];
      case 'notification':
        return message.priority === 'low' ? [] : [{ kind: 'notice', text: message.text }];
      case 'permission_denied':
        return [{ kind: 'denied', tool: message.tool_name, message: message.message }];
      default:
        return [];
    }
  }

  private mapAssistant(message: Extract<SDKMessage, { type: 'assistant' }>): UiEvent[] {
    const agent = this.agentFor(message.parent_tool_use_id, message.subagent_type);
    const model = message.message.model;
    const events: UiEvent[] = [];
    const content = (Array.isArray(message.message.content) ? message.message.content : []) as unknown as ContentBlock[];

    for (const block of content) {
      if (block.type === 'text' && typeof block.text === 'string' && block.text.trim() !== '') {
        const event: UiEvent = { kind: 'text', agent, text: block.text, subagent: message.parent_tool_use_id !== null };
        if (model) event.model = model;
        events.push(event);
      } else if (block.type === 'tool_use' && typeof block.name === 'string' && typeof block.id === 'string') {
        if ((block.name === 'Agent' || block.name === 'Task') && typeof block.input === 'object' && block.input !== null) {
          const type = asString((block.input as Record<string, unknown>).subagent_type);
          if (type) this.subagentByToolUse.set(block.id, type);
        }
        events.push({ kind: 'tool', agent, tool: block.name, detail: describeToolUse(block.name, block.input, this.cwd), toolUseId: block.id });
      }
    }
    if (message.error && message.parent_tool_use_id === null) {
      const text = content.find((b) => b.type === 'text' && typeof b.text === 'string')?.text;
      events.push({ kind: 'error', code: message.error, message: typeof text === 'string' ? text : message.error });
      return events.filter((e) => e.kind !== 'text');
    }
    return events;
  }

  private mapResult(message: Extract<SDKMessage, { type: 'result' }>): UiEvent[] {
    const ok = message.subtype === 'success' && !message.is_error;
    const event: UiEvent = {
      kind: 'result',
      ok,
      subtype: message.subtype,
      totalCostUsd: message.total_cost_usd ?? 0,
      durationMs: message.duration_ms ?? 0,
      numTurns: message.num_turns ?? 0,
      errors: message.subtype === 'success' ? [] : [...(message.errors ?? [])],
      sessionId: message.session_id,
      budgetExceeded: message.subtype === 'error_max_budget_usd',
    };
    if (message.subtype === 'success' && message.result) event.text = message.result;
    return [event];
  }
}
