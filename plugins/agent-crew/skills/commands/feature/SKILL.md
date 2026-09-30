---
description: Add a feature to an existing project — the architect reads the code, the PM writes a mini-brief, then acceptance tests, tasks, build, review and a report, on a separate git branch.
argument-hint: "<the feature to add>"
disable-model-invocation: true
model: sonnet
effort: high
allowed-tools:
  - Bash(crew summary)
---

# /feature

You are the **orchestrator** of an Agent Crew run that adds a feature to existing code. The request:

<feature>
$ARGUMENTS
</feature>

State of the crew project in this folder:

!`crew summary`

## Steps

1. Load the skills `agent-crew:orchestration` and `agent-crew:stuck-detection` with the Skill tool (skip one already loaded). Follow orchestration, with the changes below.
2. Empty request → ask for it in one short question.
3. **Stack check.** This version supports the stack profiles the plugin ships (`tanstack`: TanStack Start + Drizzle + PostgreSQL). Read `package.json`; if the project uses another framework, tell the user the crew cannot work on it yet and stop.
4. **Setup.**
   - No `.crew/`: `crew init --language <tag of the request's language>`.
   - A previous run is unfinished (phase not `done`): ask the user whether to finish it first.
   - `crew status set phase=architecture --summary "Feature: <short name>"`.
   - Branch: `git switch -c crew/<feature-slug>` from the current HEAD. Leave the user's uncommitted changes exactly as they are — never stash, reset or commit them.
5. **Architecture.** **architect**: "Read the code and .crew/. Update docs/architecture.md (write it from the code if it is missing) and record ADRs for this feature: <request>."
6. **Mini-brief** (`phase=brief`). **pm**: "Write the brief for this feature: <request>. If .crew/brief.md exists, add a section '## Feature: <name>' with its user stories and acceptance criteria numbered after the existing ones, bump version and set status in_review; otherwise write a brief whose goal is this feature. List questions only the owner can answer in your final message." Ask those questions with AskUserQuestion (at most 4) and give the answers to the PM, or let the PM record them as assumptions. Then the critic reviews as in orchestration phase 2, focused on the feature section.
7. **Build.** Orchestration phases 5–8 for the new acceptance criteria only: acceptance tests, decomposition, task loop, final. Keep existing tests green — they are the regression suite.
8. **Report.** Append `## Feature: <name>` to `.crew/report.md` (keep earlier sections), then tell the user the branch name and that they can review and merge it (`git switch main && git merge crew/<feature-slug>`).
