---
name: acceptance-tests
description: How QA writes end-to-end acceptance tests from the brief's acceptance criteria before any code exists, and how QA verifies a finished task against them. Use when writing acceptance tests, mapping criteria to tests, or doing the QA review stage of a task.
user-invocable: false
---

# Acceptance tests

The crew is judged by tests it has never seen, written from the same brief. Your tests are the crew's best guess at them: if your tests are faithful to the acceptance criteria, the hidden tests pass too.

## Before code (SPEC §7.5)

1. Read `.crew/brief.md` (Acceptance criteria, User stories, Users and roles), `docs/architecture.md` and the ADRs.
2. Read the stack rules for end-to-end tests — the stack rules your crew context names (`.crew/stack/README.md`, or the `<stack>-stack` skill of a preset profile) — for the runner, folder, selectors and fixtures.
3. Write **one test per acceptance criterion** (two when it has a clear unhappy path). Put the criterion id in the test name so failures map back:

```ts
test('AC-02 booking a slot taken meanwhile shows an error and books nothing', async ({ page }) => {
  // …
});
```

4. Test only through the UI and routes a real user sees — no calls into internals, no reading the database directly (seed through the app's own seed script or API if the architecture provides one).
5. Select elements by role and accessible name first (`getByRole('button', { name: 'Book' })`), then by label, then `data-testid`. Write the names you expect into `docs/ui-contract.md` (route, heading, form labels, button names, messages) so executors build to them.
6. No fixed sleeps; wait for visible state. Each test sets up its own data and does not depend on test order.
7. Run the suite: the tests must **compile and fail because the feature is missing**, not because of a typo. Record the list in `docs/ui-contract.md` under "Acceptance tests".
8. Commit the tests (`git-process` skill).

Keep the tests truthful to the brief. If a criterion is ambiguous, test the most literal reading and note it in `docs/ui-contract.md`; if it is untestable, say so in your final message — the orchestrator sends it back to the PM.

## QA review stage of a task (SPEC §7.7)

When the orchestrator asks you to review `T-NNN` at stage `qa`:

1. `crew task show T-NNN` — read Goal, Acceptance, the executor's Notes, and `files`.
2. See the change: `git log --oneline --grep "^T-NNN:"` and `git show` each commit.
3. Run, in this order, and stop at the first failure: type check, unit tests, the e2e tests listed in the task's Acceptance section, then the whole e2e suite (to catch regressions).
4. Review the code with the `code-review` checklist.
5. Decide:
   - everything passes → `crew task pass T-NNN --stage qa --note "typecheck, unit, e2e AC-03/AC-04 pass"`;
   - anything fails → `crew task reject T-NNN --stage qa --error "<first failing command>: <exact error, trimmed to the relevant lines>; expected <…>"`.

A reject must let the executor reproduce the problem without asking: the command, the failing test name, the actual vs expected result. Do not fix the executor's code yourself — you may only change tests, and only when the test itself is wrong (then say so in the note).

Write longer findings to `.crew/reviews/T-NNN-qa.md` and mention the path in the note.
