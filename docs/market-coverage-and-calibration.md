# Market Coverage and Strategy Calibration

## Purpose

The scanner can only compare opportunities present in `price_bars`. Universe membership must therefore be built from an independently discovered market set, not from the scanner's previous universe membership.

## Approved Coverage Flow

Polygon remains the source of truth for US daily OHLCV data.

1. Polygon reference data discovers active US common stocks (`market=stocks`, `locale=us`, `active=true`, `type=CS`).
2. Polygon grouped daily bars provide a broad daily market snapshot.
3. `price_bars` stores normalized, unadjusted daily bars with `source=polygon`.
4. Canonical cohorts are rebuilt from active common stocks, current daily bars, liquidity, price and market-cap rules.
5. Per-symbol Polygon history is hydrated in small resumable batches so SMA200 and other daily indicators are available.
6. Strategy scans read cached `price_bars` and write explainable results to `daily_scans`.

The official daily path remains `/api/jobs/daily-scheduled-scan` to `/api/jobs/daily-autopilot`. Daily autopilot discovers active common stocks independently before filtering the grouped response. This prevents a closed loop where only existing universe members can receive new bars.

The administrative bootstrap path is `/api/admin/market-coverage`. Its phases are persisted in `system_status` under `market_coverage_bootstrap_v1`:

- `initialize`: resolve active US common stocks and 30 completed market sessions.
- `discovery_batch`: ingest one grouped market session per request.
- `rebuild`: rebuild all canonical cohorts from the complete snapshot.
- `history_batch`: hydrate at most 15 symbols per request.
- `finalize`: mark the coherent coverage run complete.

This is intentionally Vercel-safe. A browser interruption does not lose progress; the Utilities page can resume the run.

## Current Momentum Baseline

The production values are versioned in `src/lib/strategy/momentum_parameters.ts` as `momentum_baseline_2026_08_11`.

They are engineering defaults, not scientifically proven optimum values:

- RSI BUY band: 50 to 65
- Relative-volume BUY threshold: 1.2x
- Maximum BUY extension: 1.5 ATR from SMA20
- Minimum average dollar volume: $50 million
- Minimum market cap: $2 billion
- Maximum holding period: 7 sessions

Moving these literals into a manifest does not change production behavior. It makes the parameter set explicit, reviewable and reproducible.

## Evidence Versus Calibration

Published research supports broad concepts such as trend persistence, cross-sectional momentum and volume containing information. It does not establish these exact daily thresholds as universally optimal. Conventional RSI or ATR values are heuristics, not guarantees.

The next calibration stage must use rolling train/validation/test windows and compare a deliberately small candidate grid. Evaluation should include:

- expectancy after fees and slippage
- median return and loss distribution
- drawdown and losing streaks
- trade frequency and capital utilization
- stability across market regimes and time windows
- sensitivity to small parameter changes

Parameter selection must not optimize only win rate or choose the best in-sample result.

## Known Historical Limitation

The current backtest reads historical scans using present-day universe membership. That creates survivorship bias and is suitable only for exploratory review. A trustworthy walk-forward optimizer needs point-in-time universe membership and immutable calibration-run metadata.

Those additions require a deliberate schema migration and are not silently introduced by the coverage bootstrap. Until they exist, the UI and APIs must describe the production values as `engineering_baseline_not_calibrated`.

`price_bars` currently preserves the project's established Polygon `adjusted=false` convention. Corporate actions can distort long-window indicators on affected symbols. Before scientific calibration, the project must choose and consistently version an adjusted-price convention rather than mixing adjusted and unadjusted histories.

## Research References

- Jegadeesh and Titman momentum evidence, via NBER: <https://www.nber.org/papers/w7159>
- Moskowitz, Ooi and Pedersen time-series momentum: <https://www.aqr.com/Insights/Research/Journal-Article/Time-Series-Momentum>
- Lee and Swaminathan on price momentum and trading volume: <https://papers.ssrn.com/sol3/papers.cfm?abstract_id=92589>
- Fidelity RSI interpretation guide: <https://www.fidelity.com/learning-center/trading-investing/technical-analysis/technical-indicator-guide/RSI>
- CFA Institute backtesting and simulation guidance: <https://www.cfainstitute.org/insights/professional-learning/refresher-readings/2026/backtesting-and-simulation>

These sources support methods and risk controls, not the exact production numbers in the baseline manifest.

## Verification

From the Utilities page:

1. Open **Advanced (rare): manual ingest / batch scan**.
2. Select **Check status** to inspect saved coverage.
3. Select **Bootstrap market coverage** for a new run or **Resume market coverage** after an interruption.
4. Verify that the latest expected date has broad Polygon row coverage and that the phase reaches `complete`.
5. Run the normal cached scan after coverage is complete.

No live broker order is involved in any of these steps.
