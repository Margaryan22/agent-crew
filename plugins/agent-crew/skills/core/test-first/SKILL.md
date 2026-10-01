---
name: test-first
description: How an executor builds a crew task test-first — find or write the test that fails for the right reason, make it pass with the least code, clean up, and report red→green in the submit note. Use in frontend, backend and db agents when working on a task, before writing any feature code.
user-invocable: false
---

# Test first

A test written after the code tends to describe what the code does. A test seen failing first describes what the task asks for. Work in this order on every task.

## 1. Red — see it fail

- **The acceptance tests already exist.** QA wrote an end-to-end test for every acceptance criterion before any feature code. Find the ones your task names (its `## Acceptance` section, `docs/ui-contract.md`) and run only those. They must fail, and for the reason your task is about to remove — a missing page, a missing button, a wrong total. A test that fails for another reason (a typo, a server that is not running) tells you nothing yet: fix that first.
- **Logic the end-to-end tests do not pin down** — a calculation, a validation rule, a permission check, a date boundary — gets a unit test, written now, before the code. One behaviour per test; name it after the behaviour, not the function.
- A task with nothing to test first (a schema migration, a config change) is rare: say why in the submit note, and name the command that proves it works instead.

## 2. Green — the least code that passes

Write only what makes the failing tests pass. No options, layers or abstractions the tests do not ask for. Run the tests again; then the rest of the suite, so nothing that passed before fails now.

## 3. Clean up

With the tests green, remove duplication and unclear names without changing behaviour. Run the checks once more: tests, type check, lint.

## 4. Report it

`crew task submit T-NNN --note "red→green: <tests that failed before and pass now>; <unit tests added>"`. The reviewer looks for exactly this.

## Rules

- Never weaken, skip or delete a test to get to green. If a test contradicts the brief, say so in your result: the brief decides, and QA changes the test.
- Never change a test and the code it checks in the same step: first one, see the result, then the other.
- You write unit tests for your own code in the folder the stack rules give you. The acceptance tests are QA's; if one needs a different selector or fixture, report it instead of editing it.
- A bug found on the way gets its own failing test before its fix.
