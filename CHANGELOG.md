# Changelog

Versions with an odd minor (`0.1.x`, `0.3.x`) are pre-releases; even minors (`0.2.x`, `0.4.x`) are releases.

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
