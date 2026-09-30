# Evals

Two kinds of evals measure the crew (SPEC §11, PLAN.md step 6):

| | What | Where | Cost per full run |
|---|---|---|---|
| **End-to-end** | an idea → a finished app, `baseline` (Claude Code alone) vs `plugin` (the crew), scored by hidden Playwright tests | `evals/runner/` | up to `--budget` per idea and mode |
| **Component** | single behaviours: `/status`, hooks refusing a force push or an unknown package, the PM's interview, the critic's review | `plugins/agent-crew/evals/` (`claude plugin eval`) | a few dollars |

Both call the model. **Nothing here runs in CI**; start a run only when you mean to spend.

## End-to-end runner

```bash
node evals/runner/run.mjs --dry-run                  # the plan and the maximum spend
node evals/runner/run.mjs --yes                      # every idea × baseline, plugin
node evals/runner/run.mjs --yes --ideas barbershop --modes plugin --budget 10
```

For each idea and mode the runner:

1. copies `plugins/agent-crew/templates/tanstack` into a fresh temp folder, gives it its own PostgreSQL (Docker Compose project and port), installs dependencies, migrates, seeds and commits — identical for both modes;
2. **plugin**: `crew init` and `.crew/interview.md` pre-filled with the idea's answers, then `/agent-crew:new-project <idea>`; **baseline**: one prompt with the idea, the same answers and the same definition of done;
3. runs headless Claude Code with the same model, `--permission-mode acceptEdits`, `--permission-prompts none`, the same tool grants and `--max-budget-usd` (the plugin mode adds `--plugin-dir` and `CREW_HOST=eval`);
4. **plugin**: while the crew's status is not `done`/`stopped`/`failed`, answers open escalations with their recommended option (`answered_by: eval`) and resumes the session; **baseline**: resumes only if it stopped with a question. Every resume counts as a human intervention;
5. copies `evals/hidden-tests/<idea>/` into the project, builds it for production and runs the hidden tests;
6. appends a row to `evals/results/<date>.csv` — `idea_id, mode, hidden_tests_passed, hidden_tests_total, cost_usd, duration_min, escalations, human_interventions`, then model, outcome, rounds, run id, start time — and keeps the brief, status, report, Claude results and hidden-test details in `evals/results/<run id>/`.

The crew loads a copy of the plugin in the temp folder, so no agent can read the hidden tests during a run.

| Option | Default | |
|---|---|---|
| `--ideas a,b` | all | ideas from `evals/ideas/` |
| `--modes` | `baseline,plugin` | |
| `--model` | `claude-sonnet-5-5` | pinned for comparable runs |
| `--budget` | `20` | USD per idea and mode (`--max-budget-usd`, resumes included) |
| `--auth` | `subscription` | or `api-key` |
| `--rounds` | `6` | Claude calls per run at most |
| `--timeout-min` | `180` | per Claude call |
| `--keep` | off | keep the project folders and databases |

**Auth.** `subscription` uses a Claude Code profile of its own, so your plugins, hooks and `CLAUDE.md` never leak into the baseline. Sign in to it once:

```bash
CLAUDE_CONFIG_DIR=evals/.claude-config claude     # then /login
```

`api-key` uses `ANTHROPIC_API_KEY` with `--bare` (the project's `CLAUDE.md` is passed to both modes explicitly).

Needs Node.js 22+, Docker running, and about 1 GB of disk per run while it runs.

### Self-test without a model

`evals/runner/test/fake-claude.mjs` stands in for Claude Code and "builds" each idea by copying its reference implementation from `evals/reference/<idea>/`; in the plugin mode it also leaves an escalation for the runner to answer. The whole pipeline — setup, the conversation loop, hidden tests, CSV — then runs for real, and every hidden test must pass:

```bash
node evals/runner/run.mjs --yes --claude evals/runner/test/fake-claude.mjs --budget 5 --config-dir /tmp/any-dir --out /tmp/selftest
```

Unit tests of the runner: `node --test 'evals/runner/test/*.test.mjs'` (in CI).

## Component evals (`claude plugin eval`)

```bash
cd plugins/agent-crew
claude plugin eval . --trust-plugin --scaffold \
  --allow-tools Write Edit "Bash(crew *)" "Bash(git *)" "Bash(npm *)" \
  --model claude-sonnet-5-5 --judge-model claude-haiku-4-5 --max-cost-usd 10
```

Each case runs with and without the plugin; the report shows both scores and the difference. Cases that need hooks set `EVAL_CREW_HOST` (only `EVAL_*` variables reach an eval run).

## Add an idea

1. `evals/ideas/<id>.md` — frontmatter `id`, `title`, `language`; `# Idea` (one paragraph); `# Interview` with `## <block>` headings and `### Q:` / `A:` pairs. Pin down what the hidden tests rely on in the answers, as a client would: page addresses, field labels, button names, messages, and the accounts to seed with their passwords.
2. `evals/hidden-tests/<id>/*.spec.ts` — 5–10 Playwright tests using only what the answers state. Select by role and label, open pages with the `open()` helper (it waits until scripts load), create unique data (random future dates, unique names) so tests never depend on each other.
3. Prove the tests are fair: write a reference implementation in `evals/reference/<id>/` (only the files that differ from the template, including the migration and `src/routeTree.gen.ts`) and run the self-test — all hidden tests must pass against it.
