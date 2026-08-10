# Trade Decision Coherence

The platform should answer one question consistently: **is this a valid trade now, and what is the safe plan?**

## Approved Decision Path

1. Polygon daily bars are stored in `price_bars`.
2. Server-side strategies generate explainable rows in `daily_scans` or a dedicated cached daily evaluator.
3. The Ideas runtime layer chooses one trustworthy decision price:
   - latest provider quote, when available;
   - latest Polygon daily close;
   - scan-date close;
   - otherwise no executable price.
4. `evaluateIdeaRuntimeExecution()` applies entry-zone timing, earnings risk when configured, and market breadth.
5. The same evaluated result drives Ideas counts, filters, table rows, and the trade ticket.
6. Position sizing is the minimum allowed by stop risk, available cash, and any portfolio cap.
7. Position APIs validate targets, slots, and cash again before persistence.

## Product Invariants

- A missing real-time quote must not invalidate a current daily-bar setup. The UI must label the daily-close source.
- A price mismatch, stale/invalid stop, earnings block, or weak breadth must remain visible and explainable.
- Filters are applied to the complete loaded set before the ten-row shortlist is selected.
- Setup grade describes signal quality. It must not be presented as a trade-risk grade.
- Quality Dip and Tactical Momentum use the same account-aware sizing as scanner ideas.
- Portfolio slots count distinct open symbols; additional lots preserve their own cost basis without consuming another diversification slot.
- `portfolio_positions` and `paper_positions` remain separate. Neither path sends broker orders.
- All Ideas decision-price and setup-bar reads must use Polygon rows when reading `price_bars`.

## Earnings Dependency

The post-signal earnings framework remains in place, but Polygon ticker reference responses do not reliably provide a forward earnings calendar. `ENABLE_POLYGON_EARNINGS_LOOKUP=1` is therefore required to enable the legacy lookup. A dedicated earnings-calendar source should replace it before earnings proximity is treated as comprehensive.

## Regression Checks

- Summary state equals the state shown for the same row in the table and ticket.
- Actionable filtering can find a qualifying row outside the first ten ranked rows.
- Editing the actual fill recalculates target percentages from that fill.
- TP1 is above entry; TP2 is above both entry and TP1.
- Suggested shares respect account risk and cash; the position API rejects cost above available cash.
- Tactical table rendering remains capped while filtering and sorting use the complete loaded set.
