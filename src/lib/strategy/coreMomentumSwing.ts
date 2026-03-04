export type RegimeState = "FAVORABLE" | "CAUTION" | "DEFENSIVE";

export type PriceBar = {
  date: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
};

export type RuleCheck = {
  key: string;
  label: string;
  category?: "trend" | "momentum" | "volume" | "risk" | "regime" | "execution";
  ok: boolean;
  detail: string;
};

export type RuleEvaluation = {
  signal: "BUY" | "WATCH" | "AVOID";
  raw_signal: "BUY" | "WATCH" | "AVOID";
  confidence: number;
  entry: number;
  stop: number;
  tp1: number;
  tp2: number;
  max_holding_days: number;
  reason_summary: string;
  reason_json: {
    strategy: string;
    regime: RegimeState;
    downgraded_buy_to_watch: boolean;
    indicators: {
      close: number;
      sma20: number;
      sma50: number;
      sma200: number;
      prevSma50: number;
      rsi14: number;
      atr14: number;
      avgVolume20: number;
      volumeSpike: number;
      avgDollarVolume20: number;
      distFromSma20: number;
      distInAtr: number;
      marketCap: number | null;
    };
    checks: RuleCheck[];
    score_breakdown: Array<{ key: string; points: number }>;
    score: number;
    trade_plan: {
      entry: number;
      stop: number;
      tp1: number;
      tp2: number;
      max_holding_days: number;
      management: string;
      stop_style: "pct_8";
    };
  };
};

export const CORE_MOMENTUM_DEFAULT_UNIVERSE = "core_800";
export const CORE_MOMENTUM_DEFAULT_VERSION = "v2_core_momentum";
export const CORE_MOMENTUM_BUY_CAP = 5;
export const CORE_MOMENTUM_WATCH_CAP = 10;
export const CORE_MOMENTUM_MAX_HOLDING_DAYS = 7;

const MIN_AVG_DOLLAR_VOLUME = 50_000_000;
const MIN_MARKET_CAP = 2_000_000_000;

export function isoDate(d = new Date()) {
  return d.toISOString().slice(0, 10);
}

export function sma(values: number[], period: number) {
  if (values.length < period) return null;
  let total = 0;
  for (let i = values.length - period; i < values.length; i++) total += values[i];
  return total / period;
}

export function rsi(values: number[], period = 14) {
  if (values.length < period + 1) return null;
  let gains = 0;
  let losses = 0;
  for (let i = values.length - period; i < values.length; i++) {
    const diff = values[i] - values[i - 1];
    if (diff >= 0) gains += diff;
    else losses += -diff;
  }
  const avgGain = gains / period;
  const avgLoss = losses / period;
  if (avgLoss === 0) return 100;
  const rs = avgGain / avgLoss;
  return 100 - 100 / (1 + rs);
}

function trueRange(curr: PriceBar, prev: PriceBar) {
  const hl = curr.high - curr.low;
  const hc = Math.abs(curr.high - prev.close);
  const lc = Math.abs(curr.low - prev.close);
  return Math.max(hl, hc, lc);
}

export function atr(bars: PriceBar[], period = 14) {
  if (bars.length < period + 1) return null;
  let total = 0;
  for (let i = bars.length - period; i < bars.length; i++) {
    total += trueRange(bars[i], bars[i - 1]);
  }
  return total / period;
}

export function avgVolume(bars: PriceBar[], period = 20) {
  if (bars.length < period) return null;
  let total = 0;
  for (let i = bars.length - period; i < bars.length; i++) {
    total += Number.isFinite(bars[i].volume) ? bars[i].volume : 0;
  }
  return total / period;
}

function clamp(n: number, min: number, max: number) {
  return Math.max(min, Math.min(max, n));
}

function recentlyReclaimedSma200(closes: number[], sma200Value: number) {
  if (closes.length < 15) return false;
  const lookback = closes.slice(-10);
  const hadBelow = lookback.some((c) => c <= sma200Value);
  const hadAbove = lookback.some((c) => c > sma200Value);
  const latest = closes[closes.length - 1];
  return hadBelow && hadAbove && latest >= sma200Value * 0.995;
}

function pct(value: number) {
  return `${(value * 100).toFixed(1)}%`;
}

export function evaluateCoreMomentumSwing(opts: {
  bars: PriceBar[];
  regime: RegimeState;
  marketCap?: number | null;
}) {
  const { bars, regime } = opts;
  const marketCap = opts.marketCap ?? null;

  if (bars.length < 220) return null;

  const closes = bars.map((b) => b.close);
  const latest = bars[bars.length - 1];

  const sma20 = sma(closes, 20);
  const sma50 = sma(closes, 50);
  const sma200 = sma(closes, 200);
  const prevSma50 = sma(closes.slice(0, closes.length - 1), 50);
  const rsi14 = rsi(closes, 14);
  const atr14 = atr(bars, 14);
  const avgVol20 = avgVolume(bars, 20);

  if (
    sma20 == null ||
    sma50 == null ||
    sma200 == null ||
    prevSma50 == null ||
    rsi14 == null ||
    atr14 == null ||
    avgVol20 == null
  ) {
    return null;
  }

  const volumeSpike = avgVol20 > 0 ? latest.volume / avgVol20 : 0;
  const avgDollarVolume20 = avgVol20 * latest.close;
  const distFromSma20 = Math.abs(latest.close - sma20);
  const distInAtr = atr14 > 0 ? distFromSma20 / atr14 : 999;

  const above50 = latest.close > sma50;
  const above200 = latest.close > sma200;
  const sma20Above50 = sma20 > sma50;
  const sma50Rising = sma50 > prevSma50;

  const buyRsiOk = rsi14 >= 50 && rsi14 <= 65;
  const watchRsiOk = rsi14 >= 45 && rsi14 <= 70;
  const buyVolumeOk = volumeSpike >= 1.2;
  const watchVolumeOk = volumeSpike >= 1.1;
  const buyNotExtended = distFromSma20 <= 1.5 * atr14;
  const watchNotExtended = distFromSma20 <= 2.0 * atr14;
  const reclaimed = recentlyReclaimedSma200(closes, sma200);
  const watchTrendAligned = above200 || reclaimed;

  const liquidityOk = avgDollarVolume20 >= MIN_AVG_DOLLAR_VOLUME;
  const marketCapAvailable = typeof marketCap === "number" && Number.isFinite(marketCap);
  const marketCapOk = !marketCapAvailable || (marketCap as number) > MIN_MARKET_CAP;

  const scoreBreakdown: Array<{ key: string; points: number }> = [];
  let score = 0;

  const trendCore = above50 && above200;
  const trendCorePts = trendCore ? 25 : above50 ? 12 : 0;
  score += trendCorePts;
  scoreBreakdown.push({ key: "Trend core (close>SMA50 & SMA200)", points: trendCorePts });

  const smaStackPts = sma20Above50 ? 15 : 0;
  score += smaStackPts;
  scoreBreakdown.push({ key: "SMA20 above SMA50", points: smaStackPts });

  const slopePts = sma50Rising ? 15 : 0;
  score += slopePts;
  scoreBreakdown.push({ key: "SMA50 rising", points: slopePts });

  let rsiPts = 0;
  if (buyRsiOk) rsiPts = 15;
  else if (watchRsiOk) rsiPts = 8;
  score += rsiPts;
  scoreBreakdown.push({ key: "RSI quality", points: rsiPts });

  let volumePts = 0;
  if (buyVolumeOk) volumePts = 15;
  else if (watchVolumeOk) volumePts = 8;
  score += volumePts;
  scoreBreakdown.push({ key: "Volume confirmation", points: volumePts });

  let extensionPts = 0;
  if (buyNotExtended) extensionPts = 10;
  else if (watchNotExtended) extensionPts = 5;
  score += extensionPts;
  scoreBreakdown.push({ key: "Extension control", points: extensionPts });

  const liquidityPts = liquidityOk ? 5 : 0;
  score += liquidityPts;
  scoreBreakdown.push({ key: "Liquidity floor", points: liquidityPts });

  score = clamp(score, 0, 100);

  const strictBuy =
    trendCore &&
    sma20Above50 &&
    sma50Rising &&
    buyRsiOk &&
    buyVolumeOk &&
    buyNotExtended &&
    liquidityOk &&
    marketCapOk;

  const watchEligible =
    above50 &&
    watchTrendAligned &&
    watchRsiOk &&
    watchVolumeOk &&
    watchNotExtended &&
    liquidityOk &&
    marketCapOk;

  let rawSignal: "BUY" | "WATCH" | "AVOID" = "AVOID";
  if (strictBuy) rawSignal = "BUY";
  else if (watchEligible) rawSignal = "WATCH";

  const downgradedBuyToWatch = regime === "DEFENSIVE" && rawSignal === "BUY";
  const signal = downgradedBuyToWatch ? "WATCH" : rawSignal;

  const entry = latest.close;
  const stop = entry * 0.92;
  const tp1 = entry * 1.05;
  const tp2 = entry * 1.1;

  const checks: RuleCheck[] = [
    {
      key: "close_above_sma50",
      label: "Close > SMA50",
      ok: above50,
      detail: `close ${entry.toFixed(2)} vs SMA50 ${sma50.toFixed(2)}`,
    },
    {
      key: "close_above_sma200",
      label: "Close > SMA200",
      ok: above200,
      detail: `close ${entry.toFixed(2)} vs SMA200 ${sma200.toFixed(2)}`,
    },
    {
      key: "sma20_above_sma50",
      label: "SMA20 > SMA50",
      ok: sma20Above50,
      detail: `SMA20 ${sma20.toFixed(2)} vs SMA50 ${sma50.toFixed(2)}`,
    },
    {
      key: "sma50_rising",
      label: "SMA50 rising",
      ok: sma50Rising,
      detail: `SMA50 ${sma50.toFixed(2)} vs prev ${prevSma50.toFixed(2)}`,
    },
    {
      key: "rsi_buy_band",
      label: "RSI(14) in BUY band 50-65",
      ok: buyRsiOk,
      detail: `RSI ${rsi14.toFixed(1)}`,
    },
    {
      key: "rsi_watch_band",
      label: "RSI(14) in WATCH band 45-70",
      ok: watchRsiOk,
      detail: `RSI ${rsi14.toFixed(1)}`,
    },
    {
      key: "volume_buy",
      label: "Volume spike >= 1.2x (BUY)",
      ok: buyVolumeOk,
      detail: `${volumeSpike.toFixed(2)}x`,
    },
    {
      key: "volume_watch",
      label: "Volume spike >= 1.1x (WATCH)",
      ok: watchVolumeOk,
      detail: `${volumeSpike.toFixed(2)}x`,
    },
    {
      key: "extension_buy",
      label: "Not extended <= 1.5 ATR (BUY)",
      ok: buyNotExtended,
      detail: `${distInAtr.toFixed(2)} ATR`,
    },
    {
      key: "extension_watch",
      label: "Not severely extended <= 2.0 ATR (WATCH)",
      ok: watchNotExtended,
      detail: `${distInAtr.toFixed(2)} ATR`,
    },
    {
      key: "watch_trend_aligned",
      label: "WATCH trend aligned (above/reclaimed SMA200)",
      ok: watchTrendAligned,
      detail: above200 ? "Above SMA200" : reclaimed ? "Recently reclaimed SMA200" : "Not aligned",
    },
    {
      key: "liquidity",
      label: "Avg dollar volume >= $50M",
      ok: liquidityOk,
      detail: `$${Math.round(avgDollarVolume20).toLocaleString()}`,
    },
    {
      key: "market_cap",
      label: "Market cap > $2B (if available)",
      ok: marketCapOk,
      detail: marketCapAvailable ? `$${Math.round(marketCap as number).toLocaleString()}` : "Unavailable",
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
    else if (k.includes("volume")) category = "volume";
    else if (k.includes("rsi") || k.includes("momentum")) category = "momentum";
    else if (k.includes("extension") || k.includes("atr") || k.includes("liquidity") || k.includes("market_cap"))
      category = "risk";
    else if (k.includes("execution")) category = "execution";
    return { ...c, category };
  });

  const passCount = checksWithCategory.filter((c) => c.ok).length;
  const reasonSummary = [
    `${signal} (${score}/100)`,
    `trend ${trendCore ? "strong" : "mixed"}`,
    `RSI ${rsi14.toFixed(1)}`,
    `vol ${volumeSpike.toFixed(2)}x`,
    `dist ${distInAtr.toFixed(2)} ATR`,
    `liq ${Math.round(avgDollarVolume20 / 1_000_000)}M`,
    downgradedBuyToWatch ? "defensive regime downgrade" : "regime ok",
    `${passCount}/${checks.length} checks`,
  ].join(" • ");

  return {
    signal,
    raw_signal: rawSignal,
    confidence: Math.round(score),
    entry,
    stop,
    tp1,
    tp2,
    max_holding_days: CORE_MOMENTUM_MAX_HOLDING_DAYS,
    reason_summary: reasonSummary,
    reason_json: {
      strategy: "core_momentum_swing_v2",
      regime,
      downgraded_buy_to_watch: downgradedBuyToWatch,
      indicators: {
        close: entry,
        sma20,
        sma50,
        sma200,
        prevSma50,
        rsi14,
        atr14,
        avgVolume20: avgVol20,
        volumeSpike,
        avgDollarVolume20,
        distFromSma20,
        distInAtr,
        marketCap,
      },
      checks: checksWithCategory,
      score_breakdown: scoreBreakdown,
      score: Math.round(score),
      trade_plan: {
        entry,
        stop,
        tp1,
        tp2,
        max_holding_days: CORE_MOMENTUM_MAX_HOLDING_DAYS,
        management: `Take 50% at +5%, hold 50% for +10%, hard stop -8%, time stop ${CORE_MOMENTUM_MAX_HOLDING_DAYS} trading days.`,
        stop_style: "pct_8",
      },
    },
  } satisfies RuleEvaluation;
}

export function describeSignalForUi(signal: "BUY" | "WATCH" | "AVOID") {
  if (signal === "BUY") return `High-conviction momentum continuation with ${pct(0.05)} / ${pct(0.1)} targets.`;
  if (signal === "WATCH") return "Trend setup is constructive but not fully strict-BUY yet.";
  return "Setup does not satisfy strict continuation criteria.";
}
