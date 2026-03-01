# Stock Screener Product Spec

## Purpose
A web-based, daily, US long-only stock screener that helps users:
Scan -> Understand -> Size -> Open -> Track -> Close -> Learn.

This is not an intraday product. It is a disciplined swing-trading and portfolio-guidance platform.

## Core Principles
- US stocks only
- Long-only
- Daily timeframe only
- Strict BUY logic
- Market regime first
- Risk-based position sizing
- Cached daily scan architecture
- Explainability built in
- Clean, light, premium UI

## Tech Stack
- Next.js App Router
- TypeScript
- Tailwind CSS
- Supabase (Auth + Postgres)
- Polygon for daily OHLCV
- Vercel deployment target

## User Model
- Supabase login required
- Separate user accounts
- Each user can have multiple portfolios ("investment journeys")
- Each portfolio has:
  - account_currency
  - account_size
  - risk_per_trade
  - max_positions
  - is_default

## Trading Model
- Market: US stocks only
- Long-only
- Daily timeframe only
- Swing trades are the primary use case
- Small % can be used for longer trend holds
- No leverage
- No shorting
- No astrology code baggage

## Data Source
- Source of truth for prices: Polygon
- Use raw/unadjusted daily bars for trading logic
- Do not use Stooq or web scraping for trading calculations

## Data Architecture
Tables used:
- price_bars
- market_regime
- daily_scans
- portfolios
- portfolio_positions
- trade_journal (future / optional)

### price_bars
Stores daily OHLCV from Polygon.

### market_regime
Stores SPY regime state by latest scan date.

### daily_scans
Stores cached scan output per date, universe, symbol, strategy version.

### portfolios
Stores investment journeys and per-portfolio risk settings.

### portfolio_positions
Stores open and closed positions tied to a portfolio.

## Market Regime Logic
- Use SPY
- Compute SMA200 from recent daily bars
- If SPY close > SMA200 -> FAVORABLE
- Else -> DEFENSIVE
- If regime is DEFENSIVE, downgrade BUY to WATCH

## Indicators
- SMA20
- SMA50
- SMA200
- RSI(14)
- ATR(14)
- Volume spike vs 20D average

## Signal Logic
### BUY
Strict and intentionally rare.
Requirements:
- close > SMA50
- close > SMA200
- RSI in healthy range
- volume confirmation
- confidence >= 60
- regime must allow aggression

### WATCH
Interesting setup but not fully qualified BUY.

### AVOID
Weak setup.

## Confidence Score
0-100 score built from:
- trend alignment
- RSI quality
- volume confirmation
- extension penalty
- regime downgrade adjustment

## Position Sizing
Sizing is risk-based, not arbitrary.

Uses:
- account_size
- risk_per_trade
- entry
- stop

Formula concept:
- risk_amount = account_size * risk_per_trade
- shares = floor(risk_amount / (entry - stop))

User can override suggested entry/stop/shares before saving to portfolio.

## Explainability
Each scan row supports:
- reason_summary
- reason_json

Reason data is fetched on demand via `/api/why`.

Explainability should show:
- short summary
- pass/fail checks
- score breakdown

## UX Rules
- Theme: clean light premium
- BUY pinned to top
- Default screener filter: BUY + WATCH
- Avoid horizontal scrolling where possible
- Use accordion details instead of very wide tables
- Confidence meaning should be explained in UI

## Important Guardrails
- `src/app/screener/page.tsx` should remain a server component that fetches latest scan rows and passes `rows` + `scanDate` into the client table.
- `src/app/screener/scanTableClient.tsx` should remain the client interaction layer.
- `/api/why` should stay on-demand. Do not preload full explanation payload into the screener table unless explicitly requested.
- Do not convert the product into an intraday or real-time trading tool unless explicitly requested.
