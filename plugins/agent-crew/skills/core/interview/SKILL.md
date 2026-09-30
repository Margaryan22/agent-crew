---
name: interview
description: How to prepare the structured project interview in .crew/interview.md — question blocks, question style, suggested answers, and how answers and gaps turn into the brief and the access checklist. Use when preparing or reading interview questions for a new project or feature.
user-invocable: false
---

# Project interview

The interview is the one moment the human is asked about the product. Make it short, concrete and easy to answer. The PM writes the questions; the orchestrator asks the human and writes the answers (`crew interview answer N --text …`); subagents cannot talk to the human directly.

## Blocks (SPEC §7.1)

Ask in this order, one `##` heading per block, **2–4 questions per block** (the orchestrator shows one block per screen, at most 4 questions):

1. **Users and roles** — who uses the app, which roles, who may see or change what.
2. **Data** — the main things the business tracks and their key fields; what must never be lost.
3. **Key scenarios** — the 3–5 things users do most; what "done" looks like for each.
4. **Reports** — what the owner wants to see (lists, totals, exports), how often.
5. **Integrations** — payments, email/SMS, calendars, existing spreadsheets or systems to import from.
6. **Constraints** — devices, languages, deadlines, hosting, legal or privacy rules.

Skip a block (or a question) when the idea already answers it — write that answer down instead of asking. Aim for 10–16 questions in total.

## Question style

- Closed or choice questions with a **suggested answer** the human can accept: "Do clients need an account to book, or is a name and phone enough? (Suggested: name and phone, no account.)"
- One decision per question. No jargon — the human is a small-business owner, not a developer.
- Write the questions in the project language (the language of the idea).
- Never ask for passwords, API keys or other secrets. Ask *whether* an account exists and put the item in the access checklist.

## File format

```markdown
# Interview

## Users and roles

### Q: Who books appointments — clients themselves, or staff on their behalf? (Suggested: clients book online; the owner can also book by phone.)

### Q: Which staff roles are there? (Suggested: owner — everything; barber — sees own schedule.)

## Data

### Q: …
```

Answers appear as `A: …` lines under each question. In eval runs the file already has answers — ask only what is missing (`crew interview pending`).

## After the interview

- An unanswered question becomes an **assumption** in the brief (take the suggested answer and mark it "Assumption").
- Anything the crew needs from the human but cannot create itself — accounts, domains, real data, credentials — goes to `.crew/access-checklist.md`:

```markdown
# Access checklist

- [ ] SMTP account for booking emails — confirmations to clients (placeholder in .env until then)
- [ ] Price list for services — seed data (using sample prices until then)
```

Every item says what it is for and what the crew does meanwhile. The crew never blocks on an item that has a workaround.
