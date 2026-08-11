export type TargetBar = {
  date?: string;
  high: number;
  low?: number | null;
  close: number;
};

export type TechnicalTargetModel =
  | "technical_resistance_r"
  | "technical_resistance_projection"
  | "volatility_projection"
  | "r_multiple_fallback";

export type TechnicalTargets = {
  tp1: number;
  tp2: number;
  target_model: TechnicalTargetModel;
  tp1_reason: string;
  tp2_reason: string;
  rr_tp1: number;
  rr_tp2: number;
  resistance_levels: number[];
};

type ResistanceLevel = {
  price: number;
  label: string;
};

type BuildTechnicalTargetsInput = {
  bars: TargetBar[];
  entry: number;
  stop: number;
  strategy_version: string;
};

type TargetProfile = {
  fallback_rr_tp1: number;
  fallback_rr_tp2: number;
  projection_atr_tp1: number;
  projection_atr_tp2: number;
  minimum_projection_tp1_pct: number;
  minimum_projection_tp2_pct: number;
};

function round2(n: number) {
  return Math.round(n * 100) / 100;
}

function clamp(n: number, min: number, max: number) {
  return Math.max(min, Math.min(max, n));
}

function uniqueResistanceLevels(levels: ResistanceLevel[]) {
  const sorted = [...levels].sort((a, b) => a.price - b.price);
  const out: ResistanceLevel[] = [];
  for (const level of sorted) {
    if (!(level.price > 0)) continue;
    const prev = out[out.length - 1];
    if (!prev) {
      out.push(level);
      continue;
    }
    const pctDiff = Math.abs(level.price - prev.price) / prev.price;
    if (pctDiff <= 0.0075) continue;
    out.push(level);
  }
  return out;
}

function localPivotHighs(bars: TargetBar[]) {
  const out: ResistanceLevel[] = [];
  if (bars.length < 7) return out;
  const start = Math.max(2, bars.length - 90);
  for (let i = start; i < bars.length - 2; i += 1) {
    const current = bars[i];
    if (!(current.high > 0)) continue;
    if (
      current.high >= bars[i - 1].high &&
      current.high >= bars[i - 2].high &&
      current.high >= bars[i + 1].high &&
      current.high >= bars[i + 2].high
    ) {
      out.push({
        price: current.high,
        label: current.date ? `pivot high ${current.date}` : "pivot high",
      });
    }
  }
  return out.slice(-12);
}

function collectResistanceLevels(bars: TargetBar[]) {
  const priorBars = bars.slice(0, -1);
  if (!priorBars.length) return [] as ResistanceLevel[];
  const levels: ResistanceLevel[] = [];
  for (const lookback of [10, 20, 30, 60, 120, 252]) {
    if (priorBars.length < Math.min(lookback, 3)) continue;
    const slice = priorBars.slice(-Math.min(lookback, priorBars.length));
    levels.push({
      price: Math.max(...slice.map((bar) => bar.high)),
      label: `${Math.min(lookback, priorBars.length)}-bar high`,
    });
  }
  levels.push(...localPivotHighs(priorBars));
  return uniqueResistanceLevels(levels);
}

function profileForStrategy(strategyVersion: string): TargetProfile {
  if (strategyVersion === "v1_trend_hold") {
    return {
      fallback_rr_tp1: 2,
      fallback_rr_tp2: 4,
      projection_atr_tp1: 2,
      projection_atr_tp2: 4,
      minimum_projection_tp1_pct: 0.04,
      minimum_projection_tp2_pct: 0.08,
    };
  }
  if (strategyVersion === "quality_dip_v1") {
    return {
      fallback_rr_tp1: 1.25,
      fallback_rr_tp2: 2.5,
      projection_atr_tp1: 1.5,
      projection_atr_tp2: 3,
      minimum_projection_tp1_pct: 0.03,
      minimum_projection_tp2_pct: 0.06,
    };
  }
  if (strategyVersion === "tactical_momentum_v1") {
    return {
      fallback_rr_tp1: 1.5,
      fallback_rr_tp2: 3,
      projection_atr_tp1: 1.5,
      projection_atr_tp2: 3,
      minimum_projection_tp1_pct: 0.03,
      minimum_projection_tp2_pct: 0.06,
    };
  }
  return {
    fallback_rr_tp1: 1.5,
    fallback_rr_tp2: 3,
    projection_atr_tp1: 1.5,
    projection_atr_tp2: 3,
    minimum_projection_tp1_pct: 0.03,
    minimum_projection_tp2_pct: 0.06,
  };
}

function averageTrueRange(bars: TargetBar[], period = 14) {
  if (bars.length < 2) return null;
  const trueRanges: number[] = [];
  const start = Math.max(1, bars.length - period);
  for (let i = start; i < bars.length; i += 1) {
    const current = bars[i];
    const previous = bars[i - 1];
    const low = typeof current.low === "number" && Number.isFinite(current.low) ? current.low : current.close;
    const trueRange = Math.max(
      current.high - low,
      Math.abs(current.high - previous.close),
      Math.abs(low - previous.close)
    );
    if (Number.isFinite(trueRange) && trueRange > 0) trueRanges.push(trueRange);
  }
  if (!trueRanges.length) return null;
  return trueRanges.reduce((sum, value) => sum + value, 0) / trueRanges.length;
}

function projectedTarget(
  entry: number,
  riskPerShare: number,
  atr: number,
  rrMultiple: number,
  atrMultiple: number,
  minimumPct: number
) {
  const riskProjection = riskPerShare * rrMultiple;
  const volatilityProjection = Math.max(atr * atrMultiple, entry * minimumPct);
  return entry + Math.min(riskProjection, volatilityProjection);
}

export function buildTechnicalTargets(input: BuildTechnicalTargetsInput): TechnicalTargets {
  const entry = Number(input.entry);
  const stop = Number(input.stop);
  const bars = Array.isArray(input.bars)
    ? input.bars.filter(
        (bar) =>
          Number.isFinite(bar.high) &&
          Number.isFinite(bar.close) &&
          (bar.low == null || Number.isFinite(bar.low))
      )
    : [];
  const riskPerShare = entry - stop;
  const profile = profileForStrategy(String(input.strategy_version ?? ""));

  if (!(entry > 0) || !(stop > 0) || !(entry > stop) || !(riskPerShare > 0) || bars.length < 5) {
    const tp1Fallback = entry + Math.max(riskPerShare * profile.fallback_rr_tp1, entry * 0.05);
    const tp2Fallback = entry + Math.max(riskPerShare * profile.fallback_rr_tp2, entry * 0.1);
    return {
      tp1: round2(tp1Fallback),
      tp2: round2(Math.max(tp2Fallback, tp1Fallback * 1.03)),
      target_model: "r_multiple_fallback",
      tp1_reason: `${profile.fallback_rr_tp1.toFixed(1)}R mechanical fallback; insufficient chart history`,
      tp2_reason: `${profile.fallback_rr_tp2.toFixed(1)}R mechanical fallback; insufficient chart history`,
      rr_tp1: round2((tp1Fallback - entry) / Math.max(riskPerShare, 0.0001)),
      rr_tp2: round2((tp2Fallback - entry) / Math.max(riskPerShare, 0.0001)),
      resistance_levels: [],
    };
  }

  const atr = averageTrueRange(bars) ?? Math.max(entry * 0.02, riskPerShare / 2);
  const projectedTp1 = projectedTarget(
    entry,
    riskPerShare,
    atr,
    profile.fallback_rr_tp1,
    profile.projection_atr_tp1,
    profile.minimum_projection_tp1_pct
  );
  const projectedTp2 = projectedTarget(
    entry,
    riskPerShare,
    atr,
    profile.fallback_rr_tp2,
    profile.projection_atr_tp2,
    profile.minimum_projection_tp2_pct
  );
  const resistanceLevels = collectResistanceLevels(bars).filter((level) => level.price > entry * 1.01);

  // Use real overhead structure even when it exposes weak reward/risk. Inventing a farther
  // target to satisfy a minimum R multiple makes the ticket look safer than the chart is.
  const tp1Level = resistanceLevels[0];
  const tp1 = tp1Level ? tp1Level.price : projectedTp1;
  const tp2Level = resistanceLevels.find((level) => level.price > tp1 * 1.01);
  const tp2 = tp2Level ? tp2Level.price : Math.max(projectedTp2, tp1 * 1.03);

  const targetModel: TechnicalTargetModel = tp1Level
    ? tp2Level
      ? "technical_resistance_r"
      : "technical_resistance_projection"
    : "volatility_projection";

  return {
    tp1: round2(tp1),
    tp2: round2(tp2),
    target_model: targetModel,
    tp1_reason: tp1Level
      ? `${tp1Level.label} resistance`
      : `${profile.projection_atr_tp1.toFixed(1)} ATR projection; no overhead resistance`,
    tp2_reason: tp2Level
      ? `${tp2Level.label} resistance`
      : `${profile.projection_atr_tp2.toFixed(1)} ATR stretch projection; no confirmed resistance`,
    rr_tp1: round2(clamp((tp1 - entry) / riskPerShare, 0, 99)),
    rr_tp2: round2(clamp((tp2 - entry) / riskPerShare, 0, 99)),
    resistance_levels: resistanceLevels.slice(0, 8).map((level) => round2(level.price)),
  };
}
