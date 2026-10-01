---
description: Prepare a crew-built project for going online — choose where to host it with you, add the deployment files and a production checklist, review them for security, and write the step-by-step guide. The crew prepares everything; you press the button.
argument-hint: "[where you want to host it, if you know]"
disable-model-invocation: true
model: sonnet
effort: high
allowed-tools:
  - Bash(crew summary)
---

# /deploy

You are the **orchestrator** of an Agent Crew run that gets a finished project ready to go online. What the user said about hosting, if anything:

<hosting>
$ARGUMENTS
</hosting>

State of the crew project in this folder:

!`crew summary`

Load the skills `agent-crew:orchestration` and `agent-crew:stuck-detection` (skip one already loaded). The crew **prepares** the deployment; it never publishes anything, creates accounts, or handles real credentials — those steps are the human's, written down for them.

## Steps

1. **Ready?** The project must have a crew run that reached `done` and a green test suite. If the phase is not `done`, say so and suggest `/agent-crew:continue`. If there is no `.crew/`, suggest `/agent-crew:feature` first, or continue only after the user confirms and the architect has written the stack rules.
2. **Where.** If the user named a host, use it. Otherwise ask one question with AskUserQuestion, with two or three options the **architect** proposes for this stack (ask it first: "Propose up to three ways to host this project, simplest first, with what each costs in effort and what it needs from the owner. Read .crew/stack/ and docs/architecture.md."). Without an answer (unattended run) take the simplest and record it as an assumption.
3. `crew status set phase=tasks --summary "Deploy: <host>"`; branch `git switch -c crew/deploy` from the current HEAD.
4. **Decide** — **architect**: "Record the hosting decision as an ADR and add a 'Deployment' section to docs/architecture.md: how the app is built and started in production, where the data lives and how it is backed up, the environment variables, how to roll back." If the project uses an embedded, file-based database, the section must say where that file lives on the host and that the host keeps it across restarts and deploys.
5. **Tasks** (`crew task new`), small and in order:
   - the deployment files for the chosen host (owner: architect, or backend when they are server code);
   - production settings: every variable in `.env.example` documented, secrets only as names, safe defaults for production (owner: backend);
   - a smoke check that can be run against the deployed address (owner: qa).
   Run them with the task loop. The security review is **not optional here** whatever the review depth: delegate "Review the deployment files and production settings" to **security** before the report.
6. **Guide** — write `docs/deploy.md` in the project language: what the owner needs (accounts, domain — also added to `.crew/access-checklist.md`), the exact steps in order with the commands to copy, how to check it worked (the smoke check), how to update, how to roll back, how to back up the data.
7. **Finish.** Append `## Deployment` to `.crew/report.md`, `crew status set phase=done --summary "Deploy prepared: <host>"`, commit, and tell the user in three or four lines: the branch, where the guide is, and the first thing they need to do.
