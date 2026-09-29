# Agent Crew

A crew of AI agents — PM, critic, architect, QA, frontend, backend, DB and security — that turns an idea for a small-business tool into a working, tested project. The crew runs inside your own AI assistant on your own subscription: Claude Code today, ChatGPT's Codex next.

> **Status: in development.** The plugin commands are placeholders until step 5 of [PLAN.md](PLAN.md).

## Repository

| Path | What it is |
| --- | --- |
| [`plugins/agent-crew/`](plugins/agent-crew) | The plugin: agents, skills, hooks. Installed into Claude Code from this repository's marketplace. |
| [`crew-contract/`](crew-contract) | The `.crew/` file format shared by the plugin and the extension: Zod schemas, readers, writers, tests. |
| [`extension/`](extension) | The **Agent Crew** VS Code extension (publisher `whysargis`): setup, launch and progress of the crew. |
| `evals/` | Eval ideas, hidden acceptance tests and the runner (step 6). |
| [`SPEC.md`](SPEC.md), [`PLAN.md`](PLAN.md), [`NOTES.md`](NOTES.md) | Spec, plan and implementation log. |

## Install the plugin (Claude Code)

```text
/plugin marketplace add Margaryan22/agent-crew
/plugin install agent-crew@agent-crew
```

or from a shell:

```bash
claude plugin marketplace add Margaryan22/agent-crew
claude plugin install agent-crew@agent-crew
```

Requires Claude Code 2.1.271 or later. Commands: `/agent-crew:new-project <idea>`, `/agent-crew:feature <description>`, `/agent-crew:status`.

## Develop

```bash
npm ci --prefix crew-contract && npm test --prefix crew-contract   # contract tests
npm run build --prefix crew-contract                               # regenerate plugins/agent-crew/lib and schemas
claude plugin validate . --strict && claude plugin validate plugins/agent-crew --strict
claude --plugin-dir plugins/agent-crew                             # try the plugin locally
```
