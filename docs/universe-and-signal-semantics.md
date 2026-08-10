# Universe and Signal Semantics

## Canonical Daily Coverage

The default Momentum Swing experience uses the populated union of:

- `liquid_2000`: Broad Liquid US common stocks
- `midcap_1000`: liquid Mid-Cap Opportunities

Trend Hold uses Established Leaders (`core_800`) plus Broad Liquid US.
Sector Momentum uses Broad Liquid US plus Mid-Cap Opportunities.

Auto mode includes only universes populated for the same latest scan date. A
stale universe is reported but is not silently mixed with fresher rows.

The on-screen list is a ranked subset of stored daily scan rows. It is not the
full membership of the underlying universes.

## What the Universes Mean

The canonical cohorts are rebuilt together from one completed Polygon date:

- Established Leaders: active US common stocks, price at least $10, ADV20 at
  least $25M, and market capitalization at least $10B.
- Broad Liquid US: active US common stocks, price at least $5, ADV20 at least
  $10M, market capitalization at least $1B, ranked by liquidity with a target
  of 2,000 names.
- Mid-Cap Opportunities: active US common stocks, price at least $5, ADV20 at
  least $10M, and market capitalization from $2B to under $10B.

The stable slugs remain for historical compatibility. `growth_1500` is retired
from active routing because the platform did not have fundamental growth data
that justified the label.

The correct long-term target is a canonical US security master sourced from
Polygon ticker metadata, with explicit eligibility rules for active US common
stocks, price, liquidity, and sufficient daily history. ETFs and special
security types should be intentionally classified rather than accidentally
mixed with common stocks. Polygon's reference ticker endpoint is the approved
metadata source: https://polygon.io/docs/rest/stocks/tickers/all-tickers

## Score Meanings

- Technical score: how many strategy checklist conditions the setup satisfies.
- Quality score: weighted trend, momentum, regime, sector, liquidity,
  volatility, and extension context.
- Decision strength: signal-aligned prioritization. BUY is 70-99, WATCH is
  40-79, and AVOID is 0-49.
- Execution action: whether portfolio capacity, cash sizing, and current price
  permit an entry now.

None of these values is a probability of profit. A WATCH with a perfect
technical checklist can still be blocked by an event, market regime, extension,
or execution condition; the displayed decision strength must reflect WATCH.

## Ranking Integrity

Signal generation and post-strategy risk filters determine BUY, WATCH, and
AVOID. Display limits may choose how many rows to render, but they must never
rewrite persisted signals. Historical rows affected by the old cap are only
recovered when their stored explanation proves that no strategy or post-filter
downgrade occurred.

## News and Sector Context

Ticker news is currently an inspection aid, not a validated recommendation
input. Sector Momentum currently relies on a curated industry map. Neither
should be described as comprehensive market intelligence.

Before news can affect recommendations, it needs attributable sources,
timestamps, symbol/entity mapping, event classification, freshness rules, and
auditable reason fields. News should initially act as a risk flag or catalyst
context, not silently override technical and risk rules.

## Recommended Expansion Order

1. Build and regularly refresh the canonical US security master.
2. Add transparent cohorts such as broad liquid, established large-cap, and
   higher-volatility opportunity names without weakening strategy rules.
3. Replace the static industry map with stored sector and industry metadata.
4. Persist market breadth and sector leadership snapshots by scan date.
5. Add earnings, SEC filing, and attributable news-event context.
6. Validate every scoring change through paper-trade outcomes and walk-forward
   testing before it changes BUY eligibility.
