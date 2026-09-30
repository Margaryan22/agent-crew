# Changelog

Versions with an odd minor (`0.1.x`, `0.3.x`) are pre-releases; even minors (`0.2.x`, `0.4.x`) are releases.

## 0.3.0 — pre-release

Agent Crew is now a control panel for the **agent-crew** plugin running in **Claude Code**, on the user's own Claude subscription (Anthropic does not allow third-party apps to sign in with Claude subscriptions).

- Removed: the built-in Agent SDK engine, the chat view, API-key storage, the bundled Claude Code runtime and the platform builds (the VSIX is universal, ~120 KB), the license module and local telemetry.
- New: **Project** view (phase, progress, questions and access the crew needs, spend, brief, report, decisions), **Tasks** board built on the shared `.crew/` contract, answering the crew's questions from VS Code, **Continue in Claude Code**, one-click setup of Claude Code and the plugin, **Check Setup** for Node.js, git and Docker, a new walkthrough.
- **Show Diff** follows the crew's `T-NNN:` commits.
- Requires VS Code 1.94 (the same as Claude Code).

## 0.1.0 — pre-release

First pre-release.

- Chat view: ideas and follow-ups, per-agent messages with model and status, Stop button.
- Escalations from agent questions, uncovered tool permissions and plugin-written `.crew/escalations/` files — answered from notifications or the chat.
- Tasks tree grouped by status with live updates, Show Diff, and a Decisions tree for ADRs.
- Status bar budget meter with an 80% warning and a hard stop at the cap (`crew.budgetCapUsd`), costs recorded in `.crew/costs.log`.
- Session resume after a window reload.
- API key in SecretStorage; workspace trust required; strict webview CSP.
- Getting-started walkthrough.
- Platform-specific builds bundling the Claude Code runtime.
