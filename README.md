# Agent Crew

A crew of AI agents — PM, critic, architect, QA, frontend, backend, DB and security — that turns an idea for a small-business tool into a working, tested project. The crew runs inside your own AI assistant on your own subscription: Claude Code today, ChatGPT's Codex next.

> **Status: in development.** The plugin (agents, skills, hooks, commands, the `crew` CLI, the project template), the VS Code control panel (0.3.0 pre-release) and the eval harness are built and tested without a model. The first full runs with a real model are next; Codex support comes after them.

## Repository

| Path | What it is |
| --- | --- |
| [`plugins/agent-crew/`](plugins/agent-crew) | The plugin: agents, skills, hooks. Installed into Claude Code from this repository's marketplace. |
| [`crew-contract/`](crew-contract) | The `.crew/` file format shared by the plugin and the extension: Zod schemas, readers, writers, tests. |
| [`extension/`](extension) | The **Agent Crew** VS Code extension (publisher `whysargis`): installs Claude Code and the plugin, starts crew runs, shows progress and takes your answers — it never calls a model itself. |
| [`evals/`](evals) | Eval ideas, hidden acceptance tests, reference implementations and the end-to-end runner that compares the crew with Claude Code alone. |
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

Requires Claude Code 2.1.271 or later, Node.js 22+, and Docker for the generated project's database. In VS Code, the **Agent Crew** extension (not published yet) does these steps for you from its walkthrough and shows the run's progress.

| Command | What it does |
| --- | --- |
| `/agent-crew:new-project <idea>` | In an empty folder: interview → brief (reviewed by a critic) → architecture and security review → acceptance tests → tasks → build with QA and security review per task → report in `.crew/report.md`. |
| `/agent-crew:feature <what to add>` | In an existing crew-built project: the same pipeline for one feature, on a `crew/<feature>` branch. |
| `/agent-crew:status` | Where the run stands, what the crew needs from you, and spend. |

Settings (`/plugin` → agent-crew, or `claude plugin install … --config KEY=VALUE`): `budget_cap_usd` (default 20), `autonomy` (`full` or `review` — wait for your approval of the brief), `stack_profile` (`tanstack`), `brief_review_minutes`.

The generated project uses the `tanstack` profile: TanStack Start, Drizzle ORM and PostgreSQL, Tailwind, Vitest and Playwright, with sign-in and roles built in.

## Evals

The crew is measured against Claude Code alone on the same ideas, with hidden acceptance tests: `node evals/runner/run.mjs --dry-run` shows the plan and the maximum spend. [evals/README.md](evals/README.md) covers running it, the component evals (`claude plugin eval`) and **how to add an eval idea**: an idea file with prepared interview answers, 5–10 hidden Playwright tests, and a reference implementation that proves the tests fair.

## Add a stack profile

Everything stack-specific lives in two folders; agents and core skills are stack-agnostic (a test enforces it).

1. **Template** — `plugins/agent-crew/templates/<profile>/`: a working starter project with sign-in and roles, a `CLAUDE.md` of conventions for the agents, `.env.example` with placeholders only, a local database if needed, unit and end-to-end tests that pass, and a lockfile. `crew scaffold` copies it into new projects.
2. **Skills** — `plugins/agent-crew/skills/stacks/<profile>/`: an entry skill named `<profile>-stack` (setup commands, folder layout and which agent owns what, conventions, which skill to load when) and focused skills named `<profile>-…` (routes and server code, database, auth, forms, tables and CRUD, reports, tests), each with verified examples and `paths` to load it where it applies.
3. **Hook policy** — `skills/stacks/<profile>/policy.json`: write zones per role matching the template's layout, the package allowlist, and extra safe commands; merged on top of `hooks/policy.core.json`.
4. **Register it** — add the skills folder to `skills` in `plugins/agent-crew/.claude-plugin/plugin.json`, the name to `userConfig.stack_profile.options`, and to `STACK_PROFILES` in `crew-contract/src/config.ts` (then `npm run build --prefix crew-contract`).

`node --test 'plugins/agent-crew/test/*.test.mjs'` checks that every profile has its entry skill, policy and template. Eval ideas and hidden tests work for any profile; reference implementations in `evals/reference/` are per profile.

## Develop

```bash
npm ci --prefix crew-contract && npm test --prefix crew-contract   # contract tests
npm run build --prefix crew-contract                               # regenerate plugins/agent-crew/lib and schemas
claude plugin validate . --strict && claude plugin validate plugins/agent-crew --strict
node --test 'plugins/agent-crew/hooks/test/*.test.mjs' 'plugins/agent-crew/cli/test/*.test.mjs' 'plugins/agent-crew/test/*.test.mjs' 'evals/runner/test/*.test.mjs'
claude --plugin-dir plugins/agent-crew                             # try the plugin locally
```

The project template is tested on its own: `cd plugins/agent-crew/templates/tanstack && npm ci && cp .env.example .env && npm run setup && npm run typecheck && npm test && npm run test:e2e`.
