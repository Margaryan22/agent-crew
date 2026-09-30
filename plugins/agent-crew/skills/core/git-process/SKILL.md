---
name: git-process
description: Git rules for crew agents — which branch to work on, committing only your own task's files with a T-NNN message, never pushing or rewriting history, and how parallel agents avoid stepping on each other. Use before any git command in a crew project.
user-invocable: false
---

# Git in a crew project

Several agents work in the **same checkout at the same time**. These rules keep their work apart.

## Branch

- The orchestrator chooses the branch once, before the build: a new project works on the default branch of the fresh repository; a feature works on `crew/<feature-slug>` created from the current HEAD (`git switch -c crew/<slug>`).
- Executors and reviewers **never switch, create or delete branches** and never run `git checkout <branch>`, `git stash`, `git reset`, `git rebase`, `git clean`.
- Nobody pushes. Hooks block pushes to main/master and force pushes anyway; the human publishes the work.

## Commits

Commit when your task's own checks pass, before `crew task submit`:

```bash
git add -- src/routes/book.tsx src/components/SlotPicker.tsx e2e/booking.spec.ts
git commit -m "T-004: booking form with free-slot picker"
```

- Stage **only the files of your task**, by path. Never `git add -A`, `git add .` or `git commit -a`: other agents have uncommitted work in the same tree.
- Message: `T-NNN: <what changed>` in English, imperative, ≤ 72 characters. Fixes after a rejected review are new commits (`T-004: show taken-slot message`), never amends.
- Do not commit `.env`, generated build output, `node_modules`, or `.crew/` files — the orchestrator commits `.crew/` at phase boundaries (`crew: brief approved`, `crew: T-004 done`).
- If `git commit` fails because a hook of the project (lint, format) changed files, stage those same files again and commit; do not bypass hooks with `--no-verify`.

## Seeing what changed

- Your task's commits: `git log --oneline --grep "^T-004:"`; the diff: `git show <sha>` or `git diff <first-sha>^..HEAD -- <files>`.
- Reviewers read diffs this way; they never commit on the executor's behalf.

## Conflicts

If a file you must change has uncommitted changes you did not make, another agent is working on it. Do not overwrite or revert them: finish what you can, then `crew task fail T-NNN --error "src/x.ts is being changed by another task"` so the orchestrator reorders the work.
