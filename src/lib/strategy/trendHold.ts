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
  const latest = bars[bars.length - 1];

  const sma50 = sma(closes, 50);
  const sma200 = sma(closes, 200);
  const prevSma200 = sma(closes.slice(0, closes.length - 1), 200);
  const rsi14 = rsi(closes, 14);
  const atr14 = atr(bars, 14);

  if (sma50 == null || sma200 == null || prevSma200 == null || rsi14 == null) return null;

  const above200 = latest.close > sma200;
  const sma50Above200 = sma50 > sma200;
  const sma200Rising = sma200 > prevSma200;
  const rsiOk = rsi14 >= 40 && rsi14 <= 70;
  const notSeverelyExtended =
    atr14 != null && atr14 > 0 ? latest.close <= sma50 + 2 * atr14 : latest.close <= sma50 * 1.08;

  let score = 0;
  score += above200 ? 30 : 0;
  score += sma50Above200 ? 25 : 0;
  score += sma200Rising ? 20 : 0;
  score += rsiOk ? 15 : 0;
  score += notSeverelyExtended ? 10 : 0;
  score = clamp(score, 0, 100);

  const strictBuy = above200 && sma50Above200 && sma200Rising && rsiOk && notSeverelyExtended;
  const watchEligible = above200;

  let rawSignal: "BUY" | "WATCH" | "AVOID" = "AVOID";
  if (strictBuy) rawSignal = "BUY";
  else if (watchEligible) rawSignal = "WATCH";

  const downgradedBuyToWatch = regime === "DEFENSIVE" && rawSignal === "BUY";
  const signal = downgradedBuyToWatch ? "WATCH" : rawSignal;

  const entry = latest.close;
  const stop = entry * 0.9;
  const tp1 = entry * 1.1;
  const tp2 = entry * 1.2;

  const checks: RuleCheck[] = [
    {
      key: "close_above_sma200",
      label: "Close > SMA200",
      ok: above200,
      detail: `close ${entry.toFixed(2)} vs SMA200 ${sma200.toFixed(2)}`,
    },
    {
      key: "sma50_above_sma200",
      label: "SMA50 > SMA200",
      ok: sma50Above200,
      detail: `SMA50 ${sma50.toFixed(2)} vs SMA200 ${sma200.toFixed(2)}`,
    },
    {
      key: "sma200_rising",
      label: "SMA200 rising",
      ok: sma200Rising,
      detail: `SMA200 ${sma200.toFixed(2)} vs prev ${prevSma200.toFixed(2)}`,
    },
    {
      key: "rsi_band",
      label: "RSI(14) in 40-70",
      ok: rsiOk,
      detail: `RSI ${rsi14.toFixed(1)}`,
    },
    {
      key: "extension_control",
      label: "Not severely extended",
      ok: notSeverelyExtended,
      detail:
        atr14 != null && atr14 > 0
          ? `close vs SMA50 + 2*ATR (${(sma50 + 2 * atr14).toFixed(2)})`
          : `fallback cap ${ (sma50 * 1.08).toFixed(2) }`,
    },
    {
      key: "regime_gate",
      label: "Regime gate",
      ok: !downgradedBuyToWatch,
      detail: `Regime ${regime}${downgradedBuyToWatch ? " (BUY downgraded)" : ""}`,
    },
  ];
  const checksWithCategory: RuleCheck[] = checks.map((c) => {
    const k = String(c.key ?? "").toLowerCase();
    let category: RuleCheck["category"] = "trend";
    if (k.includes("regime")) category = "regime";
    else if (k.includes("rsi")) category = "momentum";
    else if (k.includes("extension")) category = "risk";
    return { ...c, category };
  });

  const reasonSummary = [
    `${signal} (${Math.round(score)}/100)`,
    `close ${entry.toFixed(2)} vs SMA200 ${sma200.toFixed(2)}`,
    `SMA50>SMA200 ${sma50Above200 ? "yes" : "no"}`,
    `RSI ${rsi14.toFixed(1)}`,
    `slope ${sma200Rising ? "up" : "flat/down"}`,
    downgradedBuyToWatch ? "defensive regime downgrade" : "regime ok",
  ].join(" • ");

  return {
    signal,
    raw_signal: rawSignal,
    confidence: Math.round(score),
    entry,
    stop,
    tp1,
    tp2,
    max_holding_days: TREND_HOLD_MAX_HOLDING_DAYS,
    reason_summary: reasonSummary,
    reason_json: {
      strategy: "trend_hold_v1",
      regime,
      downgraded_buy_to_watch: downgradedBuyToWatch,
      indicators: {
        close: entry,
        sma20: sma(closes, 20) ?? entry,
        sma50,
        sma200,
        prevSma50: sma(closes.slice(0, closes.length - 1), 50) ?? sma50,
        rsi14,
        atr14: atr14 ?? 0,
        avgVolume20: 0,
        volumeSpike: 0,
        avgDollarVolume20: 0,
        distFromSma20: 0,
        distInAtr: 0,
        marketCap: null,
      },
      checks: checksWithCategory,
      score_breakdown: [
        { key: "Close > SMA200", points: above200 ? 30 : 0 },
        { key: "SMA50 > SMA200", points: sma50Above200 ? 25 : 0 },
        { key: "SMA200 slope", points: sma200Rising ? 20 : 0 },
        { key: "RSI band", points: rsiOk ? 15 : 0 },
        { key: "Extension", points: notSeverelyExtended ? 10 : 0 },
      ],
      score: Math.round(score),
      trade_plan: {
        entry,
        stop,
        tp1,
        tp2,
        max_holding_days: TREND_HOLD_MAX_HOLDING_DAYS,
        management: `Scale at +10% then +20%, hold max ${TREND_HOLD_MAX_HOLDING_DAYS} trading days.`,
        stop_style: "pct_8",
      },
    },
  } satisfies RuleEvaluation;
}

export function trendHoldScanDate() {
  return isoDate();
}
