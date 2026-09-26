# Agent Crew

Run a crew of Claude agents from your editor. Describe a product idea; the crew writes a brief, plans tasks, builds the code in your workspace and only stops to ask you when it has to. You follow along in a chat, a live task board and a budget meter — no terminal required.

Works in **VS Code**, **Cursor** and **Windsurf** (via Open VSX), locally and in Remote / Codespaces workspaces.

> **Pre-release.** Versions `0.ODD.x` are pre-releases; `0.EVEN.x` are stable.

## Features

- **Chat** — send an idea or a follow-up; see each agent's messages, the model it runs on, its tool calls and whether it is running or done. A **Stop** button ends the session at any time.
- **Escalations** — when the crew needs a decision (a clarifying question, or an action the crew's policy does not cover) you get a notification with up to three answer buttons, and the same question as a card in the chat. Either answer continues the session.
- **Tasks** — the task board from `.crew/tasks/`, grouped into *To do*, *In progress*, *Review*, *Done* and *Blocked*, updated live. Each task shows its assignee and attempts; click to open it, or use **Show Diff** to review what changed.
- **Decisions** — architecture decision records from `.crew/decisions/ADR-*.md`.
- **Budget** — the status bar shows money spent against your cap and the agent currently working. You are warned at 80%; at 100% the session stops and the stop is recorded in `.crew/status.md`.
- **Resume** — sessions survive a window reload: Agent Crew offers to resume an interrupted session, and **Crew: Resume** continues the last one at any time.

## Getting started

1. Install Agent Crew and open a folder (the crew works in the open folder).
2. Follow the **Get started with Agent Crew** walkthrough (*Help → Welcome*), or:
   - run **Crew: Set API Key** and paste an Anthropic API key from [console.anthropic.com](https://console.anthropic.com/settings/keys);
   - run **Crew: Check Dependencies**;
   - run **Crew: New Project** and describe your idea — or **Crew: Start Demo Project** for a small habit tracker.
3. Open the **Crew** view in the Activity Bar to follow along.

### Requirements

- An **Anthropic API key**. You pay Anthropic directly for what the crew uses.
- **git** on your `PATH`.
- A **trusted** workspace. Agents edit files and run commands, so Agent Crew does not run in Restricted Mode.
- Nothing else: the platform builds of Agent Crew bundle the Claude Code runtime that the Claude Agent SDK needs. On a platform without a bundled runtime, install Claude Code and set `crew.claudeCodePath` (or keep `claude` on your `PATH`).

## Commands

| Command | What it does |
| --- | --- |
| Crew: New Project | Start `/new-project` with your idea |
| Crew: Feature | Add a feature to the current project (`/feature`) |
| Crew: Status | Project status in the chat (asks the crew when a session runs; otherwise summarises `.crew/`) |
| Crew: Stop | Stop the running session |
| Crew: Resume | Resume the last session |
| Crew: Set API Key / Clear API Key | Store or remove your Anthropic API key |
| Crew: Open Brief / Open Status | Open `.crew/brief.md` / `.crew/status.md` |
| Crew: Check Dependencies | Verify runtime, plugin, git, trust and key |
| Crew: Show Log | Open the **Crew** output channel |

In the chat you can also type `/new-project …`, `/feature …` and `/status`.

## Settings

| Setting | Default | Description |
| --- | --- | --- |
| `crew.budgetCapUsd` | `20` | Spending cap for the project in USD (all sessions in `.crew/costs.log`). `0` disables the cap. |
| `crew.stackProfile` | `tanstack` | Stack conventions the crew follows. |
| `crew.autonomy` | `full` | `full`: the crew only stops for escalations. `review`: the crew shows you the brief and waits for approval. |
| `crew.briefReviewMinutes` | `10` | In `review` mode, how long to wait for your approval before continuing. |
| `crew.telemetry.enabled` | `true` | Anonymous aggregate usage data (see below). Also requires VS Code telemetry to be on. |
| `crew.claudeCodePath` | *(empty)* | Use a specific Claude Code executable instead of the bundled one. |

## How it works

Agent Crew is a UI for the **agent-crew** Claude Code plugin, which ships inside the extension and holds the agents, skills and hooks. Sessions run on the [Claude Agent SDK](https://code.claude.com/docs/en/agent-sdk/overview) in your workspace.

The project's state lives in your repository, in `.crew/` — tasks, escalations, decisions, the brief, the status and `costs.log`. Agent Crew reads it and shows it; it does not keep a separate copy, so the state travels with your repo and your team.

## Privacy and security

- Your API key is stored in the operating system keychain through VS Code SecretStorage. It is never written to settings or logs and never sent to the chat view.
- Agent Crew runs only in trusted workspaces.
- Tool permissions follow the plugin's policy. Anything the policy does not cover becomes an escalation for you to answer — the crew never gets a blanket approval.
- The chat view uses a strict Content Security Policy and loads only files shipped with the extension.

## Telemetry

When both VS Code telemetry and `crew.telemetry.enabled` are on, Agent Crew records **aggregates only**: session duration, number of tasks and escalations, total cost, how the session ended, and error categories. It never records code, prompts, file names or agent output. VS Code's common telemetry properties are not attached.

This version has no telemetry backend: events are written to the **Crew** output channel (debug level) and do not leave your machine.

## Support

See [SUPPORT.md](SUPPORT.md).
