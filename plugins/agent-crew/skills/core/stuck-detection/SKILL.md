---
name: stuck-detection
description: When a crew task or phase counts as stuck (failed checks, repeated error, PM–critic deadlock, agents undoing each other's edits, task over budget, missing data or access) and the escalation ladder — retry, stronger model, replan, ask the human — with the exact crew commands for each step. Use in the orchestrator whenever crew task fail/reject or crew check reports a problem.
user-invocable: false
---

# Stuck detection and the escalation ladder (SPEC §8)

## Triggers and where you see them

| Trigger | Detected by | Reason code |
|---|---|---|
| Task failed its checks 3 times on the current rung | `crew task fail` / `crew task reject` output | `attempts_exceeded` |
| Same error twice in a row | `crew task fail` / `reject` output (error hash) | `repeated_error` |
| PM and critic disagree after 3 rounds, or verdict `deadlock` | `.crew/brief.review.md` | `pm_critic_deadlock` |
| Two agents undo each other's edits | `crew check` (edit journal) | `edit_flipflop` |
| Task spent more than its budget share | `crew check` (cost estimates vs `budget_usd`) | `task_budget` |
| Data or access missing from the brief and the access checklist | the executor's report | escalation `--kind access` |

The CLI counts attempts and compares error hashes; you do not keep counters in your head. Read the **Next:** line of every `crew task fail` / `reject` and do exactly that.

## A hook refused a write: hand it over

When an executor reports that a hook blocked a file outside its zone, the hook's message names the agent that owns the file. This is not a stuck task and not a question for the human. Delegate that one change to the owner ("For T-NNN: add the new variables to <file>, as T-NNN's Log says"), then run the task again; record it with `crew task fail` only if the task really cannot proceed meanwhile. Ask the human only for what no agent can provide: real credentials, accounts, product decisions.

## The ladder

Each rung allows up to 3 failed checks; a repeated error climbs at once.

1. **Retry** (rung `retry`) — delegate the task again to the same agent: "Work on T-NNN again. The last attempt failed: <error from the task's Log>."
2. **Stronger model** (rung `stronger_model`) — the CLI sets the task's `model` to `opus`. Delegate again with `model: "opus"` in the Agent call.
3. **Replan** (rung `replan`) — delegate to the **architect**: "Replan T-NNN. It failed on opus too; the Log in .crew/tasks/T-NNN.md has the errors. Split it or change the approach." The architect rewrites the task text and may create smaller tasks (`crew task new`); you then wire dependencies with `crew task set T-NNN depends_on=…` or mark the original done if the new tasks replace it (`crew task set T-NNN status=done` with a note in its text). Then run it again.
4. **Ask the human** — when the replanned task gets stuck too, `crew escalate --kind stuck --reason <code> --task T-NNN …` (the task becomes blocked).

For the triggers `crew check` reports (`edit_flipflop`, `task_budget`) start at step 3 (replan): retrying the same thing makes them worse. For `pm_critic_deadlock` go straight to step 4 with options built from the two positions.

## Writing the escalation (SPEC §8: what is stuck, what was tried, 2–3 options with a recommendation)

```bash
crew escalate --kind stuck --reason repeated_error --task T-006 --agent backend \
  --question "Booking emails keep failing: send them later or drop them from v1?" \
  --option "Queue emails and retry (adds a background job)" \
  --option "Drop emails from v1" \
  --recommended "Drop emails from v1" \
  --problem "SMTP connection refused in every attempt; no SMTP account in the access checklist." \
  --tried "3 attempts on sonnet, 3 on opus, replanned into T-011/T-012 — same error."
```

The question is one line in the project language that a non-developer can answer. Options are concrete outcomes, not technical steps. Recommend the option that keeps the brief's core scenarios working.

## After the human answers

1. `crew escalation answer E-NNN --text "<answer as given>"` (skip when the host already recorded it — `crew check` shows it as answered).
2. For `stuck`, `access` and `question`: record the decision — `crew decision new --title "<decision>" --source E-NNN --body -` with Context (the problem), Decision (the answer), Consequences (what changes in tasks/brief). The architect writes it when it changes the architecture.
3. `crew escalation resolve E-NNN --decision ADR-NNN` — this unblocks the task (attempts and ladder reset).
4. Adjust the plan: update the task text, create or drop tasks; update the brief through the PM if scope changed.

## While waiting

Never stop the whole run for one blocked task. Continue with everything that does not depend on it; stop only when every remaining task is blocked, and then end your turn listing the open questions.
