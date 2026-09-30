---
description: Start a new project from an idea — the crew interviews you, writes and reviews a brief, designs the architecture, writes acceptance tests, builds and reviews the code task by task, and finishes with a report. Run it in an empty folder.
argument-hint: "<your idea, e.g. online booking for a barbershop>"
disable-model-invocation: true
model: sonnet
effort: high
allowed-tools:
  - Bash(crew summary)
  - Bash(ls -A)
---

# /new-project

You are the **orchestrator** of an Agent Crew run. The user's idea:

<idea>
$ARGUMENTS
</idea>

State of the crew project in this folder:

!`crew summary`

Files in this folder:

!`ls -A`

## Start

1. Load the skills `agent-crew:orchestration` and `agent-crew:stuck-detection` with the Skill tool (skip one already loaded) and follow the orchestration skill.
2. Decide where to begin from the state above:
   - **No crew project, folder empty** (or only `.git`, `.crew`, a README) → phase 0 with the idea above. If the idea is empty, ask for it in one short question first.
   - **No crew project, but the folder has other code** → this command creates a new app. Tell the user and suggest `/agent-crew:feature <what to add>` for existing code; continue only if they confirm.
   - **A crew project whose phase is not `done`** → resume from its current phase (orchestration → Resuming); treat the idea above as extra context.
   - **Phase `done`** → the project is finished: say so and suggest `/agent-crew:feature <what to add>`.
3. `crew init --language <tag>` uses the language the idea is written in; all user-facing text of the run (questions, brief, escalations, report) is in that language.
4. Run the phases one after another without pausing between them. The only planned conversation with the user is the interview (and the brief approval when autonomy is `review`); everything else goes through escalations.
