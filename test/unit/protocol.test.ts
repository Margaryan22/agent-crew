import { describe, expect, it } from 'vitest';
import { MAX_MESSAGE_LENGTH, parseExtensionMessage, parseWebviewMessage } from '../../src/shared/protocol';

describe('parseWebviewMessage', () => {
  it('accepts well-formed messages', () => {
    expect(parseWebviewMessage({ type: 'ready' })).toEqual({ type: 'ready' });
    expect(parseWebviewMessage({ type: 'stop', extra: 1 })).toEqual({ type: 'stop' });
    expect(parseWebviewMessage({ type: 'send', text: 'hello' })).toEqual({ type: 'send', text: 'hello' });
    expect(parseWebviewMessage({ type: 'answer', escalationId: 'E-001', answer: 'Allow' })).toEqual({ type: 'answer', escalationId: 'E-001', answer: 'Allow' });
    expect(parseWebviewMessage({ type: 'command', command: 'newProject' })).toEqual({ type: 'command', command: 'newProject' });
  });

  it('rejects anything malformed or oversized', () => {
    for (const bad of [
      null,
      'ready',
      [],
      { type: 42 },
      { type: 'unknown' },
      { type: 'send' },
      { type: 'send', text: '   ' },
      { type: 'send', text: 'x'.repeat(MAX_MESSAGE_LENGTH + 1) },
      { type: 'answer', escalationId: '../../etc/passwd', answer: 'x' },
      { type: 'answer', escalationId: 'E-1', answer: '' },
      { type: 'answer', escalationId: 5, answer: 'x' },
      { type: 'command', command: 'workbench.action.terminal.new' },
      { type: 'command' },
    ]) {
      expect(parseWebviewMessage(bad)).toBeUndefined();
    }
  });
});

describe('parseExtensionMessage', () => {
  it('validates shapes', () => {
    const state = { phase: 'idle' };
    expect(parseExtensionMessage({ type: 'init', entries: [], state })).toBeDefined();
    expect(parseExtensionMessage({ type: 'init', entries: 'x', state })).toBeUndefined();
    expect(parseExtensionMessage({ type: 'append', entry: { id: 'e1', type: 'user', text: 'x' } })).toBeDefined();
    expect(parseExtensionMessage({ type: 'update', entry: { id: 1 } })).toBeUndefined();
    expect(parseExtensionMessage({ type: 'state', state })).toBeDefined();
    expect(parseExtensionMessage({ type: 'state' })).toBeUndefined();
    expect(parseExtensionMessage({ type: 'clear' })).toEqual({ type: 'clear' });
    expect(parseExtensionMessage({ type: 'nope' })).toBeUndefined();
    expect(parseExtensionMessage(undefined)).toBeUndefined();
  });
});
