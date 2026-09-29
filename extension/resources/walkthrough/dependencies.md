# Dependencies

**Crew: Check Dependencies** verifies:

- **Claude Code runtime** — the Claude Agent SDK runs a native Claude Code binary. Platform builds of Agent Crew ship it, so there is nothing to install. On a platform without a bundled binary, install Claude Code (`npm install -g @anthropic-ai/claude-code` or the native installer from code.claude.com) and point `crew.claudeCodePath` at it — or keep `claude` on your `PATH`.
- **agent-crew plugin** — bundled with the extension; it holds the agents, skills and hooks.
- **git** — the crew works in git branches and the task view shows diffs.
- **Workspace trust** — agents edit files and run commands, so Agent Crew only works in trusted folders.
- **API key** — see the previous step.

Details of every check are written to the **Crew** output channel.
