import {
  isoDate,
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

export function evaluateTrendHold(opts: {
  bars: PriceBar[];
  regime: RegimeState;
  spy252Return?: number | null;
}) {
  const { bars, regime, spy252Return } = opts;
  if (bars.length < 260) return null;

  const closes = bars.map((b) => b.close);
  const volumes = bars.map((b) => b.volume);
  const latest = bars[bars.length - 1];

  const sma50 = sma(closes, 50);
  const sma150 = sma(closes, 150);
  const sma200 = sma(closes, 200);
  const sma200Ago30 = sma(closes.slice(0, closes.length - 30), 200);
  const avgVolume20 = sma(volumes, 20);

  if (sma50 == null || sma150 == null || sma200 == null || sma200Ago30 == null || avgVolume20 == null) {
    return null;
  }

  const close = latest.close;
  const entry = close;
  const window252 = bars.slice(-252);
  const high52w = Math.max(...window252.map((b) => b.high));
  const low52w = Math.min(...window252.map((b) => b.low));

  const stock252Start = closes[closes.length - 252];
  const stock252Return = stock252Start > 0 ? close / stock252Start - 1 : null;
  const spyRet = typeof spy252Return === "number" && Number.isFinite(spy252Return) ? spy252Return : null;
  const rsProxy = stock252Return != null && spyRet != null ? stock252Return - spyRet : null;

  const avgDollarVolume20 = avgVolume20 * close;
  const nearHighPct = high52w > 0 ? close / high52w : 0;
  const aboveLowRatio = low52w > 0 ? close / low52w : 0;
  const sma200Slope = sma200Ago30 > 0 ? (sma200 - sma200Ago30) / sma200Ago30 : 0;

  const c1 = close > sma50 && close > sma150 && close > sma200;
  const c2 = sma50 > sma150 && sma150 > sma200;
  const c3 = sma200 > sma200Ago30;
  const trendStructureOk = c1 && c2 && c3;
  const c4 = close >= 0.75 * high52w;
  const c5 = close >= 1.3 * low52w;
  const c6 = stock252Return != null && spyRet != null ? stock252Return >= spyRet : false;
  const c7 = close >= 5;
  const c8 = avgDollarVolume20 >= 5_000_000;

  const leadershipOk = c4 && c5 && c6;
  const rsOk = c6;
  const liquidityOk = c7 && c8;
  const strictBuy = trendStructureOk && leadershipOk && rsOk && liquidityOk;
  const watchEligible = trendStructureOk;

  let rawSignal: "BUY" | "WATCH" | "AVOID" = "AVOID";
  if (strictBuy) rawSignal = "BUY";
  else if (watchEligible) rawSignal = "WATCH";

  const trendScore = trendStructureOk ? 50 : 0;
  const leadershipScore = leadershipOk ? 35 : 0;
  const liquidityScore = liquidityOk ? 15 : 0;
  const confidence = trendScore + leadershipScore + liquidityScore;

  const rsNorm = rsProxy == null ? 0 : clamp((rsProxy + 0.2) / 0.8, 0, 1);
  const nearHighNorm = clamp((nearHighPct - 0.75) / 0.25, 0, 1);
  const slopeNorm = clamp((sma200Slope + 0.05) / 0.1, 0, 1);
  const rankScore = rsNorm * 50 + nearHighNorm * 30 + slopeNorm * 20;

  const downgradedBuyToWatch = regime === "DEFENSIVE" && rawSignal === "BUY";
  const signal = downgradedBuyToWatch ? "WATCH" : rawSignal;

  const stop = entry * 0.9;
  const tp1 = entry * 1.1;
  const tp2 = entry * 1.2;

  const checks: RuleCheck[] = [
    {
      key: "close_above_sma50_150_200",
      label: "Close > SMA50/150/200",
      ok: c1,
      detail: `close ${entry.toFixed(2)} | 50 ${sma50.toFixed(2)} | 150 ${sma150.toFixed(2)} | 200 ${sma200.toFixed(2)}`,
      category: "trend",
    },
    {
      key: "sma_alignment",
      label: "SMA50 > SMA150 > SMA200",
      ok: c2,
      detail: `50 ${sma50.toFixed(2)} | 150 ${sma150.toFixed(2)} | 200 ${sma200.toFixed(2)}`,
      category: "trend",
    },
    {
      key: "sma200_rising_30d",
      label: "SMA200 rising (30d)",
      ok: c3,
      detail: `SMA200 ${sma200.toFixed(2)} vs 30d-ago ${sma200Ago30.toFixed(2)} (${(sma200Slope * 100).toFixed(2)}%)`,
      category: "trend",
    },
    {
      key: "near_52w_high",
      label: "Close within 25% of 52w high",
      ok: c4,
      detail: `close ${entry.toFixed(2)} vs 52w high ${high52w.toFixed(2)} (${(nearHighPct * 100).toFixed(1)}%)`,
      category: "leadership",
    },
    {
      key: "above_52w_low_by_30pct",
      label: "Close >= 30% above 52w low",
      ok: c5,
      detail: `close ${entry.toFixed(2)} vs 52w low ${low52w.toFixed(2)} (${(aboveLowRatio * 100).toFixed(1)}%)`,
      category: "leadership",
    },
    {
      key: "rs_proxy_vs_spy",
      label: "RS proxy >= SPY",
      ok: c6,
      detail: `stock ${(100 * (stock252Return ?? 0)).toFixed(1)}% vs SPY ${(100 * (spyRet ?? 0)).toFixed(1)}% (proxy ${(100 * (rsProxy ?? 0)).toFixed(1)}%)`,
      category: "rs",
    },
    {
      key: "price_floor",
      label: "Price floor >= $5",
      ok: c7,
      detail: `close ${entry.toFixed(2)}`,
      category: "liquidity",
    },
    {
      key: "avg_dollar_volume",
      label: "20d avg dollar volume >= $5M",
      ok: c8,
      detail: `avg $${avgDollarVolume20.toFixed(0)}`,
      category: "liquidity",
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
  reasonSummaryBits.push(`${signal}`);
  reasonSummaryBits.push(trendStructureOk ? "leader trend template" : "trend template failed");
  reasonSummaryBits.push(rsOk ? "RS strong" : "RS weak");
  reasonSummaryBits.push(c4 ? "near highs" : "off highs");
  reasonSummaryBits.push(liquidityOk ? "liquidity ok" : "liquidity weak");
  if (downgradedBuyToWatch) reasonSummaryBits.push("defensive regime downgrade");

  return {
    signal,
    raw_signal: rawSignal,
    confidence,
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
        sma50,
        sma150,
        sma200,
        sma200Ago30,
        high52w,
        low52w,
        stock252Return: stock252Return ?? 0,
        spy252Return: spyRet ?? 0,
        rsProxy: rsProxy ?? 0,
        nearHighPct,
        aboveLowRatio,
        sma200Slope,
        avgVolume20,
        avgDollarVolume20,
        marketCap: null,
      },
      flags: {
        event_risk: false,
        earnings_within_days: null,
        news_risk: false,
      },
      checks,
      score_breakdown: [
        { key: "Trend structure (1-3)", points: trendScore },
        { key: "Leadership+RS (4-6)", points: leadershipScore },
        { key: "Liquidity (7-8)", points: liquidityScore },
      ],
      score: confidence,
      rank_score: rankScore,
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
