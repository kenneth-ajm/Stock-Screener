import {
  atr,
  isoDate,
  rsi,
  sma,
  type PriceBar,
  type RegimeState,
  type RuleCheck,
  type RuleEvaluation,
} from "@/lib/strategy/coreMomentumSwing";

export const TREND_HOLD_DEFAULT_VERSION = "v1_trend_hold";
export const TREND_HOLD_BUY_CAP = 5;
export const TREND_HOLD_WATCH_CAP = 10;
export const TREND_HOLD_MAX_HOLDING_DAYS = 45;

function clamp(n: number, min: number, max: number) {
  return Math.max(min, Math.min(max, n));
}

export function evaluateTrendHold(opts: { bars: PriceBar[]; regime: RegimeState }) {
  const { bars, regime } = opts;
  if (bars.length < 220) return null;

  const closes = bars.map((b) => b.close);
  const volumes = bars.map((b) => b.volume);
  const latest = bars[bars.length - 1];

  const sma20 = sma(closes, 20);
  const sma50 = sma(closes, 50);
  const sma200 = sma(closes, 200);
  const prevSma50 = sma(closes.slice(0, closes.length - 1), 50);
  const sma200Ago20 = sma(closes.slice(0, closes.length - 20), 200);
  const rsi14 = rsi(closes, 14);
  const atr14 = atr(bars, 14);
  const avgVolume20 = sma(volumes, 20);
  const avgDollarVolume20 =
    avgVolume20 != null && latest.close > 0 ? avgVolume20 * latest.close : null;

  if (
    sma20 == null ||
    sma50 == null ||
    sma200 == null ||
    prevSma50 == null ||
    sma200Ago20 == null ||
    rsi14 == null ||
    atr14 == null
  ) {
    return null;
  }

  const close = latest.close;
  const above200 = close > sma200;
  const sma50Above200 = sma50 > sma200;
  const sma200Rising = sma200 > sma200Ago20;
  const distToSma200 = sma200 > 0 ? (close - sma200) / sma200 : 0;
  const notTooExtendedFromSma200 = distToSma200 <= 0.25;

  const rsiOk = rsi14 >= 45 && rsi14 <= 65;
  const atrPct = close > 0 ? atr14 / close : Infinity;
  const atrSanity = atrPct <= 0.06;

  const distToSma20Pct = sma20 > 0 ? Math.abs((close - sma20) / sma20) : Infinity;
  const distToSma50Pct = sma50 > 0 ? Math.abs((close - sma50) / sma50) : Infinity;
  const pullbackZone = distToSma20Pct <= 0.03 || distToSma50Pct <= 0.03;

  const avgDollarVolumeOk = avgDollarVolume20 != null && avgDollarVolume20 >= 5_000_000;
  const priceFloorOk = close >= 5;
  const volumeSpike = avgVolume20 != null && avgVolume20 > 0 ? latest.volume / avgVolume20 : 0;
  const distFromSma20 = sma20 > 0 ? (close - sma20) / sma20 : 0;
  const distInAtr = atr14 > 0 ? (close - sma20) / atr14 : 0;

  const trendStructureOk = above200 && sma50Above200 && sma200Rising && notTooExtendedFromSma200;
  const qualityOk = rsiOk && atrSanity;
  const liquidityOk = avgDollarVolumeOk && priceFloorOk;
  const strictBuy = trendStructureOk && qualityOk && pullbackZone && liquidityOk;
  const watchEligible = trendStructureOk;

  let rawSignal: "BUY" | "WATCH" | "AVOID" = "AVOID";
  if (strictBuy) rawSignal = "BUY";
  else if (watchEligible) rawSignal = "WATCH";

  const downgradedBuyToWatch = regime === "DEFENSIVE" && rawSignal === "BUY";
  const signal = downgradedBuyToWatch ? "WATCH" : rawSignal;

  let score = 0;
  score += trendStructureOk ? 45 : 0;
  score += qualityOk ? 20 : 0;
  score += pullbackZone ? 20 : 0;
  score += liquidityOk ? 15 : 0;
  score = clamp(score, 0, 100);
  const entry = close;
  const stop = entry * 0.9;
  const tp1 = entry * 1.1;
  const tp2 = entry * 1.2;

  const checks: RuleCheck[] = [
    {
      key: "close_above_sma200",
      label: "Close > SMA200",
      ok: above200,
      detail: `close ${entry.toFixed(2)} vs SMA200 ${sma200.toFixed(2)}`,
      category: "trend",
    },
    {
      key: "sma50_above_sma200",
      label: "SMA50 > SMA200",
      ok: sma50Above200,
      detail: `SMA50 ${sma50.toFixed(2)} vs SMA200 ${sma200.toFixed(2)}`,
      category: "trend",
    },
    {
      key: "sma200_rising",
      label: "SMA200 rising (20d slope)",
      ok: sma200Rising,
      detail: `SMA200 ${sma200.toFixed(2)} vs 20d-ago ${sma200Ago20.toFixed(2)}`,
      category: "trend",
    },
    {
      key: "price_not_too_extended_from_sma200",
      label: "Price not >25% above SMA200",
      ok: notTooExtendedFromSma200,
      detail: `dist ${(distToSma200 * 100).toFixed(1)}%`,
      category: "trend",
    },
    {
      key: "rsi_band_trend",
      label: "RSI(14) in 45-65",
      ok: rsiOk,
      detail: `RSI ${rsi14.toFixed(1)}`,
      category: "momentum",
    },
    {
      key: "atr_sanity",
      label: "ATR14/close <= 6%",
      ok: atrSanity,
      detail: `ATR14 ${(atrPct * 100).toFixed(2)}%`,
      category: "volatility",
    },
    {
      key: "pullback_zone",
      label: "Pullback zone near SMA20/SMA50",
      ok: pullbackZone,
      detail: `dist20 ${distToSma20Pct.toFixed(3)} | dist50 ${distToSma50Pct.toFixed(3)}`,
      category: "pullback",
    },
    {
      key: "avg_dollar_volume",
      label: "20d avg dollar volume >= $5M",
      ok: avgDollarVolumeOk,
      detail: `avg $${(avgDollarVolume20 ?? 0).toFixed(0)}`,
      category: "liquidity",
    },
    {
      key: "price_floor",
      label: "Price floor >= $5",
      ok: priceFloorOk,
      detail: `close ${entry.toFixed(2)}`,
      category: "liquidity",
    },
    {
      key: "event_risk",
      label: "Event risk clear (placeholder)",
      ok: true,
      detail: "No earnings-calendar integration yet",
      category: "flags",
    },
    {
      key: "regime_gate",
      label: "Regime gate",
      ok: !downgradedBuyToWatch,
      detail: `Regime ${regime}${downgradedBuyToWatch ? " (BUY downgraded)" : ""}`,
      category: "flags",
    },
  ];

  const reasonSummaryBits: string[] = [];
  reasonSummaryBits.push(`${signal} (${Math.round(score)}/100)`);
  reasonSummaryBits.push(trendStructureOk ? "trend strong" : "trend weak");
  reasonSummaryBits.push(pullbackZone ? "pullback ok" : "pullback missing");
  reasonSummaryBits.push(`RSI ${rsi14.toFixed(1)}`);
  reasonSummaryBits.push(`ATR ${(atrPct * 100).toFixed(1)}%`);
  reasonSummaryBits.push(liquidityOk ? "liquidity ok" : "liquidity weak");
  if (downgradedBuyToWatch) reasonSummaryBits.push("defensive regime downgrade");

  return {
    signal,
    raw_signal: rawSignal,
    confidence: Math.round(score),
    entry,
    stop,
    tp1,
    tp2,
    max_holding_days: TREND_HOLD_MAX_HOLDING_DAYS,
    reason_summary: reasonSummaryBits.join(" • "),
    reason_json: {
      strategy: "trend_hold_v1",
      regime,
      downgraded_buy_to_watch: downgradedBuyToWatch,
      indicators: {
        close: entry,
        sma20,
        sma50,
        sma200,
        prevSma50,
        sma200Ago20,
        rsi14,
        atr14,
        atrPct,
        avgVolume20: avgVolume20 ?? 0,
        volumeSpike,
        avgDollarVolume20: avgDollarVolume20 ?? 0,
        distFromSma20,
        distInAtr,
        distToSma20: distToSma20Pct,
        distToSma50: distToSma50Pct,
        distToSma200: distToSma200,
        marketCap: null,
      },
      flags: {
        // TODO: integrate earnings calendar and set event_risk/earnings_within_days dynamically.
        event_risk: false,
        earnings_within_days: null,
      },
      checks,
      score_breakdown: [
        { key: "Trend structure", points: trendStructureOk ? 45 : 0 },
        { key: "Quality (RSI + ATR)", points: qualityOk ? 20 : 0 },
        { key: "Pullback zone", points: pullbackZone ? 20 : 0 },
        { key: "Liquidity + price floor", points: liquidityOk ? 15 : 0 },
      ],
      score: Math.round(score),
      trade_plan: {
        entry,
        stop,
        tp1,
        tp2,
        max_holding_days: TREND_HOLD_MAX_HOLDING_DAYS,
        management: `Scale at +10% then +20%, hold max ${TREND_HOLD_MAX_HOLDING_DAYS} trading days.`,
        stop_style: "pct_10",
      },
    },
  } satisfies RuleEvaluation;
}

export function trendHoldScanDate() {
  return isoDate();
}
