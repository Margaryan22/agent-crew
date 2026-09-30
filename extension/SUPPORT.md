# Support

## Getting help

- **Bugs and feature requests:** open an issue at <https://github.com/Margaryan22/agent-crew/issues>.
- Include the Agent Crew version, your editor and its version, your OS, the Claude Code version, and the relevant part of the **Agent Crew** output channel (**Agent Crew: Show Log**) — review it for project details you would rather not share.
- Run **Agent Crew: Check Setup** first; it finds most setup problems.

## Common problems

| Symptom | Fix |
| --- | --- |
| "Agent Crew runs inside Claude Code" | Install the Claude Code extension, sign in, then run the command again. |
| Claude Code opens but `/agent-crew:new-project` is unknown | The plugin is not installed or is disabled: **Agent Crew: Install Plugin into Claude Code**, or `/plugin` in Claude Code. |
| The prompt did not appear in Claude Code | The session was already open, so Claude Code kept its input box. The text is on your clipboard — paste it. |
| The crew stopped and waits | Open **Agent Crew → Project → Needs you**, answer, then **Continue in Claude Code**. |
| The database does not start | Start Docker (Docker Desktop or OrbStack). If port 5432 is busy, set `DB_PORT` and the port in `DATABASE_URL` in the project's `.env`. |
| Nothing shows in the Agent Crew view | Trust the workspace — Agent Crew does not run in Restricted Mode. |

## Security issues

Please do not open public issues for security problems. Report them privately through GitHub Security Advisories on the repository.
