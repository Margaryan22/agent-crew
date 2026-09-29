import type { WebviewToExtension } from '../../src/shared/protocol';

interface VsCodeApi {
  postMessage(message: WebviewToExtension): void;
  getState(): unknown;
  setState(state: unknown): void;
}

declare function acquireVsCodeApi(): VsCodeApi;

const api: VsCodeApi =
  typeof acquireVsCodeApi === 'function'
    ? acquireVsCodeApi()
    : { postMessage: () => undefined, getState: () => undefined, setState: () => undefined };

export function send(message: WebviewToExtension): void {
  api.postMessage(message);
}

export function loadDraft(): string {
  const state = api.getState();
  return typeof state === 'object' && state !== null && typeof (state as { draft?: unknown }).draft === 'string' ? (state as { draft: string }).draft : '';
}

export function saveDraft(draft: string): void {
  api.setState({ draft });
}
