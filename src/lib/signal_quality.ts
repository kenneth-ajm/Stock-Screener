export type SignalValue = "BUY" | "WATCH" | "AVOID";

export type QualityComponentKey =
  | "trend_score"
  | "momentum_score"
  | "market_regime_score"
  | "sector_strength_score"
  | "liquidity_score"
  | "volatility_score"
  | "extension_score";

export type QualityComponentScores = Record<QualityComponentKey, number>;

export type RiskGrade = "A" | "B" | "C" | "D";

export type SignalQualityInput = {
  strategy_version: string;
  signal: SignalValue;
  confidence: number | null | undefined;
  rank_score?: number | null;
  regime_state?: string | null;
  reason_json?: Record<string, unknown> | null;
  entry?: number | null;
  stop?: number | null;
};

export type SignalQualityResult = {
  quality_score: number;
  risk_grade: RiskGrade;
  quality_signal: SignalValue;
  quality_summary: string;
  components: QualityComponentScores;
};

const WEIGHTS: QualityComponentScores = {
  trend_score: 20,
  momentum_score: 20,
  market_regime_score: 15,
  sector_strength_score: 15,
  liquidity_score: 10,
  volatility_score: 10,
  extension_score: 10,
};

function clamp(n: number, min: number, max: number) {
  return Math.max(min, Math.min(max, n));
}

function toNum(v: unknown): number | null {
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : null;
}

function toNorm(v: number | null, min: number, max: number) {
  if (v === null || max <= min) return null;
  return clamp((v - min) / (max - min), 0, 1);
}

function getByPath(obj: unknown, path: string): unknown {
  if (!obj || typeof obj !== "object") return undefined;
  const parts = path.split(".");
  let cur: any = obj;
  for (const p of parts) {
    if (cur == null || typeof cur !== "object") return undefined;
    cur = cur[p];
  }
  return cur;
}

function getIndicator(reasonJson: Record<string, unknown> | null | undefined, keys: string[]) {
  for (const key of keys) {
    const v = getByPath(reasonJson, `indicators.${key}`);
    const n = toNum(v);
    if (n !== null) return n;
    const direct = toNum(getByPath(reasonJson, key));
    if (direct !== null) return direct;
  }
  return null;
}

function checkOk(reasonJson: Record<string, unknown> | null | undefined, keys: string[]) {
  const checks = Array.isArray((reasonJson as any)?.checks) ? ((reasonJson as any).checks as any[]) : [];
  const want = new Set(keys.map((k) => String(k).toLowerCase()));
  for (const c of checks) {
    const key = String(c?.key ?? c?.id ?? "").toLowerCase();
    if (!want.has(key)) continue;
    if (typeof c?.ok === "boolean") return c.ok;
  }
  return null;
}

function mean(nums: Array<number | null>) {
  const values = nums.filter((n): n is number => typeof n === "number" && Number.isFinite(n));
  if (values.length === 0) return null;
  return values.reduce((a, b) => a + b, 0) / values.length;
}

function points(norm: number | null, weight: number) {
  if (norm === null) return Math.round(weight * 0.55);
  return Math.round(clamp(norm, 0, 1) * weight);
}

function mapRiskGrade(score: number): RiskGrade {
  if (score >= 85) return "A";
  if (score >= 70) return "B";
  if (score >= 55) return "C";
  return "D";
}

function degradeSignal(rawSignal: SignalValue, qualityScore: number): SignalValue {
  if (rawSignal === "AVOID") return "AVOID";
  if (rawSignal === "WATCH") return qualityScore < 45 ? "AVOID" : "WATCH";
  if (qualityScore < 50) return "AVOID";
  if (qualityScore < 70) return "WATCH";
  return "BUY";
}

export function scoreSignalQuality(input: SignalQualityInput): SignalQualityResult {
  const reasonJson = input.reason_json ?? null;
  const confidence = toNum(input.confidence) ?? 50;
  const confidenceNorm = clamp(confidence / 100, 0, 1);

  const trendFromChecks = mean([
    checkOk(reasonJson, ["close_above_sma20", "trend_template", "template_trend"] ) === true ? 1 : checkOk(reasonJson, ["close_above_sma20", "trend_template", "template_trend"]) === false ? 0 : null,
    checkOk(reasonJson, ["close_above_sma50", "price_above_sma50"]) === true ? 1 : checkOk(reasonJson, ["close_above_sma50", "price_above_sma50"]) === false ? 0 : null,
    checkOk(reasonJson, ["close_above_sma200", "price_above_sma200", "watch_trend_aligned"]) === true ? 1 : checkOk(reasonJson, ["close_above_sma200", "price_above_sma200", "watch_trend_aligned"]) === false ? 0 : null,
  ]);
  const trendScore = points(trendFromChecks ?? confidenceNorm * 0.9, WEIGHTS.trend_score);

  const volumeSpike = getIndicator(reasonJson, ["volumeSpike", "volume_expansion", "volExp"]);
  const rsi = getIndicator(reasonJson, ["rsi14"]);
  const rsVsSpy = getIndicator(reasonJson, ["rs_vs_spy", "rsOutperformance", "rsProxy"]);
  const momentumNorm = mean([
    volumeSpike == null ? null : toNorm(volumeSpike, 0.9, 2.0),
    rsi == null ? null : 1 - clamp(Math.abs(rsi - 55) / 25, 0, 1),
    rsVsSpy == null ? null : toNorm(rsVsSpy, -0.05, 0.2),
  ]);
  const momentumScore = points(momentumNorm ?? confidenceNorm, WEIGHTS.momentum_score);

  const regimeState = String(input.regime_state ?? (reasonJson as any)?.regime ?? "").toUpperCase();
  const regimeGateOk = checkOk(reasonJson, ["regime_gate"]);
  let regimeNorm: number;
  if (regimeGateOk === true) regimeNorm = 1;
  else if (regimeGateOk === false) regimeNorm = 0.25;
  else if (regimeState === "FAVORABLE") regimeNorm = 1;
  else if (regimeState === "CAUTION" || regimeState === "MIXED") regimeNorm = 0.6;
  else regimeNorm = 0.35;
  const marketRegimeScore = points(regimeNorm, WEIGHTS.market_regime_score);

  const groupState = String((reasonJson as any)?.group?.state ?? "").toUpperCase();
  const pct50 = toNum((reasonJson as any)?.group?.participation?.pct_above_sma50 ?? getIndicator(reasonJson, ["pct_above_sma50"]));
  const pct200 = toNum((reasonJson as any)?.group?.participation?.pct_above_sma200 ?? getIndicator(reasonJson, ["pct_above_sma200"]));
  const sectorNorm = mean([
    groupState ? groupState === "LEADING" ? 1 : groupState === "IMPROVING" ? 0.7 : 0.35 : null,
    pct50 == null ? null : toNorm(pct50, 35, 75),
    pct200 == null ? null : toNorm(pct200, 25, 65),
    rsVsSpy == null ? null : toNorm(rsVsSpy, -0.03, 0.12),
  ]);
  const sectorStrengthScore = points(sectorNorm ?? confidenceNorm * 0.8, WEIGHTS.sector_strength_score);

  const adv = getIndicator(reasonJson, ["avgDollarVolume20", "avg_dollar_volume_20", "avgDollarVolume"]);
  const liquidityNorm = adv == null ? null : toNorm(adv, 5_000_000, 60_000_000);
  const liquidityScore = points(liquidityNorm ?? 0.5, WEIGHTS.liquidity_score);

  const atrRatio = getIndicator(reasonJson, ["atrRatio"]);
  const atr14 = getIndicator(reasonJson, ["atr14"]);
  const entry = toNum(input.entry ?? getIndicator(reasonJson, ["close"]));
  const derivedAtrRatio = atrRatio ?? (atr14 != null && entry && entry > 0 ? atr14 / entry : null);
  const volatilityNorm = derivedAtrRatio == null ? null : 1 - clamp((derivedAtrRatio - 0.015) / 0.09, 0, 1);
  const volatilityScore = points(volatilityNorm ?? 0.6, WEIGHTS.volatility_score);

  const distInAtr = getIndicator(reasonJson, ["distInAtr"]);
  const nearTrigger = getIndicator(reasonJson, ["near_trigger_ratio"]);
  const extensionNorm = mean([
    distInAtr == null ? null : 1 - clamp(distInAtr / 2.5, 0, 1),
    nearTrigger == null ? null : 1 - clamp((nearTrigger - 1) / 0.12, 0, 1),
    checkOk(reasonJson, ["not_too_extended", "extension_buy", "extension_watch"]) === true
      ? 1
      : checkOk(reasonJson, ["not_too_extended", "extension_buy", "extension_watch"]) === false
      ? 0
      : null,
  ]);
  const extensionScore = points(extensionNorm ?? 0.55, WEIGHTS.extension_score);

  const components: QualityComponentScores = {
    trend_score: trendScore,
    momentum_score: momentumScore,
    market_regime_score: marketRegimeScore,
    sector_strength_score: sectorStrengthScore,
    liquidity_score: liquidityScore,
    volatility_score: volatilityScore,
    extension_score: extensionScore,
  };

  const qualityScore = Object.values(components).reduce((a, b) => a + b, 0);
  const riskGrade = mapRiskGrade(qualityScore);
  const qualitySignal = degradeSignal(input.signal, qualityScore);

  const labels: Array<{ key: QualityComponentKey; label: string }> = [
    { key: "trend_score", label: "trend" },
    { key: "momentum_score", label: "momentum" },
    { key: "market_regime_score", label: "regime" },
    { key: "sector_strength_score", label: "sector" },
    { key: "liquidity_score", label: "liquidity" },
    { key: "volatility_score", label: "volatility" },
    { key: "extension_score", label: "extension" },
  ];

  const sorted = labels
    .map((x) => ({ ...x, ratio: components[x.key] / WEIGHTS[x.key] }))
    .sort((a, b) => b.ratio - a.ratio);

  const strengths = sorted.slice(0, 2).map((s) => s.label).join(" + ");
  const weaknesses = sorted.slice(-2).map((s) => s.label).join(" + ");
  const qualitySummary =
    qualityScore >= 70
      ? `High quality setup: ${strengths} strong; monitor ${weaknesses}.`
      : qualityScore >= 50
      ? `Moderate quality setup: ${strengths} supportive; weak ${weaknesses}.`
      : `Low quality setup: weak ${weaknesses}; caution despite raw ${input.signal}.`;

  return {
    quality_score: qualityScore,
    risk_grade: riskGrade,
    quality_signal: qualitySignal,
    quality_summary: qualitySummary,
    components,
  };
}
