# Cockpit Reset Plan

Rollback tag: `pre-cockpit-reset-2026-08-10`

## Product Direction

The default Ideas experience is limited to two short-to-medium-term trade desks:

- Fast Momentum: 2-7 trading days
- Quality Pullback: 3-15 trading days

The existing Swing, Sector, and Hold models remain available under Supporting Research. They are not deleted and continue to use their existing cached scan paths.

## Data Trust Rules

- Signals use completed daily bars stored in `price_bars`.
- Quotes are an execution-context overlay and never recalculate signals in the browser.
- Provider identity, cached bar date, scheduler state, and optional provider probe are available through `/api/market-data/status`.
- When live quote access is unavailable, the UI may show a clearly labeled cached close; it must not represent that value as real time.

## Next Increments

1. Replace the dense Action Focus area with three concise queues: Act Now, Near Trigger, and Manage Positions.
2. Merge overlapping momentum presentation into Fast Momentum without changing its deterministic strategy calculations.
3. Expand Quality Pullback beyond its fixed watchlist through a separate cached candidate-generation job.
4. Add source-backed company and filing context as enrichment, not as signal-generation logic.
5. Measure paper outcomes by setup and regime before adjusting entry thresholds.
