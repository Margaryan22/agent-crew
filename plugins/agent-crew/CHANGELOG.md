# Changelog

The plugin's version is in `.claude-plugin/plugin.json`; Claude Code keeps you on the version you installed until you update the plugin. Git tags: `plugin-vX.Y.Z`.

## 0.6.0 — 2026-10-02

- **Standing approval.** On its first run the crew asks once whether it may work without a permission prompt for each action (always, only in this project, or no). The plugin records the answer itself; the `approvals` setting can decide it up front. Every safeguard stays on, and tools of other plugins and MCP servers keep their prompts.
- **Progress in the agent panel.** Each crew agent's row shows its role, task, state, tokens and time.

## 0.5.0 — 2026-10-02

- **Run size.** `run_size` (`auto`, `prototype`, `standard`): a small idea becomes a prototype — two to four larger tasks, no designer, QA review only.
- **Digests.** Each agent gets the part of the stack rules that concerns its role and the gist of the brief instead of re-reading both files.
- **Spend.** `crew budget` adds what ran after the host's last report; a final report no longer understates the spend.
- The architect may write any project file until it saves the project policy, so it can finish the skeleton first.

## 0.4.0 — 2026-10-01

- **Test first** for frontend, backend and db; reviewers reject a task that cannot show red→green.
- **Designer** agent and visual review from screenshots at desktop and phone width.
- **`/agent-crew:deploy`** prepares hosting: decision, files, security review, guide.
- **Lessons** kept between projects (`crew lesson`).
- **`parallel_tasks=worktrees`**: parallel executors in their own git worktrees.

## 0.3.0 — 2026-10-01

- **`/agent-crew:continue`** and **`/agent-crew:fix`**.
- Settings **`model_tier`** and **`review_depth`**.

## 0.2.0 – 0.2.2 — 2026-10-01

- **Any stack.** `stack_profile=auto` is the default: the architect chooses or detects the stack and writes its rules into `.crew/stack/` and the project policy into `.crew/policy.json`. `tanstack` remains as a preset.
- **No Docker by default**: an embedded, file-based database unless the brief needs a server.
- **No spending cap by default**; the crew reminds you of it only in a pay-per-use session.

## 0.1.0 — 2026-09-30

- First version: nine agents, core and tanstack skills, hooks, the `crew` CLI, `/agent-crew:new-project`, `/agent-crew:feature`, `/agent-crew:status`.
- Fixes from the first live runs: hooks now run from a symlinked plugin folder; agents preload the crew's skills by their plugin-qualified names; a blocked write names the agent that owns the file.
