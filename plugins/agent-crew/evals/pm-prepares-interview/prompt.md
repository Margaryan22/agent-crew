---
description: The PM agent writes .crew/interview.md in blocks with suggested options, following the interview skill.
tags: [agents]
max_turns: 25
timeout_seconds: 900
runs: 2
allowed_tools: [Agent, Read, Glob, Grep, Skill, Write, Edit, Bash]
---

Have the agent-crew pm agent prepare the project interview in .crew/interview.md for this idea: online booking for a small barbershop with two barbers. Only prepare the questions — do not write the brief.
