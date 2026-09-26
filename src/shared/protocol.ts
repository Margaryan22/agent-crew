// Typed message protocol between the extension host and the chat webview.
// Shared by both bundles; everything crossing the boundary is validated on receipt.

export type AgentRunStatus = 'running' | 'completed' | 'failed' | 'stopped';

export type ChatEntry =
  | { id: string; type: 'user'; text: string }
  | { id: string; type: 'agent'; agent: string; model?: string; text: string }
  | { id: string; type: 'tool'; agent: string; tool: string; detail: string }
  | { id: string; type: 'agentStatus'; agent: string; status: AgentRunStatus; description?: string; summary?: string }
  | {
      id: string;
      type: 'escalation';
      escalationId: string;
      title: string;
      question: string;
      options: string[];
      kind: 'question' | 'permission' | 'brief-review';
      status: 'open' | 'answered' | 'cancelled';
      answer?: string;
      /** Epoch ms when an unanswered brief review continues automatically. */
      autoContinueAt?: number;
    }
  | { id: string; type: 'result'; ok: boolean; text?: string; costUsd: number; durationMs: number }
  | { id: string; type: 'system'; level: 'info' | 'warn' | 'error'; text: string };

export type SessionPhase = 'idle' | 'starting' | 'running' | 'waiting' | 'stopped';

export interface ChatState {
  phase: SessionPhase;
  activeAgent?: string;
  spentUsd: number;
  capUsd: number;
  hasApiKey: boolean;
  canResume: boolean;
  /** Agents with a live run, for the status strip. */
  agents: { name: string; model?: string; status: AgentRunStatus }[];
}

export type ExtensionToWebview =
  | { type: 'init'; entries: ChatEntry[]; state: ChatState }
  | { type: 'append'; entry: ChatEntry }
  | { type: 'update'; entry: ChatEntry }
  | { type: 'state'; state: ChatState }
  | { type: 'clear' };

export type WebviewCommand = 'newProject' | 'feature' | 'status' | 'resume' | 'setApiKey' | 'openBrief' | 'showLog';

export type WebviewToExtension =
  | { type: 'ready' }
  | { type: 'send'; text: string }
  | { type: 'stop' }
  | { type: 'answer'; escalationId: string; answer: string }
  | { type: 'command'; command: WebviewCommand };

export const MAX_MESSAGE_LENGTH = 20_000;
const COMMANDS: readonly WebviewCommand[] = ['newProject', 'feature', 'status', 'resume', 'setApiKey', 'openBrief', 'showLog'];
const ESCALATION_ID = /^[A-Za-z0-9][\w.-]{0,63}$/;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function boundedString(value: unknown, max = MAX_MESSAGE_LENGTH): value is string {
  return typeof value === 'string' && value.length <= max;
}

/** Validates an untrusted message from the webview. Returns undefined for anything malformed. */
export function parseWebviewMessage(raw: unknown): WebviewToExtension | undefined {
  if (!isRecord(raw) || typeof raw.type !== 'string') return undefined;
  switch (raw.type) {
    case 'ready':
      return { type: 'ready' };
    case 'stop':
      return { type: 'stop' };
    case 'send':
      if (!boundedString(raw.text) || raw.text.trim() === '') return undefined;
      return { type: 'send', text: raw.text };
    case 'answer':
      if (!boundedString(raw.escalationId, 64) || !ESCALATION_ID.test(raw.escalationId)) return undefined;
      if (!boundedString(raw.answer) || raw.answer.trim() === '') return undefined;
      return { type: 'answer', escalationId: raw.escalationId, answer: raw.answer };
    case 'command':
      if (typeof raw.command !== 'string' || !COMMANDS.includes(raw.command as WebviewCommand)) return undefined;
      return { type: 'command', command: raw.command as WebviewCommand };
    default:
      return undefined;
  }
}

/** Validates a message from the extension host (defensive: the webview trusts nothing it did not check). */
export function parseExtensionMessage(raw: unknown): ExtensionToWebview | undefined {
  if (!isRecord(raw) || typeof raw.type !== 'string') return undefined;
  switch (raw.type) {
    case 'init':
      return Array.isArray(raw.entries) && isRecord(raw.state) ? (raw as unknown as ExtensionToWebview) : undefined;
    case 'append':
    case 'update':
      return isRecord(raw.entry) && typeof raw.entry.id === 'string' && typeof raw.entry.type === 'string'
        ? (raw as unknown as ExtensionToWebview)
        : undefined;
    case 'state':
      return isRecord(raw.state) ? (raw as unknown as ExtensionToWebview) : undefined;
    case 'clear':
      return { type: 'clear' };
    default:
      return undefined;
  }
}
