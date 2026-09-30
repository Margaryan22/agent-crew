# crew-contract

The `.crew/` file format shared by the **agent-crew** plugin (hooks, the `crew` CLI) and every host that shows or drives a crew run (the Agent Crew VS Code extension, the eval runner). One source of truth: Zod 4 schemas, lenient readers, canonical writers and golden fixtures.

- `src/` — TypeScript sources (environment-neutral, plus `node.ts` for file-system helpers).
- `schemas/*.schema.json` — JSON Schemas generated from the Zod schemas, for people and agents.
- `fixtures/valid/.crew/` — a complete, valid `.crew/` folder; both sides test against it.
- `../plugins/agent-crew/lib/crew-contract.mjs` — **generated** zero-dependency bundle inside the plugin (hooks and the CLI import it; installed plugins get no `npm install`).

```bash
npm ci
npm test                 # vitest with coverage
npm run typecheck
npm run build            # regenerate the plugin bundle and JSON Schemas
npm run check:generated  # CI: fail when generated files are stale
```

Contract version: **1** (`CONTRACT_VERSION`). New optional fields are minor changes and keep the version; renames and removals bump it. `.crew/crew.json` records the version a project was created with, so a host can warn instead of misreading files.

## Files and owners

Every field has exactly one writer.

| File | Written by | Read by |
|---|---|---|
| `crew.json` | `crew init` | hosts, plugin |
| `interview.md` | PM (questions); orchestrator or eval runner (answers) | PM |
| `brief.md` | PM; orchestrator sets `status: approved`, `approved_at` | everyone |
| `brief.review.md` | critic | PM, orchestrator |
| `access-checklist.md` | PM; the human ticks `[x]` | orchestrator, hosts |
| `decisions/ADR-NNN-slug.md` | architect; orchestrator for answers to escalations | everyone |
| `tasks/T-NNN.md` | frontmatter: **only `crew task …`** (hooks enforce it); body: the task's agents | everyone, hosts |
| `escalations/E-NNN.md` | created by `crew escalate` (`source: plugin`) or a host (`source: host`); answer fields: the host (or the orchestrator on the human's behalf); `resolved` / `decision`: orchestrator | everyone |
| `reviews/*.md` | QA, security | orchestrator, humans |
| `status.md`, `glossary.md` | keeper / orchestrator via `crew status set`; a host may only set `phase: stopped`, `stop_reason` and append one quote line | everyone |
| `report.md` | orchestrator | hosts, humans |
| `costs.log` | hosts (`sdk`, `headless`), plugin hooks (`estimate`) — append only | hosts, `crew budget` |
| `logs/hooks.jsonl`, `logs/edits.jsonl` | plugin hooks | debugging, stuck detection |
| `sessions/<id>.json` | plugin hook when a crew command starts | hosts (reopen the session) |

`logs/` and `sessions/` are machine-local and listed in `.crew/.gitignore`.

## Schemas (strict, for writers)

**Task** `tasks/T-NNN.md` — `id` ✓, `title` ✓, `status` ✓ (`todo | in_progress | review | done | blocked`), `owner` ✓ (kebab-case agent), `attempts` ✓, `model`, `ladder` (`retry | stronger_model | replan`), `last_error_hash`, `review_stage` (`qa | security`, only in `review`), `escalation` (only in `blocked`), `depends_on`, `branch`, `base`, `files`, `budget_usd`, `spent_usd_estimate`, `created_at` ✓, `updated_at` ✓.

**Escalation** `escalations/E-NNN.md` — `id` ✓, `kind` ✓ (`stuck | access | question | permission | brief-review`), `reason` (required for `stuck`: `attempts_exceeded | repeated_error | pm_critic_deadlock | edit_flipflop | task_budget`), `source` ✓, `status` ✓ (`open | answered | resolved | cancelled`), `question` ✓ (one line), `options` ✓ (1–4), `recommended` (one of options), `task`, `agent`, `session_id`, `created_at` ✓, `answer`, `answered_at`, `answered_by` (`human | auto | eval`; all three required once answered), `decision` (ADR; required when a plugin `stuck`/`access`/`question` escalation is resolved).

**Decision** — `id` ✓, `title` ✓, `status` ✓ (`proposed | accepted | superseded | rejected`), `date` ✓, `source` (E-id), `supersedes` (ADR-id).

**Status** — `phase` ✓ (`interview | brief | architecture | acceptance_tests | decomposition | tasks | final | done | stopped | failed`), `updated_at` ✓, `active_tasks`, `stop_reason` (required when `stopped`: `budget_cap | user | error`), `summary` (≤ 280).

**Brief** — `version` ✓, `status` ✓ (`draft | in_review | approved`), `review_rounds` ✓ (0–3), `approved_at` (required when approved). **Brief review** — `round` ✓, `verdict` ✓ (`approve | revise | deadlock`), `checklist` ✓ (`value`, `scope`, `measurability`, `risks`: `pass | fail`).

**Manifest** `crew.json` — `contract_version` ✓, `plugin {name, version}` ✓, `stack_profile` ✓, `created_at` ✓, `language` (BCP 47 tag of user-facing text).

**Cost entry** (one JSON line of `costs.log`) — `ts` ✓, `source` ✓ (`sdk | headless | estimate | manual`), `session_id`, `turn_cost_usd`, `session_total_usd`, `task`, `agent`, `model`, `tokens {input, output, cache_read, cache_write}`; at least one of the cost fields. Hook and edit journal lines carry digests, never raw tool input.

Every markdown schema keeps unknown keys (`looseObject`); writers put known keys first in a fixed order.

## Lifecycles

```text
task:        todo ──start──▶ in_progress ──submit──▶ review/qa ──pass──▶ review/security ──pass──▶ done
               ▲                                        │                     │
               └───────── reject / fail (attempts+1, ladder may climb) ◀──────┘
             any ──escalate --task──▶ blocked ──escalation resolved/cancelled──▶ todo

escalation:  open ──host or orchestrator answers──▶ answered ──orchestrator acts (+ ADR)──▶ resolved
             open | answered ──▶ cancelled
```

The escalation ladder (SPEC §8) lives in the task: a failed check increments `attempts` and stores the error hash; three failures on a rung or a repeated error climb `retry → stronger_model → replan`, and after `replan` the orchestrator escalates. `crew task fail|reject` prints the next step.

## Ids

`T-001`, `E-001`, `ADR-001` (three or more digits). Several writers allocate ids and there is no central allocator, so the rule is **highest existing number + 1, created exclusively** (`open(…, 'wx')`); a writer that loses the race gets `EEXIST` and tries the next number (`createWithNextId` in `node.ts`). ADR file names add a slug: `ADR-003-postgresql.md`.

## Costs and the budget cap

`projectSpentUsd()` counts only authoritative entries (`sdk`, `headless`): per session the highest running total, otherwise the sum of per-turn costs. Plugin estimates (`estimate`) come from subagent transcripts at API list prices; they drive per-task budget shares and are the only figure in subscription sessions, where plan limits apply instead of dollars. Hard stops belong to the host (`--max-budget-usd`); the plugin stops on its own figure only when no host reports costs.

## Config

`resolveCrewConfig(env)` → `{ config, sources, issues }`, resolving each key in this order: `CREW_*` (a host) → `CLAUDE_PLUGIN_OPTION_*` (the plugin's userConfig — Claude Code exports only values the user set) → `EVAL_CREW_*` (`claude plugin eval` passes only `EVAL_*`) → defaults (`autonomy=full`, `brief_review_minutes=10`, `budget_cap_usd=20`, `stack_profile=tanstack`, `host=interactive`). The plugin's session hook stores a snapshot in `sessions/<id>.json` so the `crew` CLI resolves the same values.

## Using it from a host

- **Read** with the lenient readers (`readTask`, `readEscalation`, `readDecision`, `readStatus`): they accept hand-edited files, older formats (`assignee`, Russian keys) and report strict issues separately.
- **Write** only through the writers (`renderTask`, `renderEscalation`, `answerEscalation`, `markStopped`, `appendJsonLine`, `createWithNextId`, `writeFileAtomic`), and only the fields the table above gives the host.
- **Validate** any file by path with `validateCrewFile(relPath, text)`.
