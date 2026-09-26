// Escalations: questions the crew cannot settle on its own. They come from three places —
// files the plugin writes to .crew/escalations/, AskUserQuestion calls, and tool permission
// requests the plugin's hook policy did not cover. Whatever the source, an answer from the chat
// and an answer from a notification go through `answer()`, which records it in the escalation
// file and hands it back to the session.

import type { Logger } from '../redact';
import type { Escalation, EscalationKind } from './model';
import { CREW_PATHS } from './model';
import { applyEscalationAnswer, nextEscalationId, renderEscalationFile, setFrontmatterFields, truncate } from './parser';

export interface EscalationRequest {
  kind: EscalationKind;
  title: string;
  question: string;
  options: string[];
  agent?: string;
  task?: string;
}

export interface EscalationDeps {
  readFile(path: string): Promise<string | undefined>;
  writeFile(path: string, content: string): Promise<void>;
  /** Sends a message into the running session; false when no session is running. */
  sendToSession(text: string): boolean;
  autonomy(): 'full' | 'review';
  briefReviewMs(): number;
  now(): Date;
  log: Logger;
}

export interface LiveEscalation extends Escalation {
  /** Epoch ms when an unanswered brief review continues automatically. */
  autoContinueAt?: number;
}

export type AnswerOutcome = 'delivered' | 'recorded' | 'unknown' | 'closed';

export class EscalationCancelled extends Error {
  constructor(reason: string) {
    super(reason);
    this.name = 'EscalationCancelled';
  }
}

export const BRIEF_APPROVE = 'Approve';

interface Pending {
  resolve(answer: string): void;
  reject(err: Error): void;
}

type Listener = (escalation: LiveEscalation) => void;

export class EscalationService {
  private readonly known = new Map<string, LiveEscalation>();
  private readonly pending = new Map<string, Pending>();
  private readonly timers = new Map<string, ReturnType<typeof setTimeout>>();
  private readonly raisedListeners = new Set<Listener>();
  private readonly changedListeners = new Set<Listener>();
  private reserved = new Set<string>();

  constructor(private readonly deps: EscalationDeps) {}

  /** Fired once per escalation that needs a human: show it in the chat and notify. */
  onRaised(listener: Listener): () => void {
    this.raisedListeners.add(listener);
    return () => this.raisedListeners.delete(listener);
  }

  /** Fired when an escalation is answered or cancelled. */
  onChanged(listener: Listener): () => void {
    this.changedListeners.add(listener);
    return () => this.changedListeners.delete(listener);
  }

  get(id: string): LiveEscalation | undefined {
    return this.known.get(id);
  }

  open(): LiveEscalation[] {
    return [...this.known.values()].filter((e) => e.status === 'open');
  }

  /**
   * Raises an escalation from inside the session (AskUserQuestion / permission request) and
   * waits for the human. Rejects with EscalationCancelled when the session goes away.
   */
  async raise(request: EscalationRequest, signal?: AbortSignal): Promise<string> {
    const id = await this.allocateId();
    const escalation: LiveEscalation = {
      id,
      title: request.title,
      question: request.question,
      options: request.options,
      kind: request.kind,
      status: 'open',
      createdAt: this.deps.now().toISOString(),
      path: `${CREW_PATHS.escalations}/${id}.md`,
    };
    if (request.agent) escalation.agent = request.agent;
    if (request.task) escalation.task = request.task;

    const answer = new Promise<string>((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
    });
    this.known.set(id, escalation);
    try {
      await this.deps.writeFile(escalation.path!, renderEscalationFile(escalation));
    } catch (err) {
      this.deps.log.warn(`Could not record escalation ${id}: ${String(err)}`);
    }
    if (signal) {
      if (signal.aborted) this.cancel(id, 'Session ended');
      else signal.addEventListener('abort', () => this.cancel(id, 'Session ended'), { once: true });
    }
    this.surface(escalation);
    return answer;
  }

  /** Picks up escalations written by the plugin. Call with every fresh .crew snapshot. */
  syncFromSnapshot(escalations: Escalation[]): void {
    for (const esc of escalations) {
      const current = this.known.get(esc.id);
      if (current) {
        // Keep live state for our own escalations; follow the file for everything else.
        if (!this.pending.has(esc.id) && current.status !== esc.status) {
          const updated = { ...current, ...esc };
          this.known.set(esc.id, updated);
          if (esc.status !== 'open') this.clearTimer(esc.id);
          this.emit(this.changedListeners, updated);
        }
        continue;
      }
      if (this.reserved.has(esc.id)) continue;
      const live: LiveEscalation = { ...esc };
      this.known.set(esc.id, live);
      if (esc.status === 'open') this.surface(live);
    }
  }

  /** Records an answer from the chat or a notification and hands it to the session. */
  async answer(id: string, answer: string, note?: string): Promise<AnswerOutcome> {
    const escalation = this.known.get(id);
    if (!escalation) return 'unknown';
    if (escalation.status !== 'open') return 'closed';
    const text = answer.trim();
    escalation.status = 'answered';
    escalation.answer = note ? `${text} (${note})` : text;
    this.clearTimer(id);

    if (escalation.path) {
      try {
        const current = (await this.deps.readFile(escalation.path)) ?? renderEscalationFile({ ...escalation, status: 'open' });
        await this.deps.writeFile(escalation.path, applyEscalationAnswer(current, escalation.answer, this.deps.now().toISOString()));
      } catch (err) {
        this.deps.log.warn(`Could not write the answer to ${escalation.path}: ${String(err)}`);
      }
    }
    this.emit(this.changedListeners, escalation);

    const pending = this.pending.get(id);
    if (pending) {
      this.pending.delete(id);
      pending.resolve(text);
      return 'delivered';
    }
    const message = `Answer to escalation ${id} (${truncate(escalation.title, 80)}): ${text}\nThe answer is also recorded in ${escalation.path ?? CREW_PATHS.escalations}. Continue the work.`;
    return this.deps.sendToSession(message) ? 'delivered' : 'recorded';
  }

  /** Cancels every escalation still waiting inside a session (the session ended). */
  cancelPending(reason: string): void {
    for (const id of [...this.pending.keys()]) this.cancel(id, reason);
  }

  dispose(): void {
    for (const timer of this.timers.values()) clearTimeout(timer);
    this.timers.clear();
    this.cancelPending('Extension deactivated');
  }

  private cancel(id: string, reason: string): void {
    const pending = this.pending.get(id);
    const escalation = this.known.get(id);
    if (!pending || !escalation || escalation.status !== 'open') return;
    this.pending.delete(id);
    this.clearTimer(id);
    escalation.status = 'cancelled';
    if (escalation.path) {
      const path = escalation.path;
      void this.deps
        .readFile(path)
        .then((text) => (text === undefined ? undefined : this.deps.writeFile(path, setFrontmatterFields(text, { status: 'cancelled' }))))
        .catch((err) => this.deps.log.debug(`Could not mark ${id} cancelled: ${String(err)}`));
    }
    this.emit(this.changedListeners, escalation);
    pending.reject(new EscalationCancelled(reason));
  }

  private surface(escalation: LiveEscalation): void {
    if (escalation.kind === 'brief-review') {
      if (this.deps.autonomy() === 'full') {
        void this.answer(escalation.id, BRIEF_APPROVE, 'autonomy: full');
        return;
      }
      const ms = this.deps.briefReviewMs();
      escalation.autoContinueAt = this.deps.now().getTime() + ms;
      this.timers.set(
        escalation.id,
        setTimeout(() => {
          this.timers.delete(escalation.id);
          void this.answer(escalation.id, BRIEF_APPROVE, `auto-approved after ${Math.round(ms / 60000)} min without a reply`);
        }, ms),
      );
    }
    this.emit(this.raisedListeners, escalation);
  }

  private clearTimer(id: string): void {
    const timer = this.timers.get(id);
    if (timer) clearTimeout(timer);
    this.timers.delete(id);
  }

  private async allocateId(): Promise<string> {
    const taken = new Set([...this.known.keys(), ...this.reserved]);
    for (let attempt = 0; attempt < 20; attempt++) {
      const id = nextEscalationId(taken);
      taken.add(id);
      if ((await this.deps.readFile(`${CREW_PATHS.escalations}/${id}.md`)) === undefined) {
        this.reserved.add(id);
        return id;
      }
    }
    const id = `E-${this.deps.now().getTime()}`;
    this.reserved.add(id);
    return id;
  }

  private emit(listeners: Set<Listener>, escalation: LiveEscalation): void {
    for (const listener of listeners) {
      try {
        listener(escalation);
      } catch (err) {
        this.deps.log.error(`Escalation listener failed: ${String(err)}`);
      }
    }
  }
}
