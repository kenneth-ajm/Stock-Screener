# Strategy Decision Framework

## Product objective

The Ideas workspace is a daily, long-only decision aid for short-to-medium-term US stock trades. It should produce a small, understandable review list, not promise returns or manufacture BUY signals when no setup passes.

The decision pipeline separates four questions:

1. Candidate quality: Is the stock liquid, in a persistent uptrend, and stronger than relevant peers or the market?
2. Entry timing: Is daily price action near a valid trigger with sufficient volume and without excessive extension?
3. Trade quality: Does the chart-derived stop and target structure provide acceptable reward relative to risk?
4. Portfolio fit: Is there enough cash and capacity without excessive concentration?

## Recommendation vocabulary

The scanner signal and the user-facing recommendation are intentionally separate:

- Ready now: leadership/setup, entry trigger, and executable risk plan all pass at the current price context.
- Wait for trigger: the candidate is valid or close, but price/volume has not confirmed the entry or the current quote is outside the planned zone.
- Research: the stock has enough evidence to monitor, but no valid entry exists yet.
- Pass: trend, liquidity, setup, or risk structure is currently unsuitable.

This layer must never promote an AVOID row to Ready now or rewrite cached scan history. It translates detailed evidence into one daily decision and leaves the original BUY/WATCH/AVOID signal visible for auditability.

## Signal meanings

- BUY: The candidate, timing trigger, market regime, event-risk check, and trade-risk checks all pass. This is a prompt for final review, not an instruction or guarantee.
- WATCH: The candidate trend is valid, but at least one timing or risk confirmation is incomplete. The reason must state the missing trigger.
- AVOID: The trend, liquidity, volatility, extension, or trade-risk structure is unsuitable for the strategy at the current daily close.

BUY should remain strict. WATCH must not require today's volume trigger, because doing so hides valid setups before the trigger occurs.

## Strategy horizons

### Momentum Swing

- Purpose: capture a short continuation after an established rising trend resumes.
- Normal hold: 3–7 trading sessions.
- Entry: daily trend aligned, RSI controlled, price not overextended, and relative volume at least 1.2x.
- Exit: hard chart stop, partial profit into technical resistance, and mandatory review by day 7.

### Trend Continuation

- Purpose: participate in a stronger multi-week leader while its long-term moving-average and relative-strength structure remains intact.
- Normal hold: 10–20 trading sessions.
- Maximum plan: 30 calendar days, with continuous stop and trend review.
- Entry: controlled continuation or pullback; do not chase a stretched price.

### Sector Context

Sector Momentum is supporting evidence. It identifies group leadership but is not a standalone trade instruction. A stock still needs an executable setup and risk plan.

### Quality Pullback and Fast Momentum

- Quality Pullback: 3–15 trading sessions in the curated watchlist.
- Fast Momentum: 2–7 trading sessions after a confirmed breakout or episodic pivot.

## Evidence and limits

- AQR summarizes broad historical evidence for cross-sectional momentum: prior relative winners have tended to outperform prior losers. This supports relative strength as a candidate-ranking feature, not a guaranteed short-horizon forecast: https://www.aqr.com/insights/research/journal-article/fact-fiction-and-momentum-investing
- Moskowitz, Ooi, and Pedersen document return persistence over one-to-twelve-month formation horizons across liquid futures markets. This supports trend persistence as context, but its horizon and instruments do not directly validate a 3–7 day US-stock entry rule: https://w4.stern.nyu.edu/facdir/lpederse/papers/TimeSeriesMomentum.pdf
- Novy-Marx finds that gross profitability has predictive power in the cross-section of average stock returns, especially among large liquid stocks. A future quality overlay should use reliable financial-statement data rather than infer fundamentals from price: https://www.nber.org/papers/w15940
- Investor.gov explains that diversification can reduce portfolio risk but cannot eliminate losses. Portfolio capacity and concentration controls remain necessary even when a signal is strong: https://www.investor.gov/introduction-investing/investing-basics/glossary/diversification
- Kristjan Kullamägi's published breakout framework ranks current one-, three-, and six-month leaders, waits for an orderly consolidation, and requires range expansion before entry. It also treats the chart stop and asymmetric payoff as part of the setup rather than an afterthought: https://qullamaggie.com/my-3-timeless-setups-that-have-made-me-tens-of-millions/
- Investor's Business Daily's published buying checklist combines earnings/sales quality, relative strength, industry leadership, liquidity, market direction, a sound base, and breakout volume. The current platform can measure the price/volume and market components, but must label fundamental components unavailable until a reliable server-side fundamentals source exists: https://www.investors.com/wp-content/uploads/2017/08/IBD_BuyingChecklist.pdf
- AQR's summary of momentum-crash research warns that momentum behaves differently around severe market reversals. That supports retaining market-regime and exposure controls instead of increasing BUY frequency simply by lowering thresholds: https://www.aqr.com/insights/research/journal-article/momentum-crashes
- NBER's review of behavioral evidence describes post-earnings-announcement drift as underreaction to earnings news. This supports a future catalyst layer only when actual surprise and revision data are available; headline sentiment is not an adequate substitute: https://www.nber.org/reporter-2020-02/behavioral-biases-analysts-and-investors

These sources motivate candidate and risk features. They do not establish that this implementation is profitable. Strategy thresholds must be evaluated with out-of-sample paper trades and backtests that include fees, slippage, delisted names where available, and regime variation.

## Next evidence-driven improvements

1. Track paper outcomes by setup state, market regime, strategy, and universe.
2. Calibrate thresholds from walk-forward results instead of increasing signal frequency by intuition.
3. Add profitability, balance-sheet safety, and earnings-revision data only when a reliable server-side source is available.
4. Add sector-relative strength and price-relative strength as candidate-ranking inputs, while keeping the daily trigger separate.
5. Measure coverage explicitly: universe members, members with enough daily history, evaluated rows, BUY, WATCH, and AVOID.
6. Keep selection, setup, trigger, and risk as separate measured stages so a strong company is not mistaken for a timely trade.
7. Version any threshold change and compare it against the current strategy with walk-forward paper results before promotion.
