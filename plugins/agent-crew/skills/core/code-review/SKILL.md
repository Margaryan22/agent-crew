---
name: code-review
description: Checklist for reviewing a crew task's code changes — correctness against the acceptance criteria, tests, conventions, scope, error handling — and how to phrase a reject that the executor can act on. Use when reviewing a task's diff at the QA stage or checking your own work before submitting.
user-invocable: false
---

# Code review

Review the task's commits (`git log --oneline --grep "^T-NNN:"`, `git show <sha>`), not the whole repository. Executors use the same list on their own diff before `crew task submit`.

## Blocking — reject when any is true

1. **Acceptance** — a criterion listed in the task is not met, or its e2e test fails.
2. **Build** — type check, lint or unit tests fail; the app does not start.
3. **Regression** — a test that passed before the change fails now.
4. **Data safety** — a migration can lose data; a destructive operation has no confirmation; writes are not validated on the server.
5. **Permissions** — a route or server function lets a role do or see what the brief forbids (the security stage looks deeper, but obvious gaps are yours to catch).
6. **Contract drift** — UI names differ from `docs/ui-contract.md`, or the data model differs from `docs/architecture.md` / the ADRs without a new ADR.
7. **Scope** — the change does work that belongs to another task or is out of scope in the brief, or leaves the task half done behind a TODO.

## Non-blocking — mention in the note, do not reject

Naming, small duplication, missing comments, style that the formatter does not enforce, performance that does not matter at small-business scale.

## Conventions to check

- Follows the stack rules (`.crew/stack/`, or the preset profile's stack skills) and the project's `CLAUDE.md` (folder layout, server functions, validation, error messages).
- User-facing text in the project language; code and identifiers in English.
- Errors reach the user as a clear message; nothing fails silently; no `console.log` left behind.
- No secrets, no real personal data, no new dependencies outside the stack allowlist without a reason in the task notes.

## Writing the reject

```bash
crew task reject T-004 --stage qa --error "e2e test 'AC-02 booking a taken slot' (e2e/booking.spec.ts) fails — after the second booking the page shows the success toast; expected the message 'This time is no longer available' and no new row in /admin/appointments"
```

One reject lists every blocking problem you found, most important first, each reproducible. Do not reject for non-blocking items.
