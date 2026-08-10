# Market Data Refresh Architecture

## Purpose
This document defines the approved `price_bars` ingestion/refresh architecture and classifies all existing code paths.

Core rules:
- `price_bars` is the scanner's normalized, cache-first source of truth.
- The active acquisition provider is selected server-side with `MARKET_DATA_PROVIDER`.
- Polygon remains the active provider during the first provider-abstraction phase.
- Daily timeframe only.
- Scanner/manual Ideas scans should use cached DB bars and must not run heavyweight refresh by default.

## Official Paths

### 1) Production Daily Path
- Route: `GET` or `POST /api/jobs/daily-scheduled-scan`
- Internally runs:
  - `runAutopilot()` from `/api/jobs/daily-autopilot`
  - sector populate
  - midcap scans
  - breadth + diagnostics snapshots
- `runAutopilot()` obtains one grouped daily-bars response through `src/lib/market-data`, then normalizes and writes `price_bars` for the union of active `core_800`, `liquid_2000`, `midcap_1000`, `growth_1500`, and `SPY` symbols.
- The scheduled strategy matrix is:
  - Momentum (`v1`): `liquid_2000`, `midcap_1000`
  - Trend Hold (`v1_trend_hold`): `core_800`, `liquid_2000`
  - Sector Momentum (`v1_sector_momentum`): `growth_1500`, `midcap_1000`
- The legacy `v2_core_momentum + core_800` run remains in autopilot for compatibility and diagnostics, but it is not the primary Ideas Momentum feed.
- This is the canonical production refresh orchestration.
- Vercel cron config: `vercel.json` schedules `GET /api/jobs/daily-scheduled-scan` at `0 23 * * 1-5` (UTC).
- Route protection:
  - set `CRON_SECRET` in Vercel
  - Vercel cron sends `Authorization: Bearer <CRON_SECRET>`
  - manual/admin calls can also use `x-admin-key` (`ADMIN_RUN_SCAN_KEY`) if configured.
  - `src/proxy.ts` allows this route to reach its server-side secret validation without requiring a Supabase browser session; all normal app/admin routes remain session-protected.
  - production fails closed if neither server-side secret is configured.
- Daily-autopilot ingest date selection:
  - tries the latest completed US trading session first
  - if the active provider returns delayed/empty grouped data, falls back through recent market-session dates
  - avoids getting stuck on a stale existing LCTD when newer finalized market bars are already available.

### 2) Manual/Admin Path
- Route: `POST /api/admin/run-scan`
- Approved manual scan modes:
  - `mode=batch`
  - `mode=finalize`
  - `mode=single` (debug/admin convenience)
- These modes are scan-only and use cached DB bars (`bars_mode: cached_db_only`).
- They do **not** refresh Polygon bars.

- Optional heavy admin mode:
  - `mode=refresh_bars` calls `runAutopilot()` and is heavyweight.
  - Keep for admin use only; not part of normal interactive Ideas flow.

### 3) Backfill/Maintenance Path
- `scripts/backfill-market-gap.mjs`
  - Approved recovery path after a paused database or missed scheduled sessions.
  - Reads one Polygon grouped response per missing weekday, skips market holidays when SPY is absent, and upserts only active-universe symbols in batches.
  - Run outside an interactive Vercel request so a multi-month gap cannot hit serverless duration limits.
  - Example: `node scripts/backfill-market-gap.mjs --from=2026-05-09`
  - Universe members are explicitly paginated to avoid Supabase's configured per-response row cap.
- `POST /api/universe/ingest-liquid-2000`
  - Polygon per-symbol history backfill for selected universe batches.
- `POST /api/jobs/backfill-core-800`
  - Wrapper around `ingest-liquid-2000` for `core_800`.
- `POST /api/ingest-polygon`
  - Legacy Polygon ingest for `SPY + core_400`.
  - Keep as maintenance/legacy bridge; not the production daily path.

### 4) Fallback-Only Path
- `POST /api/score-symbol`
  - If a symbol lacks enough bars, it fetches Polygon history for that symbol and upserts to `price_bars`.
  - Used as targeted fallback for manual symbol scoring.
- `/portfolio` page fallback ingestion
  - On missing latest bar for an open symbol, page-level fallback fetches Polygon history for that symbol.
  - Intended for resilience, not as a primary data pipeline.

### 5) Legacy/Debug/Deprecate Path
- `POST /api/ingest`
  - Stooq SPY ingest into `price_bars` (`source=stooq`).
- `POST /api/ingest-universe`
  - Stooq universe ingest into `price_bars` (`source=stooq`).
- These conflict with Polygon source-of-truth architecture and are disabled by default.
- Can only be enabled explicitly via `ENABLE_LEGACY_STOOQ_INGEST=1`.

## Path Classification Matrix

- `/api/jobs/daily-scheduled-scan`: `production daily path`
- `/api/jobs/daily-autopilot`: `production daily path` (core pipeline step)
- `/api/admin/run-scan` (`batch/finalize/single`): `manual/admin path`
- `/api/admin/run-scan` (`refresh_bars`): `manual/admin path` (heavy)
- `/api/universe/ingest-liquid-2000`: `backfill/maintenance path`
- `/api/jobs/backfill-core-800`: `backfill/maintenance path`
- `/api/ingest-polygon`: `backfill/maintenance path` (legacy bridge)
- `/api/score-symbol` fallback ingest: `fallback-only path`
- `/portfolio` fallback ingestion: `fallback-only path`
- `/api/ingest`: `legacy/debug/deprecate path`
- `/api/ingest-universe`: `legacy/debug/deprecate path`

## Operational Guidance

1. Use `daily-scheduled-scan` for routine production refreshes.
2. Use `admin/run-scan` batch/finalize for interactive manual scans in Ideas.
3. Use maintenance ingest routes only for controlled backfills.
4. Keep legacy Stooq routes disabled unless explicitly needed for emergency/manual testing.

## Universe Definition Maintenance

- `POST /api/universe/build-midcap-1000`
  - Uses Polygon's active US common-stock reference set.
  - Reads real market capitalization from Polygon's supported per-ticker details endpoint.
  - Requires `$2B-$20B` market cap, price above `$5`, and at least `$5M` 20-session average dollar volume.
  - `1000` is a maximum target, not a promise; fewer symbols are retained when fewer pass.
- `POST /api/universe/build-growth-1500`
  - Uses the same supported Polygon details and paginated liquidity path.
  - Requires market cap of at least `$1B`, price above `$5`, and at least `$5M` 20-session average dollar volume.
- Do not add `market_cap.gte` or `market_cap.lte` to Polygon's bulk ticker-list URL. Those parameters are not applied by that endpoint; universe builders must validate the `market_cap` returned by ticker details.
- Grouped responses and universe rows are deduplicated by symbol before upsert.

## How To Verify Daily Refresh Success

1. Trigger manually (safe check):
   - `GET /api/jobs/daily-scheduled-scan?dry_run=1` for non-writing validation
   - `POST /api/jobs/daily-scheduled-scan` for full run (with proper auth header)
2. Confirm response metadata:
   - `started_at`, `ended_at`, `scan_date_used`, `stages[]`, `summary`, `duration_ms`
3. Confirm grouped ingest attempts in autopilot output/status:
   - `ingest_attempts[]`
   - `bars_upserted`
   - `lctd_before_ingest`
4. Confirm persisted observability status:
   - `system_status.key = daily_scheduled_scan_last_run`
   - `system_status.key = daily_autopilot_core_800`
5. Confirm market-data freshness:
   - `max(price_bars.date)` advances when the active provider has a newer completed daily bar.

## Provider Boundary

- Provider interface: `src/lib/market-data/types.ts`
- Provider selector: `src/lib/market-data/index.ts`
- Current adapter: `src/lib/market-data/polygon.ts`
- Authenticated health route: `GET /api/market-data/status`
- Add `?probe=1` to test daily-bar and quote access without exposing credentials.

The production daily ingest, Quality Pullback refresh, and quote endpoint now use this boundary. Scanner and signal code continue to read only normalized cached rows. If provider quote access fails, `/api/quotes` returns the latest cached close with `quote_mode=cached_eod_only` rather than failing the complete trade workflow.

Current configuration:

```bash
MARKET_DATA_PROVIDER=polygon
POLYGON_API_KEY=...
```

An Alpaca adapter can be added later without changing scanner or UI signal calculations.
