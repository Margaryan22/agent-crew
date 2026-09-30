#!/usr/bin/env bash
# A brief whose acceptance criteria are not measurable.
set -euo pipefail
mkdir -p .crew
cat > .crew/brief.md <<'BRIEF'
---
version: 1
status: in_review
review_rounds: 0
---

# Brief: Barbershop booking

## Goal
Clients book haircuts online.

## Users and roles
- Client, barber, owner.

## User stories
- **US-1** As a client, I want to book a haircut, so that I do not have to call.

## Acceptance criteria
- **AC-01** (US-1) Booking is easy and fast.
- **AC-02** (US-1) The schedule looks good.
- **AC-03** (US-1) Reports are convenient for the owner.

## Out of scope
## Risks
BRIEF
