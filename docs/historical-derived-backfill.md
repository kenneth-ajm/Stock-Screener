# Historical Derived Scan Backfill (Safe Mode)

## Purpose

Provide a safe framework to replay historical derived scans from existing `price_bars` so backtesting has meaningful `daily_scans` coverage, without triggering raw market data ingestion.

## Backtest Current Read Path

Backtesting currently reads historical BUY rows from `daily_scans`:
- `signal = BUY`
- `strategy_version` + `universe_slug` filter
- date range filter

It then joins against `price_bars` for entry/exit simulation.

## New Safe Replay Endpoint

Route:
- `POST /api/jobs/backfill-derived-scans`

Files:
- [src/lib/backfill_derived_scans.ts](/Users/kennethang/Documents/Stock-Screener/src/lib/backfill_derived_scans.ts)
- [src/app/api/jobs/backfill-derived-scans/route.ts](/Users/kennethang/Documents/Stock-Screener/src/app/api/jobs/backfill-derived-scans/route.ts)

## Safety Model

- Default is dry-run (`execute=false` unless explicitly passed).
- No raw ingestion is performed.
- Replay uses only existing `price_bars` + existing scan logic/helpers.
- Hard execution guard: `max_days > 10` is blocked in API route.
- Internal cap: `max_days` clamped to `1..30` in helper.

## Request Body

```json
{
  "start_date": "2025-01-01",
  "end_date": "2025-01-31",
  "strategies": ["v2_core_momentum", "v1_trend_hold", "v1_sector_momentum"],
  "execute": false,
  "max_days": 3,
  "include_breadth_preview": true
}
```

Notes:
- `execute=false` means no writes (dry-run).
- `execute=true` enables writes, still bounded by safety caps.

## Tiny Test Mode (Recommended First Run)

Use a very small window first:
- `max_days: 2` or `3`
- `execute: false` first, then `execute: true` only after reviewing dry-run output.

Example:

```bash
curl -X POST /api/jobs/backfill-derived-scans \
  -H "content-type: application/json" \
  -d '{"start_date":"2026-02-24","end_date":"2026-03-03","max_days":3,"execute":false}'
```

## Replay Behavior by Strategy

- `v2_core_momentum`, `v1_trend_hold`:
  - Uses `runScanPipeline(..., finalize:true)` in execute mode.
  - Dry-run mode reports coverage/breadth preview only.

- `v1_sector_momentum`:
  - Uses `computeSectorMomentumCandidates` for each replay date.
  - Execute mode upserts to `daily_scans`.
  - Execute mode prunes stale same-date sector rows not in current candidate set.

## Duplicate / Row Integrity Handling

- Writes use upsert conflict target:
  - `(date, universe_slug, symbol, strategy_version)`
- Sector replay additionally deletes stale same-date rows not present in latest candidate set for that date/strategy/universe.

## Breadth Replay

- Optional `include_breadth_preview` collects per-date breadth preview from existing derived data.
- This is diagnostic output; it does not mutate scanner logic.

## Runtime / Operational Risks

- Long ranges can still be expensive if enabled with execute mode.
- Route intentionally blocks large execute windows to reduce accidental heavy runs.
- Sparse historical bars will limit quality and candidate volume regardless of replay framework.

## Rollback Guidance

If a replay write set is incorrect for a small test date window:
1. Identify affected `(date, universe_slug, strategy_version)`.
2. Re-run execute mode for the same window after fix (upsert will overwrite).
3. For sector rows, pruning ensures stale same-date rows are removed.

No raw price data is altered by this framework.

