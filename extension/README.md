# Agent Crew

A crew of AI agents that builds small-business web apps — booking, inventory, orders, simple CRMs — **inside Claude Code, on your own Claude subscription**. Describe the tool you need; the crew interviews you, writes and reviews a brief, designs the architecture, writes acceptance tests first, builds task by task with QA and security review, and hands you a report. It asks you only when it has to.

This extension is the control panel: it sets up the **agent-crew** plugin in Claude Code, starts crew runs, and shows the run live — phase, task board, questions waiting for you, spend.

> **Versions.** Versions `0.ODD.x` are pre-releases; `0.EVEN.x` are stable.

## How it works

- The agents run in **Claude Code**, Anthropic's official extension, where you sign in with your Claude subscription (or an API key). Agent Crew never sees your credentials and never calls a model itself.
- The crew is the open-source **agent-crew** plugin: nine agents (PM, critic, architect, QA, frontend, backend, database, security, context keeper), curated skills, and safety hooks that block unvetted packages, pushes to `main`, secrets in `.env` and deletes outside the project.
- All state lives in your repository, in `.crew/` — brief, tasks, decisions, questions, status, report. This extension reads it; nothing is stored elsewhere.

Generated projects use TanStack Start (React, TypeScript), Drizzle ORM with PostgreSQL, Tailwind, Vitest and Playwright, with sign-in and roles built in.

## Getting started

Follow **Get started with Agent Crew** (*Help → Welcome*), or:

1. **Install Claude Code** (the extension offers it) and sign in.
2. **Agent Crew: Install Plugin into Claude Code** — Claude Code opens its plugin dialog; confirm.
3. **Agent Crew: Check Setup** — Node.js 22+, git and Docker (the project's database runs in Docker).
4. Open an **empty folder**, run **Agent Crew: New Project** and describe your idea in any language. Claude Code opens with the command filled in — press **Enter**, then answer the interview.

## While the crew works

The **Agent Crew** view in the Activity Bar shows:

- **Project** — the phase and a one-line summary; task progress; **Needs you** (questions from the crew — click to answer — and access the crew needs, like accounts or real data); the estimated spend; the brief, the report and the architecture decisions.
- **Tasks** — the board from `.crew/tasks/`, grouped by blocked / in progress / in review / to do / done, with owner, review stage and retries. **Show Diff** opens a task's changes from its `T-NNN:` commits.
- **Status bar** — phase, tasks done and how many things wait for you.

When you answer a question here, Agent Crew writes it to `.crew/escalations/` and reopens the run's Claude Code session with a short "continue" message for you to send.

## Commands

| Command | What it does |
| --- | --- |
| Agent Crew: New Project | Start `/agent-crew:new-project` with your idea in Claude Code |
| Agent Crew: Add Feature | Start `/agent-crew:feature` for a crew-built project (works on a new git branch) |
| Agent Crew: Fix a Bug or Make a Small Change | Start `/agent-crew:fix`: a test that shows the problem, the fix, one review |
| Agent Crew: Prepare Deployment | Start `/agent-crew:deploy`: hosting decision, deployment files and a step-by-step guide; publishing stays with you |
| Agent Crew: Continue in Claude Code | Reopen the Claude Code session of the current run |
| Agent Crew: Answer the Crew's Question | Answer an open question from the crew |
| Agent Crew: Show Status | Open the Agent Crew view |
| Agent Crew: Install Claude Code / Install Plugin into Claude Code | One-time setup |
| Agent Crew: Check Setup | Check Claude Code, the plugin, Node.js, git and Docker |
| Agent Crew: Open Brief / Open Report / Open Status File / Open Access Checklist | Open the crew's documents |
| Agent Crew: Show Log | Open the **Agent Crew** output channel |

The crew's own settings — stack (`auto` by default: the crew picks or detects it), autonomy (`full` or `review`), and an optional spending cap for pay-per-use sessions — live in Claude Code: `/plugin` → agent-crew → Configure.

## Requirements

- **Claude Code** extension, signed in (Claude Pro or Max, or an API key). On a subscription the crew uses your plan's limits; the spend shown here is the plugin's estimate at API list prices.
- **Node.js 22+**, **git** and **Docker** for the generated project.
- A **trusted** workspace — the crew edits files and runs commands.
- VS Code 1.94 or newer, or Cursor / Windsurf / VSCodium (through Open VSX) with Claude Code installed.

## Privacy

Agent Crew has no telemetry, no account and no backend. It reads `.crew/` in your workspace, writes your answers to `.crew/escalations/`, and asks Claude Code to open sessions. Your code and prompts go only where Claude Code sends them.

## Support

See [SUPPORT.md](SUPPORT.md). The plugin, this extension and their tests are at <https://github.com/Margaryan22/agent-crew>.

## License

[MIT](LICENSE).
