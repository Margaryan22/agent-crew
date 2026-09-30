---
name: brief
description: Structure and rules of the project brief (.crew/brief.md) — user stories, numbered measurable acceptance criteria, scope, assumptions, risks — and the critic's review checklist and rounds (.crew/brief.review.md). Use when writing, revising or reviewing a brief.
user-invocable: false
---

# The brief

`.crew/brief.md` is the contract between the human and the crew: architecture, tests and tasks are derived from it, and the final report is checked against it. Write it in the project language; keep it under ~2 pages.

## Frontmatter

```yaml
---
version: 1            # +1 on every revision
status: in_review     # draft → in_review → approved
review_rounds: 0      # critic rounds so far, 0–3
---
```

The orchestrator sets `status: approved` and `approved_at` when the critic approves.

## Sections

```markdown
# Brief: Barbershop booking

## Goal
One paragraph: the business problem, who it is for, what changes when the app exists.

## Users and roles
- **Client** — books and cancels own appointments, no account (name + phone).
- **Barber** — sees own schedule.
- **Owner** — everything: barbers, services, schedule, reports.

## Data
- **Appointment** — client name, phone, barber, service, start time, status (booked/cancelled/done).
- …

## User stories
- **US-1** As a client, I want to pick a barber and a free slot, so that I can book without calling.
- …

## Acceptance criteria
- **AC-01** (US-1) The booking page shows only free 30-minute slots of the chosen barber for the next 14 days.
- **AC-02** (US-1) Booking a slot that was taken meanwhile shows "This time is no longer available" and books nothing.
- …

## Reports
## Integrations
## Out of scope
## Constraints
## Assumptions
- Clients do not need accounts (interview question 2 unanswered; suggested answer taken).

## Risks
```

## Acceptance criteria — the part everything depends on

- Numbered `AC-01`, `AC-02`, … and never renumbered; a removed criterion is struck through, not reused.
- Each names the user story it serves.
- **Observable and testable through the UI**: a QA agent must be able to write an e2e test from the sentence alone. Name concrete values, messages, limits and roles.
- Cover the unhappy paths that matter: validation errors, permissions, conflicts, empty states.
- 10–25 criteria for a small internal tool. More means the scope is too big — move items to "Out of scope".

## Review by the critic (up to 3 rounds)

The critic writes `.crew/brief.review.md` each round:

```markdown
---
round: 1
verdict: revise          # approve | revise | deadlock
checklist:
  value: pass
  scope: fail
  measurability: fail
  risks: pass
---

# Review, round 1

## Must fix
1. AC-05 "reports are convenient" is not measurable — name the report's columns and filters.
2. Scope: online payments are in the stories but not in the interview answers — move to Out of scope or add an access item.

## Should fix
- …
```

Checklist (each `pass` only when fully true):
- **value** — every story serves the goal; nothing decorative; the owner's main pain is addressed first.
- **scope** — buildable as a small internal tool; out-of-scope list is explicit; no hidden integrations.
- **measurability** — every AC is concrete and testable through the UI; unhappy paths covered.
- **risks** — assumptions, missing access and data, legal/privacy points are listed with a fallback.

Verdicts: `approve` when all four pass (minor "should fix" items allowed); `revise` with numbered **must-fix** items otherwise; `deadlock` only in round 3 when the PM's revision did not address a must-fix item. The PM answers each must-fix item in the revision (fix it or explain in Assumptions why not) and bumps `version` and `review_rounds`.
