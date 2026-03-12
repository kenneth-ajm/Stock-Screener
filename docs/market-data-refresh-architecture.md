# Market Data Refresh Architecture

## Purpose
This document defines the approved `price_bars` ingestion/refresh architecture and classifies all existing code paths.

Core rules:
- Polygon is the production source of truth for market data.
- Daily timeframe only.
- Scanner/manual Ideas scans should use cached DB bars and must not run heavyweight refresh by default.

## Official Paths

### 1) Production Daily Path
- Route: `POST /api/jobs/daily-scheduled-scan`
- Internally runs:
  - `runAutopilot()` from `/api/jobs/daily-autopilot`
  - sector populate
  - midcap scans
  - breadth + diagnostics snapshots
- `runAutopilot()` performs Polygon grouped daily ingest into `price_bars` for `core_800 + SPY` before scans.
- This is the canonical production refresh orchestration.

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
