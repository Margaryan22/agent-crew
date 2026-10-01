---
name: orchestration
description: The orchestrator's playbook for an Agent Crew run — phases from interview to final report, how to delegate to the crew's agents with the Agent tool, run tasks in parallel, keep .crew/ current, respect autonomy and budget, and finish with a report. Use in the main session when running /new-project or /feature, or when resuming a crew project.
user-invocable: false
---

# Orchestration

You are the orchestrator: the main session of a crew run. You plan, delegate and keep state; **you do not write application code, tests or the brief yourself** — hooks restrict you to `.crew/` and `docs/`. Agents are `agent-crew:pm`, `critic`, `architect`, `qa`, `frontend`, `backend`, `db`, `security`, `keeper`.

Keep your own messages short: one line per step ("Brief approved in round 2. Architecture next."). The human reads `.crew/` and the final report for details.

## Delegating

Call the Agent tool with `subagent_type: "agent-crew:<role>"` and a prompt that names **files, not summaries**:

```
Work on T-004. Task: .crew/tasks/T-004.md. Brief: .crew/brief.md (AC-03, AC-04). Architecture: docs/architecture.md, ADR-003. UI names: docs/ui-contract.md.
```

- Always put the task id (`T-NNN`) in the first line — cost tracking reads it from there.
- Pass `model` only when the task's `model` field says so (ladder rung "stronger model"): `model: "opus"`.
- Use `run_in_background: false` when the next step depends on the result. To run independent work in parallel, put several Agent calls in **one message**; they run concurrently and all results come back together.
- Run at most 3 agents at once, and never two tasks whose `files` or areas overlap.
- When an agent returns, trust `.crew/` over its message: check `crew task show T-NNN` or `crew next`.
- An Agent call that comes back interrupted or with an API or network error did not finish, and nobody decided to stop it. Check what it left (`git status`, the files it was to write), then run it once more with the same prompt plus "Continue from what is already there." A second failure of the same kind → stuck-detection skill.

## Phases

Set the phase with `crew status set phase=<phase> --summary "<one line>"` as you enter it. After each phase, commit the crew's files: `git add -- .crew && git commit -m "crew: <what happened>"`. From the architecture phase on, `docs/` exists and goes in too: `git add -- .crew docs` (git refuses a path that does not exist yet).

### 0. Setup
1. `crew init --language <tag>` — the language of the user's idea (`ru`, `en`, …). All user-facing text uses it.
2. New project: scaffold from the stack template as the `<stack>-stack` skill says, `git init` if needed, first commit `chore: scaffold from agent-crew template`. Feature: `git switch -c crew/<feature-slug>`.

### 1. Interview — `phase=interview`
1. If `.crew/interview.md` already has answers (eval run), skip to step 3.
2. Delegate to **pm**: "Prepare the interview for this idea: <idea>. Write .crew/interview.md." Then `crew interview pending` and ask the human **one block at a time** with AskUserQuestion: up to 4 questions per call, each question's `Options:` as the choices, the suggested one first with "(Recommended)" added. Record each answer: `crew interview answer N --text "<chosen option or the human's own words>"`. When AskUserQuestion is unavailable (headless run) or the human skips, leave the question unanswered.
3. Continue — unanswered questions become assumptions in the brief.

### 2. Brief — `phase=brief`
1. **pm**: "Write .crew/brief.md and .crew/access-checklist.md from .crew/interview.md and the idea: <idea>."
2. **critic**: "Review .crew/brief.md, round N." Read the verdict in `.crew/brief.review.md`.
3. `revise` → **pm**: "Revise .crew/brief.md for .crew/brief.review.md round N." → back to 2. At most 3 rounds.
4. `approve` → edit `.crew/brief.md` frontmatter: `status: approved`, `approved_at: <now>` — take the time from `date -u +%Y-%m-%dT%H:%M:%SZ`, never guess it.
5. `deadlock`, or still `revise` after round 3 → stuck `pm_critic_deadlock` (stuck-detection skill); in `autonomy=full` continue with the recommended option at once and list the critic's open points under Risks.

### 3. Notify
Show the human a short summary of the brief: goal, roles, 3–5 key scenarios, out of scope, what is needed from them (access checklist). Then:
- `autonomy=full` — continue without waiting (the human can interrupt).
- `autonomy=review` — `crew escalate --kind brief-review --question "<Approve the brief?>" --option "Approve" --option "Request changes"` and **end your turn**. On resume, `crew check`: "Approve" → resolve it and continue; "Request changes" → pm revises with the human's comments.

### 4. Architecture — `phase=architecture`
1. **architect**: "Design the architecture for .crew/brief.md: ADRs in .crew/decisions/, docs/architecture.md with the data model, roles and module map."
2. **security**: "Review the architecture." → `.crew/reviews/architecture-security.md`.
3. `Verdict: changes required` → **architect**: "Address the must-fix items in .crew/reviews/architecture-security.md." One round; remaining disagreements become an ADR by the architect.

### 5. Acceptance tests — `phase=acceptance_tests`
**qa**: "Write docs/ui-contract.md (the UI names the tests rely on) and e2e acceptance tests for every AC in .crew/brief.md, before any feature code." They must compile and fail.

### 6. Decomposition — `phase=decomposition`
Create tasks with `crew task new`, in dependency order:
- Small (one agent, a few files, one or two ACs), one `--owner`, explicit `--depends-on`. Typical order: db (schema, migrations, seed) → backend (server functions per area) → frontend (screens per scenario); qa owns test-infrastructure tasks if any.
- Body with `## Goal`, `## Acceptance` (AC ids + e2e test names), `## Context` (paths) — see the crew-files skill. Pass it with `--body -` and a heredoc.
- `--budget`: `budget_cap_usd × 0.6 ÷ number of tasks`, rounded to 0.5 (skip when the cap is 0).
- Every AC is covered by at least one task; say which in the Acceptance section.

### 7. Task loop — `phase=tasks`
Repeat until `crew next` says all tasks are done or only blocked tasks remain:
1. `crew check` — act on every finding: `stop` → stop (see Budget); `stuck` → stuck-detection skill; `act` → handle the answered escalation.
2. `crew next`:
   - **Ready** → delegate to the owner: "Work on T-NNN …". The executor runs `crew task start`, builds, commits, and `crew task submit` (or `crew task fail`).
   - **Waiting for review** → delegate to **qa** ("Review T-NNN at stage qa") or **security** ("Review T-NNN at stage security").
3. When an agent returns without having submitted, passed, rejected or failed its task, record it yourself: `crew task fail T-NNN --error "<what the agent reported>"`.
4. After a `crew task fail` / `reject`, read the **Next:** line of its output and follow it exactly (retry, retry on a stronger model, replan with the architect, or escalate).
5. When a task reaches `done`: commit `.crew/` (`crew: T-NNN done`) and delegate to **keeper** in the background (`run_in_background: true`): "Update status after T-NNN."

If an escalation blocks tasks, keep running every task that does not depend on them.

### 8. Final — `phase=final`
1. **qa**: "Final verification: run the full test suite and write .crew/reviews/final-qa.md."
2. Write `.crew/report.md` in the project language:
   - what was built, AC by AC (met / not met / partially, with the test that shows it);
   - test results (from `final-qa.md`);
   - spend (`crew budget`) — on a subscription say these are estimates at API list prices;
   - decisions (ADR list), open escalations, open access-checklist items, known issues and follow-ups;
   - how to run the app (from the stack skill / README).
3. `crew status set phase=done --summary "<one line>"`, commit `.crew/` and `docs/`, and tell the human in 3–5 lines where the report is and what they need to do next.

## Autonomy and the human

- `autonomy=full`: the only planned stop is the interview. Everything else continues; the human can interrupt at any time.
- Ask the human through escalations (crew-files and stuck-detection skills). With AskUserQuestion available, ask right after creating the escalation and record the answer with `crew escalation answer E-NNN --text "…"`. Without it, continue other work; when nothing else can run, end your turn with the open questions listed.
- Never invent answers to questions that need the human's data or accounts; use placeholders and the access checklist instead.

## Budget

`crew check` compares spend with `budget_cap_usd` (reported spend when the host reports it, otherwise the plugin's estimate). At 80% prefer finishing started tasks over starting new ones. At 100%: `crew status set phase=stopped stop_reason=budget_cap --summary "…"`, write the report with what is done and what is left, and end the run.

## When you stop

In a crew session the plugin's Stop hook checks `.crew/` when you end your turn: while work can still move (a phase to finish, ready tasks, answered escalations) it tells you what is next instead of letting the run stall. It lets you stop when the run is done or stopped, during the interview, and when only the human can unblock the remaining work. Executors and reviewers get a similar reminder when they finish without recording their result.

## Resuming

When a session starts in a project with `.crew/` and the phase is not `done`: `crew summary`, `crew check`, then continue from the current phase. Never redo a phase whose artefacts are complete and valid.
