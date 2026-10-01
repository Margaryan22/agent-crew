# The Agent Crew plugin

The plugin adds the crew to Claude Code:

- ten agents — PM, critic, architect, designer, QA, frontend, backend, database, security, context keeper;
- skills for briefs, reviews, tests, design and git, and rules the architect writes for your project's own stack;
- safety hooks — no installs of unvetted packages, no pushes to `main`, no secrets in `.env`, no deletes outside the project;
- the commands `/agent-crew:new-project`, `/agent-crew:feature`, `/agent-crew:fix`, `/agent-crew:continue`, `/agent-crew:deploy`, `/agent-crew:status`.

**Install Plugin** opens Claude Code's plugin dialog for `agent-crew` from `github.com/Margaryan22/agent-crew`; confirm there. In a terminal the same is:

```
claude plugin marketplace add Margaryan22/agent-crew
claude plugin install agent-crew@agent-crew
```
