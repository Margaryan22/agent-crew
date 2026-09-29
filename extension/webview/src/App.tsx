import { useEffect, useLayoutEffect, useReducer, useRef, useState } from 'react';
import { type ChatEntry, type ChatState, parseExtensionMessage } from '../../src/shared/protocol';
import { loadDraft, saveDraft, send } from './vscode';

interface Model {
  entries: ChatEntry[];
  state: ChatState;
}

const INITIAL: Model = {
  entries: [],
  state: { phase: 'idle', spentUsd: 0, capUsd: 0, hasApiKey: true, canResume: false, agents: [] },
};

type Action = { type: 'message'; data: unknown };

function reducer(model: Model, action: Action): Model {
  const message = parseExtensionMessage(action.data);
  if (!message) return model;
  switch (message.type) {
    case 'init':
      return { entries: message.entries, state: message.state };
    case 'append':
      return { ...model, entries: [...model.entries, message.entry] };
    case 'update':
      return { ...model, entries: model.entries.map((e) => (e.id === message.entry.id ? message.entry : e)) };
    case 'state':
      return { ...model, state: message.state };
    case 'clear':
      return { ...model, entries: [] };
  }
}

const AGENT_COLORS = ['--vscode-charts-blue', '--vscode-charts-purple', '--vscode-charts-green', '--vscode-charts-orange', '--vscode-charts-yellow', '--vscode-charts-red'];

function agentColor(name: string): string {
  let hash = 0;
  for (const ch of name) hash = (hash * 31 + ch.charCodeAt(0)) | 0;
  return `var(${AGENT_COLORS[Math.abs(hash) % AGENT_COLORS.length]})`;
}

function usd(value: number): string {
  return `$${value < 10 ? value.toFixed(2) : value.toFixed(1)}`;
}

function duration(ms: number): string {
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  return m < 60 ? `${m}m ${s % 60}s` : `${Math.floor(m / 60)}h ${m % 60}m`;
}

function shortModel(model: string | undefined): string | undefined {
  return model?.replace(/^claude-/, '').replace(/-\d{8}$/, '');
}

export function App() {
  const [model, dispatch] = useReducer(reducer, INITIAL);

  useEffect(() => {
    const onMessage = (event: MessageEvent) => dispatch({ type: 'message', data: event.data });
    window.addEventListener('message', onMessage);
    send({ type: 'ready' });
    return () => window.removeEventListener('message', onMessage);
  }, []);

  const { state, entries } = model;
  const running = state.phase === 'running' || state.phase === 'starting';

  return (
    <div className="app">
      <Header state={state} running={running} />
      <EntryList entries={entries} state={state} />
      <Composer state={state} running={running} />
    </div>
  );
}

function Header({ state, running }: { state: ChatState; running: boolean }) {
  const live = state.agents.filter((a) => a.status === 'running');
  const ratio = state.capUsd > 0 ? state.spentUsd / state.capUsd : 0;
  return (
    <header className="header">
      <div className="header-row">
        <span className={`phase phase-${state.phase}`}>{state.phase}</span>
        <span className={`budget ${ratio >= 1 ? 'over' : ratio >= 0.8 ? 'warn' : ''}`} title="Spent / cap">
          {usd(state.spentUsd)} / {state.capUsd > 0 ? usd(state.capUsd) : 'no cap'}
        </span>
        <span className="spacer" />
        {running && (
          <button className="danger" onClick={() => send({ type: 'stop' })} title="Stop the session">
            Stop
          </button>
        )}
        {!running && state.canResume && (
          <button className="secondary" onClick={() => send({ type: 'command', command: 'resume' })}>
            Resume
          </button>
        )}
      </div>
      {live.length > 0 && (
        <div className="agents">
          {live.map((a) => (
            <span key={a.name} className="agent-chip" style={{ borderColor: agentColor(a.name) }}>
              <span className="dot" style={{ background: agentColor(a.name) }} />
              {a.name}
              {a.model && <span className="muted"> · {shortModel(a.model)}</span>}
            </span>
          ))}
        </div>
      )}
    </header>
  );
}

function EntryList({ entries, state }: { entries: ChatEntry[]; state: ChatState }) {
  const ref = useRef<HTMLDivElement>(null);
  const stick = useRef(true);

  useLayoutEffect(() => {
    const el = ref.current;
    if (el && stick.current) el.scrollTop = el.scrollHeight;
  }, [entries]);

  if (!entries.length) return <Welcome state={state} />;
  return (
    <div
      className="entries"
      ref={ref}
      onScroll={(e) => {
        const el = e.currentTarget;
        stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
      }}
    >
      {entries.map((entry) => (
        <Entry key={entry.id} entry={entry} />
      ))}
    </div>
  );
}

function Welcome({ state }: { state: ChatState }) {
  return (
    <div className="welcome">
      <h2>Agent Crew</h2>
      <p>Describe a product idea below. The crew writes a brief, plans tasks and builds it in this workspace — you only answer escalations.</p>
      <div className="welcome-actions">
        {!state.hasApiKey && <button onClick={() => send({ type: 'command', command: 'setApiKey' })}>Set API Key</button>}
        <button className="secondary" onClick={() => send({ type: 'command', command: 'newProject' })}>
          New Project…
        </button>
        {state.canResume && (
          <button className="secondary" onClick={() => send({ type: 'command', command: 'resume' })}>
            Resume last session
          </button>
        )}
      </div>
      <p className="muted small">Commands: /new-project, /feature, /status</p>
    </div>
  );
}

function Entry({ entry }: { entry: ChatEntry }) {
  switch (entry.type) {
    case 'user':
      return <div className="entry user">{entry.text}</div>;
    case 'agent':
      return (
        <div className="entry agent" style={{ borderLeftColor: agentColor(entry.agent) }}>
          <div className="meta">
            <span className="agent-name" style={{ color: agentColor(entry.agent) }}>
              {entry.agent}
            </span>
            {entry.model && <span className="muted"> · {shortModel(entry.model)}</span>}
          </div>
          <div className="text">{entry.text}</div>
        </div>
      );
    case 'tool':
      return (
        <div className="entry tool" title={entry.detail}>
          <span className="agent-name" style={{ color: agentColor(entry.agent) }}>
            {entry.agent}
          </span>{' '}
          <span className="tool-name">{entry.tool}</span> <span className="muted">{entry.detail}</span>
        </div>
      );
    case 'agentStatus':
      return (
        <div className={`entry agent-status status-${entry.status}`}>
          <span className="agent-name" style={{ color: agentColor(entry.agent) }}>
            {entry.agent}
          </span>{' '}
          {entry.status === 'running' ? 'started' : entry.status}
          {entry.description && <span className="muted"> — {entry.description}</span>}
          {entry.summary && entry.status !== 'running' && <div className="muted small">{entry.summary}</div>}
        </div>
      );
    case 'escalation':
      return <EscalationCard entry={entry} />;
    case 'result':
      return (
        <div className={`entry result ${entry.ok ? 'ok' : 'failed'}`}>
          <div className="result-line">
            {entry.ok ? 'Turn finished' : 'Turn failed'} · {usd(entry.costUsd)} session total · {duration(entry.durationMs)}
          </div>
          {entry.text && <div className="text">{entry.text}</div>}
        </div>
      );
    case 'system':
      return <div className={`entry system ${entry.level}`}>{entry.text}</div>;
  }
}

function Countdown({ until }: { until: number }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  const left = Math.max(0, until - now);
  return <span className="muted small">Continues automatically in {duration(left)}</span>;
}

function EscalationCard({ entry }: { entry: Extract<ChatEntry, { type: 'escalation' }> }) {
  const [text, setText] = useState('');
  const open = entry.status === 'open';
  const answer = (value: string) => {
    if (!value.trim()) return;
    send({ type: 'answer', escalationId: entry.escalationId, answer: value.trim() });
  };
  return (
    <div className={`entry escalation kind-${entry.kind} ${entry.status}`}>
      <div className="esc-title">
        <span className="badge">{entry.kind === 'permission' ? 'Permission' : entry.kind === 'brief-review' ? 'Brief review' : 'Question'}</span> {entry.title}
        <span className="muted small"> · {entry.escalationId}</span>
      </div>
      <div className="text">{entry.question}</div>
      {open ? (
        <>
          <div className="options">
            {entry.options.map((option) => (
              <button key={option} onClick={() => answer(option)}>
                {option}
              </button>
            ))}
            {entry.kind === 'brief-review' && (
              <button className="secondary" onClick={() => send({ type: 'command', command: 'openBrief' })}>
                Open brief
              </button>
            )}
          </div>
          <div className="free-answer">
            <input
              value={text}
              onChange={(e) => setText(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.nativeEvent.isComposing) answer(text);
              }}
              placeholder={entry.options.length ? 'Or type your own answer…' : 'Type your answer…'}
              aria-label={`Answer to ${entry.escalationId}`}
            />
            <button className="secondary" disabled={!text.trim()} onClick={() => answer(text)}>
              Answer
            </button>
          </div>
          {entry.autoContinueAt && <Countdown until={entry.autoContinueAt} />}
        </>
      ) : (
        <div className="esc-answer">{entry.status === 'cancelled' ? 'Cancelled — the session ended.' : `Answered: ${entry.answer ?? ''}`}</div>
      )}
    </div>
  );
}

function Composer({ state, running }: { state: ChatState; running: boolean }) {
  const [draft, setDraft] = useState(loadDraft);
  const submit = () => {
    const text = draft.trim();
    if (!text) return;
    send({ type: 'send', text });
    setDraft('');
    saveDraft('');
  };
  const placeholder = running || state.phase === 'waiting' ? 'Message the crew…  (/feature, /status)' : 'Describe your product idea…  (Enter to send)';
  return (
    <div className="composer">
      <textarea
        value={draft}
        rows={3}
        placeholder={placeholder}
        aria-label="Message"
        onChange={(e) => {
          setDraft(e.target.value);
          saveDraft(e.target.value);
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
            e.preventDefault();
            submit();
          }
        }}
      />
      <div className="composer-actions">
        <button disabled={!draft.trim()} onClick={submit}>
          Send
        </button>
      </div>
    </div>
  );
}
