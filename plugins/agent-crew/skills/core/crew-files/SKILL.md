---
name: crew-files
description: How the .crew/ folder of an Agent Crew project works and how to change it with the crew CLI — tasks, escalations, decisions, status, reviews, costs. Use whenever you read or change anything under .crew/.
user-invocable: false
---

# The .crew/ folder

All project state lives in `.crew/` in the project root. Agents hand each other **file paths, not retellings**: point to `.crew/brief.md#acceptance-criteria` or `.crew/tasks/T-004.md` instead of summarising them.

| Path | Written by | What it is |
|---|---|---|
| `crew.json` | `crew init` | contract version, stack profile, project language |
| `interview.md` | PM (questions), orchestrator (answers) | `### Q:` / `A:` blocks |
| `brief.md` | PM | the brief; frontmatter `version`, `status`, `review_rounds`, `approved_at` |
| `brief.review.md` | critic | frontmatter `round`, `verdict`, `checklist` |
| `access-checklist.md` | PM; the human ticks `[x]` | `- [ ] item — why it is needed` |
| `decisions/ADR-NNN-slug.md` | architect (orchestrator for answers) | architecture decisions |
| `tasks/T-NNN.md` | **fields: crew CLI only**; text: the task's agents | one task each |
| `escalations/E-NNN.md` | **crew CLI only** | questions for the human |
| `reviews/*.md` | QA, security | free-form review notes |
| `status.md`, `glossary.md` | keeper (`crew status set`) | current phase and summary; domain terms |
| `report.md` | orchestrator | final report |
| `costs.log` | hooks and hosts | JSONL cost entries — never edit |
| `logs/`, `sessions/` | hooks | machine-local, git-ignored — never edit |

Hooks validate every write under `.crew/` and block writes outside your zone. When a hook blocks you, fix what it names; do not work around it.

## The crew CLI

`crew` is on your PATH. It validates every change, allocates ids safely and enforces the task cycle. Run `crew help` for the full list; add `--json` for machine-readable output.

**Everyone**
- `crew next` — what can run now; `crew task show T-004`; `crew task list [--status S] [--owner O]`
- `crew check` — budget, task budgets, agents undoing each other's edits, escalations to act on
- `crew summary`, `crew budget`, `crew validate`
- `crew escalate …` — ask the human (see below)

**Executors (db, backend, frontend, qa on its own tasks)**
- `crew task start T-004` — before you begin (fails if dependencies are not done)
- `crew task submit T-004 --files src/a.ts,src/b.ts --note "what changed"` — hand over to QA
- `crew task fail T-004 --error "exact error or reason"` — give up this attempt

**Reviewers**
- `crew task pass T-004 --stage qa|security [--note …]` — only the agent of that stage
- `crew task reject T-004 --stage qa|security --error "what is wrong, how to reproduce"`

**Orchestrator** — `crew init`, `crew task new`, `crew task set`, `crew task block`, `crew escalation answer|resolve|cancel`, `crew interview answer`, `crew status set`
**Architect** — `crew decision new`, `crew task new` (when replanning)
**Keeper** — `crew status set`

## Task files

Fields (frontmatter) change only through `crew task …`. The text below the frontmatter is yours to edit with Edit — add notes, not new fields. Structure:

```markdown
# T-004: Booking form

## Goal
Clients pick a barber, a day and a free slot and confirm a booking.

## Acceptance
- AC-03, AC-04 in .crew/brief.md
- e2e: e2e/booking.spec.ts — "books a free slot", "cannot book a taken slot"

## Context
- Data model: docs/architecture.md#data-model, ADR-003
- Server functions from T-003: src/server/bookings.ts

## Notes
(the executor's notes: decisions made, follow-ups)

## Log
(written by the crew CLI — do not edit)
```

## Escalations

Ask the human only for what no agent can decide: missing access or data, a product choice the brief does not settle, or being stuck after the ladder (see the stuck-detection skill).

```bash
crew escalate --kind access --task T-006 --agent backend \
  --question "Which SMTP account should booking emails use?" \
  --option "I will add SMTP credentials to .env" --option "Skip emails in v1" \
  --recommended "Skip emails in v1" \
  --problem "Booking confirmations need an SMTP server; the brief has none." \
  --tried "Checked the brief, ADRs and access checklist."
```

- `--question`: one line, in the project language, decidable without reading code.
- 2–3 `--option`s, short; `--recommended` is one of them.
- `--kind`: `stuck` (with `--reason attempts_exceeded|repeated_error|pm_critic_deadlock|edit_flipflop|task_budget`), `access`, `question`; `permission` and `brief-review` are for the orchestrator.
- `--task` blocks that task until the escalation is resolved.
