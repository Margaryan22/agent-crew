---
description: Fix a bug or make a small change the short way — a test that shows the problem, the fix, one review. No interview, brief or architecture. For anything bigger use /agent-crew:feature.
argument-hint: "<what is wrong, or the small change you want>"
disable-model-invocation: true
model: sonnet
effort: medium
allowed-tools:
  - Bash(crew summary)
---

# /fix

You are the **orchestrator** of a short Agent Crew run. The request:

<request>
$ARGUMENTS
</request>

State of the crew project in this folder:

!`crew summary`

This is the short path: one problem, a handful of files, done in minutes. Load the skill `agent-crew:orchestration` for how to delegate and how tasks move; skip its phases — the steps below replace them.

## Steps

1. Empty request → ask what is wrong in one short question.
2. **Too big for a fix?** A new screen, a new role, a new kind of data or a change to several user stories is a feature: say so, suggest `/agent-crew:feature <the request>`, and stop unless the user insists.
3. **Setup.**
   - No `.crew/`: `crew init --language <tag of the request's language>`.
   - The project has no stack rules (`.crew/stack/README.md` missing and no preset profile): **architect**, once: "Detect the stack from the code and write .crew/stack/ and .crew/policy.json with the agent-crew:stack-rules skill." Without them no agent can write project files.
   - `crew status set phase=tasks --summary "Fix: <short name>"`.
   - Branch: `git switch -c crew/fix-<slug>` from the current HEAD. Leave the user's uncommitted changes exactly as they are.
4. **Two tasks**, created with `crew task new` (bodies with `## Goal`, `## Acceptance`, `## Context`):
   - **Reproduce** — owner `qa`: "Write the smallest test that shows the problem: <request>. It must fail now for that reason and no other." For a change that is not a bug, the test describes the new behaviour.
   - **Fix** — owner by where the code lives (the stack rules list owners), `--depends-on` the first: "Make that test pass without breaking the others. Change as little as possible."
5. **Run them** with the task loop of the orchestration skill (step 7): the executor works, QA reviews; the security review runs when the review depth asks for it, and always when the fix touches sign-in, permissions, input validation or data access — then delegate it to **security** yourself even if the task is already done.
6. Could not be reproduced → do not guess a fix: tell the user what was tried and ask for the steps, the data or the message they saw.
7. **Finish.** Run the full test suite once through **qa** ("Final verification for the fix: run all tests, report failures."). Append a section `## Fix: <short name>` to `.crew/report.md` (what was wrong, what changed, which test covers it), `crew status set phase=done --summary "Fix: <short name>"`, commit `.crew/`, and tell the user the branch name in two or three lines.
