# Agent Crew

A crew of AI agents — PM, critic, architect, QA, frontend, backend, DB and security — that turns an idea for a small-business tool into a working, tested project. The crew runs inside your own AI assistant on your own subscription: Claude Code today, ChatGPT's Codex next.

> **Status: in development.** All parts of the plugin are in place — agents, skills, hooks, commands, the `crew` CLI and the project template — and tested without a model; the VS Code extension is the control panel for it (0.3.0 pre-release). A full run with a real model and the eval harness (step 6 of [PLAN.md](PLAN.md)) are next.

## Repository

| Path | What it is |
| --- | --- |
| [`plugins/agent-crew/`](plugins/agent-crew) | The plugin: agents, skills, hooks. Installed into Claude Code from this repository's marketplace. |
| [`crew-contract/`](crew-contract) | The `.crew/` file format shared by the plugin and the extension: Zod schemas, readers, writers, tests. |
| [`extension/`](extension) | The **Agent Crew** VS Code extension (publisher `whysargis`): installs Claude Code and the plugin, starts crew runs, shows progress and takes your answers — it never calls a model itself. |
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

Requires Claude Code 2.1.271 or later, Node.js 22+, and Docker for the generated project's database.

| Command | What it does |
| --- | --- |
| `/agent-crew:new-project <idea>` | In an empty folder: interview → brief (reviewed by a critic) → architecture and security review → acceptance tests → tasks → build with QA and security review per task → report in `.crew/report.md`. |
| `/agent-crew:feature <what to add>` | In an existing crew-built project: the same pipeline for one feature, on a `crew/<feature>` branch. |
| `/agent-crew:status` | Where the run stands, what the crew needs from you, and spend. |

Settings (`/plugin` → agent-crew, or `claude plugin install … --config KEY=VALUE`): `budget_cap_usd` (default 20), `autonomy` (`full` or `review` — wait for your approval of the brief), `stack_profile` (`tanstack`), `brief_review_minutes`.

The generated project uses the `tanstack` profile: TanStack Start, Drizzle ORM and PostgreSQL, Tailwind, Vitest and Playwright, with sign-in and roles built in.

## Develop

```bash
npm ci --prefix crew-contract && npm test --prefix crew-contract   # contract tests
npm run build --prefix crew-contract                               # regenerate plugins/agent-crew/lib and schemas
claude plugin validate . --strict && claude plugin validate plugins/agent-crew --strict
node --test 'plugins/agent-crew/hooks/test/*.test.mjs' 'plugins/agent-crew/cli/test/*.test.mjs' 'plugins/agent-crew/test/*.test.mjs'
claude --plugin-dir plugins/agent-crew                             # try the plugin locally
```

The project template is tested on its own: `cd plugins/agent-crew/templates/tanstack && npm ci && cp .env.example .env && npm run setup && npm run typecheck && npm test && npm run test:e2e`.
