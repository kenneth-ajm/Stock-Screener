# Product and Sharing Roadmap

## Professional product direction

The product should answer five questions in order:

1. Is market data current and complete?
2. Which stocks deserve attention?
3. Which of those have a valid entry now?
4. What invalidates the trade and how long is the intended hold?
5. Does the trade fit the current portfolio?

The default UI should show one answer per question. Research diagnostics remain available on demand, but should not compete with the daily decision.

## Current UI policy

- Use a small top-level desk choice instead of exposing every model equally.
- Use one recommendation vocabulary: Ready now, Wait for trigger, Research, Pass.
- Show company name beneath every ticker where reference data is available.
- Keep original signal, score, and evidence visible for auditability.
- Keep detailed indicator, evolution, correlation, and funnel panels collapsed by default.
- Open one trade ticket for execution preparation; do not duplicate trade controls in each card.

## Safe friend sharing

The deployed application is still single-user. The current authenticated app must not be shared as a common login because portfolio, paper positions, broker data, and administrative scan controls are private.

The lowest-risk first sharing feature is a separate read-only Market Board that contains only:

- cached market date and freshness;
- sanitized strategy descriptions;
- cached public scan rows and explainability;
- no portfolio capacity, paper trades, journal, broker data, admin routes, or personal settings.

This can be built without converting the trading cockpit into multi-user execution software.

## Requirements before true multi-user use

True friend accounts require an explicit architecture phase:

- authentication and invitation lifecycle;
- `user_id` ownership on every personal table;
- restrictive Supabase RLS policies and tests;
- per-user portfolios, paper accounts, positions, analytics, and journals;
- broker credentials isolated per user and stored server-side only;
- admin routes separated from ordinary users;
- rate limits, audit logs, privacy controls, and terms/risk disclosures.

No broker execution should be added as part of a sharing project.

## Recommendation-model roadmap

1. Preserve the current production strategy versions as controls.
2. Build a versioned candidate-selection model using relative strength, trend persistence, proximity to highs, industry leadership, liquidity, and volatility.
3. Add reliable fundamental quality and earnings-surprise/revision data only after a source is selected and cached server-side.
4. Build separate setup detectors for constructive pullbacks, breakout consolidations, and post-earnings continuation.
5. Require an explicit price-volume trigger before Ready now.
6. Calibrate stops and targets from chart structure and ATR, not fixed return preferences.
7. Compare variants with walk-forward scans and paper outcomes including fees and slippage.

Research-backed is not the same as validated. A new model is eligible for promotion only after it improves out-of-sample expectancy or another predeclared risk-adjusted objective without relying on look-ahead data.
