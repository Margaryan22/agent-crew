# Support

## Getting help

- **Bugs and feature requests:** open an issue at <https://github.com/agent-crew/agent-crew-vscode/issues>.
- Please include the Agent Crew version, your editor (VS Code, Cursor, Windsurf) and its version, your OS, and the relevant part of the **Crew** output channel (**Crew: Show Log**). The log never contains your API key, but review it for project details you would rather not share.
- Run **Crew: Check Dependencies** first — it finds most setup problems.

## Common problems

| Symptom | Fix |
| --- | --- |
| "Authentication failed" | Run **Crew: Set API Key** again with a valid Anthropic API key. |
| "No Claude Code executable found" | Install the VSIX built for your platform, or install Claude Code and set `crew.claudeCodePath`. |
| Nothing happens in a new folder | Trust the workspace — Agent Crew does not run in Restricted Mode. |
| The session stopped on its own | The budget cap was reached; raise `crew.budgetCapUsd` and run **Crew: Resume**. |

## Security issues

Please do not open public issues for security problems. Report them privately through GitHub Security Advisories on the repository.
