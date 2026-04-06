type PriceBar = {
  date: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
};

export type DailySymbolFact = {
  date: string;
  symbol: string;
  close: number;
  sma20: number | null;
  sma50: number | null;
  sma200: number | null;
  above_sma20: boolean | null;
  above_sma50: boolean | null;
  above_sma200: boolean | null;
  atr14: number | null;
  atr_ratio: number | null;
  avg_volume20: number | null;
  avg_dollar_volume20: number | null;
  relative_volume: number | null;
  high_30bar: number | null;
  low_30bar: number | null;
  drop_from_30bar_high_pct: number | null;
  distance_from_sma20_pct: number | null;
  distance_from_sma50_pct: number | null;
  distance_from_sma200_pct: number | null;
  trend_state: string;
  extension_state: string;
  liquidity_state: string;
  volatility_state: string;
  source: string;
  updated_at: string;
};

function round2(value: number | null) {
  if (value == null || !Number.isFinite(value)) return null;
  return Math.round(value * 100) / 100;
}

function sma(values: number[], period: number) {
  if (values.length < period) return null;
  const slice = values.slice(values.length - period);
  const total = slice.reduce((sum, value) => sum + value, 0);
  return total / period;
}

function avgVolume(bars: PriceBar[], period: number) {
  if (bars.length < period) return null;
  const slice = bars.slice(bars.length - period);
  const total = slice.reduce((sum, bar) => sum + bar.volume, 0);
  return total / period;
}

function trueRange(curr: PriceBar, prev: PriceBar) {
  const hl = curr.high - curr.low;
  const hc = Math.abs(curr.high - prev.close);
  const lc = Math.abs(curr.low - prev.close);
  return Math.max(hl, hc, lc);
}

function atr(bars: PriceBar[], period: number) {
  if (bars.length < period + 1) return null;
  let total = 0;
  for (let i = bars.length - period; i < bars.length; i += 1) {
    total += trueRange(bars[i], bars[i - 1]);
  }
  return total / period;
}

function pctDistance(close: number, ref: number | null) {
  if (!Number.isFinite(close) || !ref || !Number.isFinite(ref) || ref <= 0) return null;
  return ((close - ref) / ref) * 100;
}

function classifyTrend(close: number, sma50: number | null, sma200: number | null) {
  if (!sma50 || !sma200) return "unknown";
  if (close > sma50 && close > sma200) return "strong_uptrend";
  if (close > sma200) return "above_200";
  if (close > sma50) return "mixed";
  return "below_50_200";
}

function classifyExtension(distFromSma20Pct: number | null, dropFrom30BarHighPct: number | null) {
  if (distFromSma20Pct == null && dropFrom30BarHighPct == null) return "unknown";
  if ((distFromSma20Pct ?? 0) >= 6) return "extended";
  if ((dropFrom30BarHighPct ?? 0) >= 5 && (dropFrom30BarHighPct ?? 0) <= 12) return "pullback";
  if ((dropFrom30BarHighPct ?? 0) > 12) return "deep_pullback";
  return "tight";
}

function classifyLiquidity(avgDollarVolume20: number | null) {
  if (avgDollarVolume20 == null) return "unknown";
  if (avgDollarVolume20 >= 50_000_000) return "institutional";
  if (avgDollarVolume20 >= 10_000_000) return "liquid";
  if (avgDollarVolume20 >= 3_000_000) return "adequate";
  return "thin";
}

function classifyVolatility(atrRatio: number | null) {
  if (atrRatio == null) return "unknown";
  if (atrRatio <= 0.025) return "calm";
  if (atrRatio <= 0.05) return "normal";
  if (atrRatio <= 0.075) return "elevated";
  return "high";
}

export function computeDailySymbolFact(args: {
  symbol: string;
  scanDate: string;
  barsAsc: PriceBar[];
}): DailySymbolFact | null {
  const bars = args.barsAsc;
  if (!Array.isArray(bars) || bars.length < 30) return null;

  const latest = bars[bars.length - 1];
  if (!latest || latest.date !== args.scanDate) return null;

  const closes = bars.map((bar) => bar.close);
  const sma20Value = sma(closes, 20);
  const sma50Value = sma(closes, 50);
  const sma200Value = sma(closes, 200);
  const atr14Value = atr(bars, 14);
  const avgVolume20Value = avgVolume(bars, 20);
  const recent30 = bars.slice(Math.max(0, bars.length - 30));
  const high30 = recent30.length ? Math.max(...recent30.map((bar) => bar.high)) : null;
  const low30 = recent30.length ? Math.min(...recent30.map((bar) => bar.low)) : null;
  const close = latest.close;
  const avgDollarVolume20Value =
    avgVolume20Value != null && Number.isFinite(close) ? avgVolume20Value * close : null;
  const relativeVolumeValue =
    avgVolume20Value != null && avgVolume20Value > 0 ? latest.volume / avgVolume20Value : null;
  const atrRatioValue =
    atr14Value != null && Number.isFinite(close) && close > 0 ? atr14Value / close : null;
  const dropFrom30BarHighPct =
    high30 != null && high30 > 0 ? ((high30 - close) / high30) * 100 : null;
  const distanceFromSma20Pct = pctDistance(close, sma20Value);
  const distanceFromSma50Pct = pctDistance(close, sma50Value);
  const distanceFromSma200Pct = pctDistance(close, sma200Value);

  return {
    date: args.scanDate,
    symbol: args.symbol,
    close: round2(close) ?? close,
    sma20: round2(sma20Value),
    sma50: round2(sma50Value),
    sma200: round2(sma200Value),
    above_sma20: sma20Value != null ? close > sma20Value : null,
    above_sma50: sma50Value != null ? close > sma50Value : null,
    above_sma200: sma200Value != null ? close > sma200Value : null,
    atr14: round2(atr14Value),
    atr_ratio: round2(atrRatioValue),
    avg_volume20: round2(avgVolume20Value),
    avg_dollar_volume20: round2(avgDollarVolume20Value),
    relative_volume: round2(relativeVolumeValue),
    high_30bar: round2(high30),
    low_30bar: round2(low30),
    drop_from_30bar_high_pct: round2(dropFrom30BarHighPct),
    distance_from_sma20_pct: round2(distanceFromSma20Pct),
    distance_from_sma50_pct: round2(distanceFromSma50Pct),
    distance_from_sma200_pct: round2(distanceFromSma200Pct),
    trend_state: classifyTrend(close, sma50Value, sma200Value),
    extension_state: classifyExtension(distanceFromSma20Pct, dropFrom30BarHighPct),
    liquidity_state: classifyLiquidity(avgDollarVolume20Value),
    volatility_state: classifyVolatility(atrRatioValue),
    source: "scan_pipeline",
    updated_at: new Date().toISOString(),
  };
}

export async function upsertDailySymbolFacts(opts: {
  supabase: any;
  facts: DailySymbolFact[];
}) {
  const supa = opts.supabase as any;
  const facts = Array.isArray(opts.facts) ? opts.facts : [];
  if (!facts.length) return { ok: true, upserted: 0, skipped: false as const };

  try {
    const { error, data } = await supa
      .from("daily_symbol_facts")
      .upsert(facts, { onConflict: "date,symbol" })
      .select("id");
    if (error) {
      const message = String(error.message ?? "");
      const missingRelation =
        /daily_symbol_facts/i.test(message) &&
        (message.includes("does not exist") || message.includes("schema cache"));
      if (missingRelation) {
        return { ok: true, upserted: 0, skipped: true as const };
      }
      return { ok: false, upserted: 0, skipped: false as const, error: message };
    }
    return { ok: true, upserted: data?.length ?? facts.length, skipped: false as const };
  } catch (error: any) {
    const message = String(error?.message ?? "daily_symbol_facts upsert failed");
    const missingRelation =
      /daily_symbol_facts/i.test(message) &&
      (message.includes("does not exist") || message.includes("schema cache"));
    if (missingRelation) {
      return { ok: true, upserted: 0, skipped: true as const };
    }
    return { ok: false, upserted: 0, skipped: false as const, error: message };
  }
}
