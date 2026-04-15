export type TargetBar = {
  date?: string;
  high: number;
  low?: number | null;
  close: number;
};

export type TechnicalTargetModel =
  | "technical_resistance_r"
  | "technical_resistance_measured_move"
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
  min_rr_tp1: number;
  min_rr_tp2: number;
  fallback_rr_tp1: number;
  fallback_rr_tp2: number;
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
      min_rr_tp1: 1.5,
      min_rr_tp2: 3,
      fallback_rr_tp1: 2,
      fallback_rr_tp2: 4,
    };
  }
  if (strategyVersion === "quality_dip_v1") {
    return {
      min_rr_tp1: 1,
      min_rr_tp2: 2,
      fallback_rr_tp1: 1.25,
      fallback_rr_tp2: 2.5,
    };
  }
  if (strategyVersion === "tactical_momentum_v1") {
    return {
      min_rr_tp1: 1.5,
      min_rr_tp2: 3,
      fallback_rr_tp1: 1.5,
      fallback_rr_tp2: 3,
    };
  }
  return {
    min_rr_tp1: 1.2,
    min_rr_tp2: 2.4,
    fallback_rr_tp1: 1.5,
    fallback_rr_tp2: 3,
  };
}

function measuredMoveTarget(bars: TargetBar[], entry: number, riskPerShare: number) {
  const recent = bars.slice(-20);
  if (!recent.length) return entry + riskPerShare * 2;
  const highs = recent.map((bar) => bar.high);
  const lows = recent.map((bar) => (typeof bar.low === "number" && Number.isFinite(bar.low) ? bar.low : bar.close));
  const range = Math.max(...highs) - Math.min(...lows);
  return entry + Math.max(range, riskPerShare * 2);
}

export function buildTechnicalTargets(input: BuildTechnicalTargetsInput): TechnicalTargets {
  const entry = Number(input.entry);
  const stop = Number(input.stop);
  const bars = Array.isArray(input.bars) ? input.bars.filter((bar) => Number.isFinite(bar.high) && Number.isFinite(bar.close)) : [];
  const riskPerShare = entry - stop;
  const profile = profileForStrategy(String(input.strategy_version ?? ""));

  if (!(entry > 0) || !(stop > 0) || !(entry > stop) || !(riskPerShare > 0) || bars.length < 5) {
    const tp1Fallback = entry + Math.max(riskPerShare * profile.fallback_rr_tp1, entry * 0.05);
    const tp2Fallback = entry + Math.max(riskPerShare * profile.fallback_rr_tp2, entry * 0.1);
    return {
      tp1: round2(tp1Fallback),
      tp2: round2(Math.max(tp2Fallback, tp1Fallback * 1.03)),
      target_model: "r_multiple_fallback",
      tp1_reason: `${profile.fallback_rr_tp1.toFixed(1)}R fallback target`,
      tp2_reason: `${profile.fallback_rr_tp2.toFixed(1)}R fallback target`,
      rr_tp1: round2((tp1Fallback - entry) / Math.max(riskPerShare, 0.0001)),
      rr_tp2: round2((tp2Fallback - entry) / Math.max(riskPerShare, 0.0001)),
      resistance_levels: [],
    };
  }

  const minimumTp1 = entry + riskPerShare * profile.min_rr_tp1;
  const minimumTp2 = entry + riskPerShare * profile.min_rr_tp2;
  const fallbackTp1 = entry + riskPerShare * profile.fallback_rr_tp1;
  const fallbackTp2 = entry + riskPerShare * profile.fallback_rr_tp2;
  const resistanceLevels = collectResistanceLevels(bars).filter((level) => level.price > entry * 1.01);

  const tp1Level = resistanceLevels.find((level) => level.price >= minimumTp1);
  const tp1 = tp1Level ? tp1Level.price : fallbackTp1;

  const tp2Level = resistanceLevels.find(
    (level) => level.price > tp1 * 1.01 && level.price >= minimumTp2
  );
  const measuredMove = measuredMoveTarget(bars, entry, riskPerShare);
  const tp2Candidate = tp2Level ? tp2Level.price : Math.max(fallbackTp2, measuredMove);
  const tp2 = Math.max(tp2Candidate, tp1 * 1.03);

  const targetModel: TechnicalTargetModel = tp1Level
    ? tp2Level
      ? "technical_resistance_r"
      : "technical_resistance_measured_move"
    : "r_multiple_fallback";

  return {
    tp1: round2(tp1),
    tp2: round2(tp2),
    target_model: targetModel,
    tp1_reason: tp1Level ? `${tp1Level.label} resistance` : `${profile.fallback_rr_tp1.toFixed(1)}R fallback target`,
    tp2_reason: tp2Level
      ? `${tp2Level.label} resistance`
      : targetModel === "technical_resistance_measured_move"
        ? `measured move / ${profile.fallback_rr_tp2.toFixed(1)}R fallback`
        : `${profile.fallback_rr_tp2.toFixed(1)}R fallback target`,
    rr_tp1: round2(clamp((tp1 - entry) / riskPerShare, 0, 99)),
    rr_tp2: round2(clamp((tp2 - entry) / riskPerShare, 0, 99)),
    resistance_levels: resistanceLevels.slice(0, 8).map((level) => round2(level.price)),
  };
}
