# Ideas Dossier Overhaul Plan

## Purpose

Turn the Ideas workspace from a narrow signal table into a daily decision cockpit without rewriting the core scanner.

This plan is intentionally additive:
- preserve cached `daily_scans`
- preserve current strategy engine
- preserve broker separation
- preserve paper-trading flow

Checkpoint tag before this work:
- `checkpoint-2026-04-06-pre-ideas-dossier`

## Current Product Problem

The platform is disciplined, but it compresses too much into `BUY / WATCH / AVOID`.

That causes three issues:
- too many good-but-not-ready names look unhelpful
- blockers are hard to see
- users do not get enough context on selected stocks

## Target Product Shape

The Ideas experience should distinguish:
- good stock
- good setup
- good timing
- good portfolio fit

## Phase 1: Candidate State + Dossier

Goal:
- add a dedicated dossier layer on top of cached scan rows
- keep strategy outputs unchanged

Delivered in this phase:
- `setup_type`
- `candidate_state`
- `candidate_state_label`
- `blockers`
- `watch_items`
- `dossier_summary`

Candidate states:
- `ACTIONABLE_TODAY`
- `NEAR_ENTRY`
- `QUALITY_WATCH`
- `EXTENDED_LEADER`
- `BLOCKED`
- `AVOID`

Inputs used:
- raw signal
- quality score / quality signal
- trade risk layer
- execution action
- post-strategy blockers
- reason summary / reason JSON

## Phase 2: Daily Symbol Facts Dataset

Add a derived daily facts layer for every scanned symbol/date:
- trend state
- extension state
- ATR %
- relative volume
- recent high / recent low
- sector / industry leadership
- earnings proximity
- liquidity metrics

Recommended target artifact:
- `daily_symbol_facts`

This should reduce the amount of ad hoc logic embedded in route handlers and UI components.

## Phase 3: Richer Ideas Presentation

Improve the workspace around the new dossier data:
- show `closest to actionable`
- show `blocked by` reasons clearly
- add `what changes this to buy` guidance
- show improved/deteriorated names vs prior scan

## Phase 4: Portfolio Fit Layer

Add post-idea portfolio context:
- cash sufficiency
- slot availability
- sector concentration
- correlation concentration
- duplicate-theme warnings

This should remain separate from signal generation.

## Phase 5: Live Actionability Overlay

Keep scanner logic daily-only.

Allow intraday/live overlays only for:
- price vs entry zone
- actionability timing
- premarket/live visibility

This must not mutate the underlying daily signal engine.

## Success Criteria

The product is better when:
- zero-BUY days still produce useful ranked watchlists
- every surfaced stock explains itself clearly
- blockers are visible instead of implicit
- users can tell what to stalk tomorrow vs what to act on today
- scanner strictness remains intact while the product becomes more informative
