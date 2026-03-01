# Codex Workflow

## Purpose
Use Codex for heavy code edits.
Use Chat for product logic, reviews, UX decisions, and debugging.

This prevents long threads and keeps development structured.

---

## Always Follow

Before making changes, read:

- docs/PRODUCT_SPEC.md
- docs/CURRENT_STATE.md
- docs/DEV_PLAYBOOK.md

These define:
- Product intent
- Core trading logic
- Non-negotiables
- Architecture rules

---

## Non-Negotiables

Codex must NOT:

- Change the trading timeframe (daily only)
- Introduce intraday logic
- Add leverage or shorting
- Remove strict BUY rules
- Remove regime downgrade behavior
- Replace Polygon as price source
- Convert screener page into client-only architecture
- Remove explainability (`/api/why`)
- Break portfolio-based sizing

---

## Codex Prompt Template

Use this structure when asking Codex to modify code:

You are working in the Stock-Screener repo.

Follow:
- docs/PRODUCT_SPEC.md
- docs/CURRENT_STATE.md
- docs/DEV_PLAYBOOK.md

Goal:
<describe exactly what feature or fix you want>

Constraints:
- Keep Polygon as price source
- Keep strict BUY logic
- Keep regime downgrade behavior
- Keep portfolio-based sizing
- Keep explainability via /api/why
- Do not change architecture unless explicitly requested

Deliver:
- Code changes
- List of files modified
- How to test
- Any follow-up suggestions

---

## When to Use Codex

Good use cases:
- Multi-file refactors
- New API route creation
- Component extraction
- UI layout restructuring
- Cleanup of repetitive logic

Avoid using Codex for:
- Changing core strategy logic without review
- Redesigning architecture casually
- Making product direction decisions

---

## Development Flow

1. Decide feature in Chat
2. Lock acceptance criteria
3. Use Codex to implement
4. Review diff
5. Test locally
6. Commit + push
