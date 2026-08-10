# Daily Cockpit

## Product Entry Point

`/today` is the primary trading workflow. It answers three questions in order:

1. What is confirmed and actionable from the latest completed daily bars?
2. What is close enough to prepare but not yet valid?
3. Which open positions require a stop, target, or time-window decision?

The root route redirects to `/today`.

## Active Playbooks

### Fast Momentum

- Server source: `/api/tactical-momentum`
- Market source: cached Polygon daily bars in `price_bars`
- Typical holding plan: 2–7 sessions
- Primary states shown: `BUY_READY` and `NEAR_TRIGGER`
- Target levels: chart-derived through `target_engine.ts`

### Quality Pullback

- Server source: `/api/quality-dip`
- Universe: curated US-listed quality watchlist
- Market source: cached Polygon daily bars in `price_bars`
- Typical holding plan: 3–15 sessions
- Primary states shown: `CONSIDER_BUY` and `WATCH`
- Target levels: chart-derived through `target_engine.ts`

The other scanner strategies remain available in `/ideas` as research tools. Their routes and stored scan data are not removed.

## Data Semantics

- Core signals are generated server-side from completed daily bars.
- `/api/daily-cockpit` normalizes existing playbook results; it does not modify strategy rules.
- Provider snapshots are an execution-context overlay only. A snapshot cannot create or upgrade a daily signal.
- If provider quotes are unavailable, the cockpit falls back to cached daily closes and labels that state.
- The page shows both the completed-bar source date and the expected completed US session.
- A stale cache is displayed as stale rather than presented as current.

## Position Management

Open `portfolio_positions` rows are grouped by symbol for the cockpit summary. Stored `stop_price`, `tp1_price`, `tp2_price`, quantity, and time-stop metadata drive management cues. Full lot-level and partial-close controls remain on `/positions`.

## Preserved Secondary Routes

- `/ideas`: full strategy research and trade-ticket workflow
- `/dashboard`: manual ticker check and legacy overview
- `/positions`: full position and lot management
- `/paper`: paper trading and analytics
- `/broker`: read-only broker integration
- `/review`: journal and outcomes
- `/system`: operational status

Legacy horizon pages remain reachable directly but are intentionally removed from primary navigation to avoid presenting overlapping products as separate daily workflows.
