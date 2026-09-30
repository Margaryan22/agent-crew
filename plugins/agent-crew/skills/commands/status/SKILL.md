---
description: Show where the crew run stands — phase, tasks, questions waiting for you, access the crew needs, and spend.
disable-model-invocation: true
model: haiku
effort: low
allowed-tools:
  - Bash(crew summary)
  - Bash(crew next)
---

# /status

!`crew summary`

!`crew next`

Answer from the output above only: do not start agents, run other commands or change files. At most 12 lines, in the language of the project's brief (or the user's language when there is no project):

1. **Phase** and the one-line summary.
2. **Tasks**: done out of total; what is in progress or in review; blocked tasks and what they wait for.
3. **What the user needs to do**: each open escalation (id, the question, its options, the recommended one) — they answer by telling the crew in this session, for example "E-002: skip emails"; then the access items still open, with what each is for.
4. **Spend**: dollars and tokens. When the figure is an estimate, say it is calculated at API list prices, and that on a Claude subscription the plan's limits apply instead (see `/usage`).

If there is no crew project here, say so in one line and suggest `/agent-crew:new-project <idea>`.
