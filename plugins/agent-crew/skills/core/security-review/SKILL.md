---
name: security-review
description: How the security agent reviews the architecture and each task's changes — authentication and roles, server-side validation, injection, data exposure, secrets, dependencies — with severity levels and the pass/reject rule. Use for architecture security reviews and the security stage of a task.
user-invocable: false
---

# Security review

Small-business tools hold client names, phones, money and schedules. The review keeps them safe without slowing the crew down on theory: block only on real, exploitable problems.

## Severity

- **critical / high** — exploitable now: data of other users readable or changeable, missing authorization on a server function, injection, secrets in the repository or client bundle, auth bypass. **Reject.**
- **medium** — defence in depth missing (rate limiting, security headers, audit log), risky pattern without an exploit path. **Pass**, list in the review file; the orchestrator may add a follow-up task.
- **low / info** — mention only.

## Architecture review (after the ADRs, SPEC §7.4)

Read `docs/architecture.md`, the ADRs and the brief's roles. Write `.crew/reviews/architecture-security.md` with:

1. Roles × actions: who may read/change each entity; where that check will live (server side, per request).
2. Authentication: session handling, password storage (a slow hash such as scrypt, argon2 or bcrypt), account enumeration, logout.
3. Data: personal data stored, retention, what is shown to whom, exports.
4. Inputs: every form and server function validates on the server with a schema.
5. Secrets and configuration: only in `.env`, never committed, never sent to the client.
6. Findings with severity and the fix you expect.

End with `Verdict: pass` or `Verdict: changes required` and the must-fix list. The architect addresses must-fix items before tests and tasks are written.

## Task review (security stage)

1. `crew task show T-NNN`; read the task's commits (`git log --oneline --grep "^T-NNN:"`, `git show`).
2. For each changed server function, route, form or query, check:
   - authorization for the current user's role **on the server**, not only hidden buttons;
   - input validated by a schema on the server; no string-built SQL (use the ORM's parameters);
   - no `dangerouslySetInnerHTML` or unescaped HTML with user data;
   - state-changing actions use POST (or the framework's server functions), not GET;
   - errors do not leak stack traces, SQL or other users' data;
   - no secrets or real personal data in code, fixtures, logs or client code.
3. Run the dependency scanner the stack skill names and a secret search over the task's files:

```bash
git show --name-only --format= $(git log --format=%h --grep "^T-NNN:") | sort -u | xargs grep -nEi "(api[_-]?key|secret|password|token)\s*[:=]\s*['\"][^'\"]{8,}" || true
```

4. Decide:
   - no critical/high findings → `crew task pass T-NNN --stage security --note "<what you checked>; medium: <list or none>"`;
   - otherwise → `crew task reject T-NNN --stage security --error "<severity> <file:line>: <problem>; fix: <expected fix>"`.

Write details to `.crew/reviews/T-NNN-security.md` when there are findings. You never change application code yourself.
