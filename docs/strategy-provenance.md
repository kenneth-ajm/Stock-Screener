# Strategy Provenance and Validation

## Product Position

The screener produces structured research candidates, not guaranteed outcomes
or personalized financial advice. A high score is not a probability of profit.
The platform should prefer a small, explainable list over signal volume.

## What Is Evidence-Backed

### Relative strength and momentum

Intermediate-horizon momentum has substantial academic evidence. Jegadeesh and
Titman documented persistence in relative winners, with later work evaluating
the effect out of sample. This supports ranking stronger stocks above weaker
peers. It does not prove that a particular daily RSI or volume threshold is
optimal for a three-to-seven-day trade.

Primary reference:
https://www.nber.org/papers/w7159

### Price, trend, volume, and volatility

Moving averages, momentum measures, volume, and volatility are established
technical-analysis inputs. They are descriptive tools rather than guarantees.
The platform uses them to demand trend alignment and avoid low-liquidity or
severely extended entries.

Reference:
https://www.fidelity.com/learning-center/trading-investing/technical-analysis/what-is-technical-analysis

### Entry, support, and predefined risk

Swing-trade planning commonly anchors an entry to a breakout or bounce, places
the invalidation level beyond chart support, and sizes the position from the
distance to that stop. The platform's chart-derived stop and target engine is
consistent with this principle.

Reference:
https://www.schwab.com/learn/story/ins-and-outs-swing-trade

## What Is Practitioner-Inspired

The Fast Momentum workspace is inspired by momentum-continuation and breakout
principles associated with traders such as Kristjan Kullamaggi: prior strength,
constructive consolidation, breakout confirmation, liquidity, and rapid risk
control. It is an implementation inspired by those principles, not an official
or exact reproduction of another trader's private rules.

Practitioner study reference:
https://www.kristjankullamagi.com/setups/breakout/

## What Is a Product Default

The following values are tunable engineering defaults, not universal truths:

- RSI bands such as 50-65 for a strict Momentum BUY
- Relative volume thresholds such as 1.2x
- Maximum ATR extension from a moving average
- Three-to-seven-day or three-to-eight-week time stops
- Account risk per trade
- Market-cap and dollar-volume cohort boundaries

These values must be changed only through versioned strategy configuration and
validated with paper outcomes and walk-forward backtests. Online popularity is
not sufficient evidence to change a production threshold.

## Current Strategy Contracts

### Momentum Swing

- Intent: short momentum continuation, usually three to seven trading days
- Universe: Broad Liquid US plus Mid-Cap Opportunities
- Core evidence: trend alignment, momentum, relative volume, liquidity, market
  regime, extension control, and a chart-derived risk/reward plan
- BUY: all required entry conditions and post-strategy risk gates pass
- WATCH: setup quality exists, but a trigger, regime, event, extension, or
  reward/risk condition is incomplete

### Trend Hold

- Intent: slower trend continuation, usually two to four weeks with a full
  review no later than 30 calendar days
- Universe: Established Leaders plus Broad Liquid US
- Core evidence: durable trend structure, moving-average alignment, liquidity,
  regime, and technical invalidation/target levels
- Volume is contextual rather than a strict v1 BUY gate

### Sector Momentum

- Intent: discover leadership and confirm another setup, not create an entry by
  itself
- Universe: Broad Liquid US plus Mid-Cap Opportunities
- Current limitation: industry membership is curated and should be replaced by
  stored canonical sector/industry metadata

## Validation Standard

Every strategy version should be evaluated on:

- trade count and opportunity frequency
- win rate and payoff ratio
- expectancy after fees
- maximum drawdown and consecutive losses
- results by regime, cohort, and sector
- out-of-sample or walk-forward behavior

A rule should remain strict when it improves expectancy or drawdown behavior,
not merely because a well-known trader uses a similar idea.
