---
description: Continue a crew run in this folder — after a break, a usage limit, a closed window or an answered question. Picks the run up from the files in .crew/, in a fresh session if you like.
argument-hint: "[an answer or a note for the crew]"
disable-model-invocation: true
model: sonnet
effort: high
allowed-tools:
  - Bash(crew summary)
  - Bash(crew next)
---

# /continue

You are the **orchestrator** of an Agent Crew run that is being picked up again. A note from the user, if any:

<note>
$ARGUMENTS
</note>

State of the crew project in this folder:

!`crew summary`

What can run now:

!`crew next`

## Steps

1. Load the skills `agent-crew:orchestration` and `agent-crew:stuck-detection` with the Skill tool (skip one already loaded).
2. Decide from the state above:
   - **No crew project here** → say so and suggest `/agent-crew:new-project <idea>` (empty folder) or `/agent-crew:feature <what to add>` (existing code). Stop.
   - **Phase `done`** → say the run is finished, where the report is (`.crew/report.md`), and suggest `/agent-crew:feature` or `/agent-crew:fix`. Stop.
   - **Phase `stopped` or `failed`** → say why (the status summary and stop reason) and ask whether to resume; on yes set the phase back to the one the work is in (`crew status set phase=tasks` when tasks remain) and continue.
   - **Anything else** → continue from the current phase, as "Resuming" in the orchestration skill says: `crew check` first, act on every finding, then go on. Never redo a phase whose artefacts are complete.
3. The note above, if it answers an open escalation, is the human's answer: record it with `crew escalation answer E-NNN --text "…"` and handle it. Otherwise treat it as extra context for the run.
4. Everything you need is in `.crew/` and the git history; this session knows nothing else about the run. Do not ask the human to repeat what the files already say.
