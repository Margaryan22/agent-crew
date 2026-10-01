---
name: ui-design
description: How the crew gives an app a deliberate look instead of a default one — the designer's design direction in docs/design.md (palette, type, spacing, components, page layouts, states), how frontend applies it, and how QA reviews the result by eye from screenshots at desktop and phone width. Use when writing docs/design.md, when building any screen, and in the visual review.
user-invocable: false
---

# UI design

Small-business owners judge an app by how it looks before they try what it does. The crew decides the look once, in writing, and every screen follows it.

## The design direction: `docs/design.md` (designer)

Written after the brief and the architecture, before any screen is built. Two pages at most; decisions, not theory.

```markdown
# Design

## Character
Three adjectives and one sentence about who looks at this app, where, and in what mood.

## Colour
| Role | Value | Used for |
|---|---|---|
| Background / surface / border | … | pages, cards, dividers |
| Text / muted text | … | body, secondary |
| Primary / on-primary | … | the one main action per screen |
| Danger, success, warning | … | destructive actions, confirmations, notices |
Contrast: body text at least 4.5:1 against its background.

## Type and spacing
One font family (two at most), a scale of four or five sizes, one spacing unit and its multiples, one corner radius.

## Components
Button (primary, secondary, danger; hover, focus, disabled, busy), field with label and error, select, table, card, alert, empty state, confirmation. How each looks and when to use it.

## Layouts
One paragraph per kind of page in the brief (public form, list with filters, report, sign-in): what is where at desktop width and how it reflows on a phone.

## States
Loading, empty, error and success for every list and form — never a blank area.
```

Rules for the designer:

- Derive it from the brief: who uses the app, on which device, how often. A booking page for clients on phones and a report for an owner at a desk are different problems.
- Choose values the stack can express directly (the stack rules say how styles are written) and name them as tokens once; never a one-off colour in a screen.
- Names of fields, buttons and messages are **not yours**: they come from the brief and `docs/ui-contract.md`, and tests depend on them. You decide how things look and where they sit, not what they are called.
- Accessibility is part of the look: visible focus, labels on every field, targets a finger can hit, nothing conveyed by colour alone.
- No images, icon sets or fonts that need a licence or an account. System fonts or one open font; simple shapes.

## Building a screen (frontend)

Read `docs/design.md` before the first screen and again when in doubt. Use its tokens and components; if a screen needs something the design does not cover, extend the design's pattern and say so in your result — do not invent a second style. Check your screen at phone width before you submit.

## Visual review (QA)

Tests prove a button works; only looking shows that it is cut off. In the final phase, and for any task whose main work is a screen:

1. Start the app and take a full-page screenshot of every page in the brief, at desktop width (1280) and phone width (375), in its main state and — where cheap — its empty and error states. Use the end-to-end runner's screenshot command; save them under `test-results/visual/` (not committed).
2. **Open each image and look at it** (read the file). Check against `docs/design.md`:
   - nothing overlaps, is cut off or needs sideways scrolling; the page has a clear main action;
   - spacing and alignment are consistent; text is readable and not too wide;
   - colours and components are the design's, in every state shown;
   - a phone user can reach and press everything;
   - empty, loading and error states say something useful.
3. Write `.crew/reviews/visual.md`: per page, what is right and what is not, most serious first, each with the screenshot name. A layout that breaks, an unreadable contrast or a missing state is a reject for the task that built the screen (`crew task reject … --stage qa --error "…"`) or, in the final phase, a new task for frontend.
